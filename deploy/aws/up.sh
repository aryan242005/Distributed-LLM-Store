#!/usr/bin/env bash
# One-shot AWS deployment of the Distributed Model Repository across 4 EC2 instances:
#
#   dmr-control  (AZ #1)  coordinator + postgres + nats + frontend   [Elastic IP]
#   dmr-node-1   (AZ #1)  storage node :5001
#   dmr-node-2   (AZ #2)  storage node :5002
#   dmr-node-3   (AZ #3)  storage node :5003
#
# Each instance bootstraps itself via EC2 user-data (installs Docker, clones the repo,
# builds and runs its role). Storage nodes self-register with the coordinator over NATS
# using their own private IP, so no IPs need to be filled in by hand.
#
# Requirements: AWS CLI v2 configured (`aws configure`), and the repo (with deploy/
# committed) pushed to a PUBLIC GitHub repo, because the instances `git clone` it.
#
# Usage (Git Bash / Linux / macOS):
#   bash deploy/aws/up.sh
# Optional overrides:
#   AWS_REGION=ap-south-1 REPO_URL=https://github.com/you/repo.git BRANCH=main bash deploy/aws/up.sh
#
# Tear everything down with: bash deploy/aws/down.sh

set -euo pipefail
export MSYS_NO_PATHCONV=1   # stop Git Bash on Windows from mangling /aws/... and /dev/... args
export AWS_PAGER=""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_TAG="dmr"
KEY_NAME="dmr-key"
KEY_FILE="$SCRIPT_DIR/$KEY_NAME.pem"
SG_NAME="dmr-sg"
CONTROL_TYPE="${CONTROL_TYPE:-t3.medium}"
NODE_TYPE="${NODE_TYPE:-t3.micro}"
NODE_DISK_GB="${NODE_DISK_GB:-30}"
REPO_URL="${REPO_URL:-$(git -C "$SCRIPT_DIR" remote get-url origin)}"
BRANCH="${BRANCH:-$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD)}"
AWS_REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null | tr -d '\r' || true)}"
AWS_REGION="${AWS_REGION:-ap-south-1}"
export AWS_DEFAULT_REGION="$AWS_REGION"

# aws.exe on Windows emits CRLF; strip it so values are usable in bash
awsq() { aws "$@" | tr -d '\r'; }
log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- preflight
command -v aws >/dev/null || { echo "AWS CLI not found. Install it: https://aws.amazon.com/cli/"; exit 1; }
awsq sts get-caller-identity --query Account --output text >/dev/null \
  || { echo "AWS CLI is not configured. Run: aws configure"; exit 1; }

if [ -n "$(git -C "$SCRIPT_DIR" status --porcelain -- ../../deploy ../../frontend ../../backend ../../proto)" ] \
   || [ -n "$(git -C "$SCRIPT_DIR" log --oneline "origin/$BRANCH..HEAD" 2>/dev/null)" ]; then
  echo "WARNING: you have uncommitted or unpushed changes. The EC2 instances clone"
  echo "         $REPO_URL ($BRANCH), so they will NOT see local-only changes."
  read -r -p "Continue anyway? [y/N] " ans; [[ "$ans" =~ ^[Yy]$ ]] || exit 1
fi

existing=$(awsq ec2 describe-instances \
  --filters "Name=tag:Project,Values=$PROJECT_TAG" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[].Instances[].InstanceId' --output text)
if [ -n "$existing" ]; then
  echo "A deployment already exists ($existing). Run deploy/aws/down.sh first."; exit 1
fi

log "Region: $AWS_REGION | Repo: $REPO_URL ($BRANCH)"

# ---------------------------------------------------------------- network
VPC_ID=$(awsq ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
[ "$VPC_ID" != "None" ] || { echo "No default VPC in $AWS_REGION. Create one: aws ec2 create-default-vpc"; exit 1; }

# One default subnet per AZ, sorted by AZ name; take the first three
mapfile -t SUBNETS < <(awsq ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" Name=default-for-az,Values=true \
  --query 'sort_by(Subnets,&AvailabilityZone)[].[SubnetId,AvailabilityZone]' --output text)
[ "${#SUBNETS[@]}" -ge 3 ] || { echo "Need 3 availability zones, found ${#SUBNETS[@]}."; exit 1; }
SUBNET_IDS=(); SUBNET_AZS=()
for i in 0 1 2; do
  read -r sid az <<<"${SUBNETS[$i]}"; SUBNET_IDS+=("$sid"); SUBNET_AZS+=("$az")
done
log "VPC $VPC_ID, AZs: ${SUBNET_AZS[*]}"

# ---------------------------------------------------------------- security group
SG_ID=$(awsq ec2 describe-security-groups \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=group-name,Values=$SG_NAME" \
  --query 'SecurityGroups[0].GroupId' --output text)
if [ "$SG_ID" = "None" ]; then
  log "Creating security group $SG_NAME"
  SG_ID=$(awsq ec2 create-security-group --group-name "$SG_NAME" --vpc-id "$VPC_ID" \
    --description "Distributed Model Repository cluster" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Project,Value=$PROJECT_TAG}]" \
    --query GroupId --output text)
  MY_IP=$(curl -s https://checkip.amazonaws.com | tr -d '\r\n')
  # SSH from this machine only; dashboard + API public; all traffic between cluster members
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --ip-permissions \
    "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=$MY_IP/32}]" \
    "IpProtocol=tcp,FromPort=3000,ToPort=3000,IpRanges=[{CidrIp=0.0.0.0/0}]" \
    "IpProtocol=tcp,FromPort=4000,ToPort=4000,IpRanges=[{CidrIp=0.0.0.0/0}]" \
    "IpProtocol=-1,UserIdGroupPairs=[{GroupId=$SG_ID}]" >/dev/null
else
  log "Reusing security group $SG_NAME ($SG_ID)"
fi

# ---------------------------------------------------------------- key pair
if ! aws ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
  log "Creating key pair $KEY_NAME -> $KEY_FILE"
  awsq ec2 create-key-pair --key-name "$KEY_NAME" --query KeyMaterial --output text > "$KEY_FILE"
  chmod 400 "$KEY_FILE" 2>/dev/null || true
elif [ ! -f "$KEY_FILE" ]; then
  echo "NOTE: key pair $KEY_NAME exists in AWS but $KEY_FILE is missing; SSH will need the original .pem."
fi

# ---------------------------------------------------------------- AMI + Elastic IP
AMI_ID=$(awsq ssm get-parameter \
  --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
  --query Parameter.Value --output text)
log "Ubuntu 24.04 AMI: $AMI_ID"

# Allocated up front so the frontend can be built with a stable public address
read -r EIP_ALLOC EIP <<<"$(awsq ec2 allocate-address --domain vpc \
  --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Project,Value=$PROJECT_TAG}]" \
  --query '[AllocationId,PublicIp]' --output text)"
log "Elastic IP for control plane: $EIP"

# ---------------------------------------------------------------- user-data
COMMON_BOOT=$(cat <<EOF
#!/bin/bash
set -eux
exec > >(tee -a /var/log/dmr-bootstrap.log) 2>&1
apt-get update -y
apt-get install -y docker.io docker-compose-v2 git
systemctl enable --now docker
usermod -aG docker ubuntu
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" /opt/dmr
cd /opt/dmr
EOF
)

control_userdata() {  # $1..$3 = node-1..node-3 private ips
cat <<EOF
$COMMON_BOOT
# Persisted so later 'docker compose' runs (and reboots) keep the same config
cat > deploy/.env <<ENV
PUBLIC_HOST=$EIP
NODE_1_HOST=$1
NODE_2_HOST=$2
NODE_3_HOST=$3
ENV
docker compose -f deploy/docker-compose.control.yml up -d --build
echo "DMR control plane up"
EOF
}

node_userdata() {  # $1=node id  $2=port  $3=control private ip
cat <<EOF
$COMMON_BOOT
docker build -f backend/Dockerfile -t dmr-backend .
TOKEN=\$(curl -sX PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 300")
MY_IP=\$(curl -s -H "X-aws-ec2-metadata-token: \$TOKEN" http://169.254.169.254/latest/meta-data/local-ipv4)
# The NATS client does not retry its first connect, so wait for the broker before starting
until timeout 2 bash -c "</dev/tcp/$3/4222"; do echo "waiting for NATS at $3:4222"; sleep 5; done
mkdir -p /opt/dmr-data
docker run -d --name storage-node --restart always -p $2:$2 \\
  -e NODE_ID=$1 -e NODE_PORT=$2 -e NODE_HOST=0.0.0.0 \\
  -e NODE_ADDRESS=\$MY_IP \\
  -e NATS_URL=nats://$3:4222 \\
  -e COORDINATOR_URL=http://$3:4000 \\
  -e STORAGE_PATH=/data -v /opt/dmr-data:/data \\
  dmr-backend node src/storage/index.js
echo "DMR storage node $1 up"
EOF
}

launch() {  # $1=name  $2=type  $3=disk GB  $4=user-data  $5...=network args
  local name=$1 type=$2 disk=$3 userdata=$4; shift 4
  # Pass user-data via a file: multi-line quoted args don't survive Git Bash -> aws.exe reliably
  local ud_file ud_uri
  ud_file=$(mktemp)
  printf '%s\n' "$userdata" > "$ud_file"
  ud_uri="file://$ud_file"
  command -v cygpath >/dev/null && ud_uri="file://$(cygpath -m "$ud_file")"
  awsq ec2 run-instances \
    --image-id "$AMI_ID" --instance-type "$type" --key-name "$KEY_NAME" "$@" \
    --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=$disk,VolumeType=gp3,DeleteOnTermination=true}" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$name},{Key=Project,Value=$PROJECT_TAG}]" \
                         "ResourceType=volume,Tags=[{Key=Name,Value=$name},{Key=Project,Value=$PROJECT_TAG}]" \
    --user-data "$ud_uri" \
    --query 'Instances[0].[InstanceId,PrivateIpAddress]' --output text
  rm -f "$ud_file"
}

# ---------------------------------------------------------------- launch
# The control plane's network interface is created first so its private IP is known
# before anything boots: nodes need it to reach NATS, and the coordinator needs the
# nodes' IPs, so the order is ENI -> nodes -> control.
log "Reserving control-plane network interface in ${SUBNET_AZS[0]}"
read -r CONTROL_ENI CONTROL_PRIVATE_IP <<<"$(awsq ec2 create-network-interface \
  --subnet-id "${SUBNET_IDS[0]}" --groups "$SG_ID" --description "dmr control plane" \
  --tag-specifications "ResourceType=network-interface,Tags=[{Key=Project,Value=$PROJECT_TAG}]" \
  --query 'NetworkInterface.[NetworkInterfaceId,PrivateIpAddress]' --output text)"
aws ec2 associate-address --network-interface-id "$CONTROL_ENI" --allocation-id "$EIP_ALLOC" >/dev/null
echo "   $CONTROL_ENI  private $CONTROL_PRIVATE_IP  public $EIP"

declare -A NODE_PRIV
for i in 1 2 3; do
  log "Launching dmr-node-$i ($NODE_TYPE) in ${SUBNET_AZS[$((i-1))]}"
  read -r nid nip <<<"$(launch "dmr-node-$i" "$NODE_TYPE" "$NODE_DISK_GB" \
    "$(node_userdata "node-$i" "500$i" "$CONTROL_PRIVATE_IP")" \
    --subnet-id "${SUBNET_IDS[$((i-1))]}" --security-group-ids "$SG_ID" --associate-public-ip-address)"
  NODE_PRIV[$i]="$nip"
  echo "   $nid  private $nip"
done

log "Launching dmr-control ($CONTROL_TYPE) in ${SUBNET_AZS[0]}"
read -r CONTROL_ID _ <<<"$(launch dmr-control "$CONTROL_TYPE" 20 \
  "$(control_userdata "${NODE_PRIV[1]}" "${NODE_PRIV[2]}" "${NODE_PRIV[3]}")" \
  --network-interfaces "DeviceIndex=0,NetworkInterfaceId=$CONTROL_ENI")"
echo "   $CONTROL_ID"

# ---------------------------------------------------------------- wait for app
log "Instances are bootstrapping (installing Docker + building images). This takes ~5-10 min."
for _ in $(seq 1 90); do
  if curl -sf -m 5 "http://$EIP:4000/api/health" >/dev/null; then break; fi
  printf '.'; sleep 10
done
echo
if curl -sf -m 5 "http://$EIP:4000/api/health" >/dev/null; then
  log "Coordinator is healthy"
else
  echo "Coordinator not reachable yet. Check progress with:"
  echo "  ssh -i $KEY_FILE ubuntu@$EIP 'tail -f /var/log/dmr-bootstrap.log'"
fi

cat <<EOF

=====================================================================
 Dashboard     : http://$EIP:3000
 API           : http://$EIP:4000/api/health

 Control plane : $CONTROL_PRIVATE_IP  (${SUBNET_AZS[0]})   public $EIP
 node-1        : ${NODE_PRIV[1]}:5001 (${SUBNET_AZS[0]})
 node-2        : ${NODE_PRIV[2]}:5002 (${SUBNET_AZS[1]})
 node-3        : ${NODE_PRIV[3]}:5003 (${SUBNET_AZS[2]})

 SSH control   : ssh -i $KEY_FILE ubuntu@$EIP
 SSH a node    : ssh -i $KEY_FILE -J ubuntu@$EIP ubuntu@<node private ip>
 Replica files : ls -l /opt/dmr-data   (on each node)
 Boot logs     : /var/log/dmr-bootstrap.log (on each instance)

 Storage nodes may take a few extra minutes to appear ONLINE.
 Tear down     : bash deploy/aws/down.sh
=====================================================================
EOF
