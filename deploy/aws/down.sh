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
  aws ec2 delete-network-interface --network-interface-id "$eni"
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

log "Done. Nothing from this deployment is left running."
