#!/usr/bin/env bash
# Tears down everything created by deploy/aws/up.sh (all resources tagged Project=dmr):
# EC2 instances, Elastic IP, security group, and the dmr-key key pair.
#
# Usage: bash deploy/aws/down.sh

set -euo pipefail
export MSYS_NO_PATHCONV=1
export AWS_PAGER=""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_TAG="dmr"
KEY_NAME="dmr-key"
SG_NAME="dmr-sg"
AWS_REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null | tr -d '\r' || true)}"
AWS_REGION="${AWS_REGION:-ap-south-1}"
export AWS_DEFAULT_REGION="$AWS_REGION"

awsq() { aws "$@" | tr -d '\r'; }
log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

INSTANCES=$(awsq ec2 describe-instances \
  --filters "Name=tag:Project,Values=$PROJECT_TAG" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[].Instances[].InstanceId' --output text)
EIPS=$(awsq ec2 describe-addresses --filters "Name=tag:Project,Values=$PROJECT_TAG" \
  --query 'Addresses[].AllocationId' --output text)

echo "Region: $AWS_REGION"
echo "This will permanently delete:"
echo "  instances : ${INSTANCES:-none}  (all stored models are lost)"
echo "  elastic IP: ${EIPS:-none}"
echo "  security group $SG_NAME, key pair $KEY_NAME"
read -r -p "Type 'yes' to continue: " ans
[ "$ans" = "yes" ] || exit 1

if [ -n "$INSTANCES" ]; then
  log "Terminating instances"
  # shellcheck disable=SC2086
  aws ec2 terminate-instances --instance-ids $INSTANCES >/dev/null
  # shellcheck disable=SC2086
  aws ec2 wait instance-terminated --instance-ids $INSTANCES
fi

for alloc in $EIPS; do
  log "Releasing Elastic IP $alloc"
  assoc=$(awsq ec2 describe-addresses --allocation-ids "$alloc" --query 'Addresses[0].AssociationId' --output text)
  [ "$assoc" != "None" ] && aws ec2 disassociate-address --association-id "$assoc" || true
  aws ec2 release-address --allocation-id "$alloc"
done

# The control plane's ENI was created separately, so it outlives instance termination
for eni in $(awsq ec2 describe-network-interfaces --filters "Name=tag:Project,Values=$PROJECT_TAG" \
    --query 'NetworkInterfaces[].NetworkInterfaceId' --output text); do
  log "Deleting network interface $eni"
  aws ec2 wait network-interface-available --network-interface-ids "$eni"
  aws ec2 delete-network-interface --network-interface-id "$eni"
done

# Root volumes are DeleteOnTermination, but sweep any that were left detached
for vol in $(awsq ec2 describe-volumes --filters "Name=tag:Project,Values=$PROJECT_TAG" Name=status,Values=available \
    --query 'Volumes[].VolumeId' --output text); do
  log "Deleting leftover volume $vol"
  aws ec2 delete-volume --volume-id "$vol"
done

SG_ID=$(awsq ec2 describe-security-groups --filters "Name=group-name,Values=$SG_NAME" \
  --query 'SecurityGroups[0].GroupId' --output text)
if [ "$SG_ID" != "None" ]; then
  log "Deleting security group $SG_ID"
  aws ec2 delete-security-group --group-id "$SG_ID"
fi

if aws ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
  log "Deleting key pair $KEY_NAME"
  aws ec2 delete-key-pair --key-name "$KEY_NAME"
  rm -f "$SCRIPT_DIR/$KEY_NAME.pem"
fi

log "Verifying nothing billable is left"
left_inst=$(awsq ec2 describe-instances --filters "Name=tag:Project,Values=$PROJECT_TAG" \
  "Name=instance-state-name,Values=pending,running,stopping,stopped" --query 'Reservations[].Instances[].InstanceId' --output text)
left_eip=$(awsq ec2 describe-addresses --filters "Name=tag:Project,Values=$PROJECT_TAG" --query 'Addresses[].PublicIp' --output text)
left_vol=$(awsq ec2 describe-volumes --filters "Name=tag:Project,Values=$PROJECT_TAG" --query 'Volumes[].VolumeId' --output text)
left_eni=$(awsq ec2 describe-network-interfaces --filters "Name=tag:Project,Values=$PROJECT_TAG" --query 'NetworkInterfaces[].NetworkInterfaceId' --output text)
if [ -z "$left_inst$left_eip$left_vol$left_eni" ]; then
  log "Done. Nothing from this deployment is left in $AWS_REGION."
else
  echo "Still present -> instances: ${left_inst:-none} | EIPs: ${left_eip:-none} | volumes: ${left_vol:-none} | ENIs: ${left_eni:-none}"
  echo "Re-run this script, or delete them in the EC2 console."
  exit 1
fi
