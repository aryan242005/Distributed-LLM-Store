#!/usr/bin/env bash
# Live fault-tolerance demo against the AWS deployment created by deploy/aws/up.sh.
#
#   1. Upload a test model (replication factor 3) and wait until all 3 replicas are SYNCED
#   2. Power off the PRIMARY node's EC2 instance -> heartbeat marks it OFFLINE,
#      download still succeeds from a replica with an identical SHA-256
#   3. Power off a SECOND node -> only 1 of 3 copies left, download still succeeds
#   4. Power both back on -> nodes re-register over NATS, replicas are served again,
#      and downloads are load-balanced round-robin across all 3 nodes
#
# Usage (CloudShell or any shell with aws, curl, jq):
#   bash deploy/aws/demo-fault-tolerance.sh            # pauses between steps (for presenting)
#   AUTO=1 bash deploy/aws/demo-fault-tolerance.sh     # runs straight through
#   KEEP_MODEL=1 ...                                   # keep the test model afterwards
#
# If interrupted, any node this script powered off is powered back on.

set -euo pipefail
export MSYS_NO_PATHCONV=1
export AWS_PAGER=""

PROJECT_TAG="dmr"
TEST_SIZE_MB="${TEST_SIZE_MB:-20}"
AWS_REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null | tr -d '\r' || true)}"
AWS_REGION="${AWS_REGION:-ap-south-1}"
export AWS_DEFAULT_REGION="$AWS_REGION"

awsq() { aws "$@" | tr -d '\r'; }
step() { printf '\n\033[1;35m################ %s ################\033[0m\n' "$*"; }
log()  { printf '\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m[PASS] %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m[FAIL] %s\033[0m\n' "$*"; exit 1; }
pause() { [ -n "${AUTO:-}" ] || read -r -p $'\n(press Enter to continue) ' _; }

for bin in aws curl jq sha256sum; do
  command -v "$bin" >/dev/null || fail "'$bin' is required (AWS CloudShell has all of them)."
done

# ---------------------------------------------------------------- discover cluster
EIP=$(awsq ec2 describe-addresses --filters "Name=tag:Project,Values=$PROJECT_TAG" \
  --query 'Addresses[0].PublicIp' --output text)
[ "$EIP" != "None" ] || fail "No deployment found in $AWS_REGION. Run deploy/aws/up.sh first (same region)."
API="http://$EIP:4000/api"

instance_of() {  # node-N -> EC2 instance id
  awsq ec2 describe-instances \
    --filters "Name=tag:Project,Values=$PROJECT_TAG" "Name=tag:Name,Values=dmr-$1" \
    "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[0].Instances[0].InstanceId' --output text
}
declare -A INSTANCE
for n in node-1 node-2 node-3; do INSTANCE[$n]=$(instance_of "$n"); done

node_status() { curl -sf "$API/nodes" | jq -r --arg id "$1" '.data[] | select(.id==$id) | .status'; }

show_nodes() {
  printf '   %-8s %-8s %s\n' NODE STATUS ADDRESS
  curl -sf "$API/nodes" | jq -r '.data[] | "   \(.id)\t \(.status)\t \(.host):\(.port)"' | expand -t 10
}

show_replicas() {
  printf '   %-8s %-8s %-8s %s\n' NODE ROLE REPLICA "NODE STATUS"
  curl -sf "$API/replicas/model/$MODEL_ID" \
    | jq -r '.data | sort_by(.node_id)[] | "   \(.node_id)\t \(.role)\t \(.status)\t \(.node_status // "-")"' | expand -t 10
}

wait_node() {  # $1=node id  $2=ONLINE|OFFLINE ; prints how long detection took
  local start=$SECONDS
  until [ "$(node_status "$1")" = "$2" ]; do
    printf '.'; sleep 2
    [ $((SECONDS - start)) -lt 600 ] || fail "$1 did not become $2 within 10 minutes"
  done
  echo; log "Coordinator reports $1 = $2 after $((SECONDS - start))s"
}

STOPPED=()
power_off() {
  log "Powering off EC2 instance of $1 (${INSTANCE[$1]}) - simulating a machine crash"
  aws ec2 stop-instances --instance-ids "${INSTANCE[$1]}" --force >/dev/null
  STOPPED+=("$1")
}
power_on() {
  local ids=()
  for n in "$@"; do ids+=("${INSTANCE[$n]}"); done
  log "Waiting for instances to finish stopping, then powering on: $*"
  aws ec2 wait instance-stopped --instance-ids "${ids[@]}"
  aws ec2 start-instances --instance-ids "${ids[@]}" >/dev/null
}
restore_on_exit() {
  [ "${#STOPPED[@]}" -gt 0 ] || return 0
  echo; log "Restoring powered-off nodes: ${STOPPED[*]}"
  power_on "${STOPPED[@]}" || true
}
trap restore_on_exit EXIT

download_and_verify() {  # $1 = label
  local hdr out got serving
  hdr=$(mktemp); out=$(mktemp)
  curl -sf -D "$hdr" -o "$out" "$API/models/$MODEL_ID/download" || { rm -f "$hdr" "$out"; fail "$1: download failed"; }
  serving=$(grep -i '^x-serving-node:' "$hdr" | awk '{print $2}' | tr -d '\r')
  got=$(sha256sum "$out" | awk '{print $1}')
  rm -f "$hdr" "$out"
  if [ "$got" = "$LOCAL_SHA" ]; then
    ok "$1: served by $serving, SHA-256 matches (${got:0:16}...)"
  else
    fail "$1: served by $serving, SHA-256 MISMATCH ($got vs $LOCAL_SHA)"
  fi
  LAST_SERVING="$serving"
}

# ---------------------------------------------------------------- preflight
step "Cluster at $EIP ($AWS_REGION)"
curl -sf -m 5 "$API/health" >/dev/null || fail "Coordinator at $API is not reachable"
for n in node-1 node-2 node-3; do
  state=$(awsq ec2 describe-instances --instance-ids "${INSTANCE[$n]}" \
    --query 'Reservations[0].Instances[0].State.Name' --output text)
  if [ "$state" != "running" ]; then
    log "$n instance is $state; starting it first"
    [ "$state" = "stopping" ] && aws ec2 wait instance-stopped --instance-ids "${INSTANCE[$n]}"
    aws ec2 start-instances --instance-ids "${INSTANCE[$n]}" >/dev/null
  fi
done
for n in node-1 node-2 node-3; do [ "$(node_status "$n")" = ONLINE ] || wait_node "$n" ONLINE; done
show_nodes
ok "All 3 storage nodes ONLINE"
pause

# ---------------------------------------------------------------- 1. upload
step "STEP 1: Upload a model with replication factor 3"
TEST_FILE=$(mktemp --suffix=.bin)
head -c "$((TEST_SIZE_MB * 1024 * 1024))" /dev/urandom > "$TEST_FILE"
LOCAL_SHA=$(sha256sum "$TEST_FILE" | awk '{print $1}')
log "Generated ${TEST_SIZE_MB} MB test file, SHA-256 ${LOCAL_SHA:0:16}..."

RESP=$(curl -sf -F "file=@$TEST_FILE;filename=fault-tolerance-demo.bin" \
  -F "name=fault-tolerance-demo-$(date +%H%M%S)" -F "version=1.0" -F "replicationFactor=3" \
  -F "description=Created by demo-fault-tolerance.sh" "$API/models/upload") || fail "Upload failed"
rm -f "$TEST_FILE"
MODEL_ID=$(jq -r '.data.model.id' <<<"$RESP")
PRIMARY=$(jq -r '.data.primaryNode' <<<"$RESP")
log "Model $MODEL_ID stored on primary $PRIMARY; P2P replication to $(jq -r '.data.replicaNodes | join(", ")' <<<"$RESP")"

log "Waiting for peer-to-peer replication to finish"
start=$SECONDS
until [ "$(curl -sf "$API/replicas/model/$MODEL_ID" | jq '[.data[] | select(.status=="SYNCED")] | length')" = 3 ]; do
  printf '.'; sleep 2
  [ $((SECONDS - start)) -lt 300 ] || { echo; show_replicas; fail "Replicas did not all reach SYNCED"; }
done
echo
show_replicas
ok "3 identical copies on 3 machines in 3 availability zones"
download_and_verify "Baseline download"
pause

# ---------------------------------------------------------------- 2. primary fails
step "STEP 2: Crash the PRIMARY node ($PRIMARY)"
power_off "$PRIMARY"
log "Waiting for heartbeat-based failure detection"
wait_node "$PRIMARY" OFFLINE
show_nodes
download_and_verify "Download with primary down"
[ "$LAST_SERVING" != "$PRIMARY" ] || fail "Download was routed to the OFFLINE primary"
ok "Request was transparently re-routed away from the failed primary"
pause

# ---------------------------------------------------------------- 3. second failure
SECOND=$(curl -sf "$API/replicas/model/$MODEL_ID" \
  | jq -r --arg p "$PRIMARY" '[.data[] | select(.node_id != $p) | .node_id] | sort | .[0]')
step "STEP 3: Crash a SECOND node ($SECOND) - only 1 of 3 copies left"
power_off "$SECOND"
wait_node "$SECOND" OFFLINE
show_nodes
show_replicas
download_and_verify "Download with 2 of 3 nodes down"
pause

# ---------------------------------------------------------------- 4. recovery
step "STEP 4: Recover - power both nodes back on"
power_on "$PRIMARY" "$SECOND"
STOPPED=()
log "Nodes reboot, the storage container restarts and re-registers over NATS"
wait_node "$PRIMARY" ONLINE
wait_node "$SECOND" ONLINE
show_nodes
show_replicas
log "Downloading 3 times to show round-robin load balancing across recovered replicas"
SERVED=()
for i in 1 2 3; do download_and_verify "Download #$i"; SERVED+=("$LAST_SERVING"); done
ok "Served by: ${SERVED[*]} - data on disk survived the crash, no re-upload needed"

# ---------------------------------------------------------------- cleanup
if [ -z "${KEEP_MODEL:-}" ]; then
  curl -sf -X DELETE "$API/models/$MODEL_ID" >/dev/null && log "Deleted test model $MODEL_ID"
fi

step "Fault-tolerance demo complete"
cat <<EOF
 Shown:
  - Failure detection : coordinator heartbeats (gRPC GetStatus every 5s) marked crashed nodes OFFLINE
  - Failure masking   : downloads kept working with 1 and then 2 of 3 machines down
  - Data integrity    : every download matched the original SHA-256
  - Recovery          : restarted nodes re-registered over NATS and served their replicas again
 Known limitation: if all 3 replica nodes are down the model is unavailable, and lost
 replicas are not automatically re-created on other nodes.
 Open http://$EIP:3000 -> Requests & Logs to show the gRPC/NATS trace of the whole demo.
EOF
