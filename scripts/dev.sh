#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Load .env
if [ -f .env ]; then
  set -a; source .env; set +a
fi

# Resolve OCI runtime (podman > docker)
resolve_oci() {
  if command -v podman &>/dev/null; then
    OCI="podman"
    OCI_COMPOSE="podman compose"
    if ! podman info &>/dev/null 2>&1; then
      echo "Starting podman machine..."
      podman machine start 2>/dev/null || true
      until podman info &>/dev/null 2>&1; do sleep 1; done
    fi
  elif command -v docker &>/dev/null; then
    OCI="docker"
    OCI_COMPOSE="docker compose"
    if ! docker info &>/dev/null 2>&1; then
      echo "Starting Docker..."
      open -a Docker 2>/dev/null || systemctl start docker 2>/dev/null || true
      until docker info &>/dev/null 2>&1; do sleep 1; done
    fi
  else
    echo "Error: no OCI runtime found (need podman or docker)" >&2; exit 1
  fi
  echo "Using $OCI runtime"
}
resolve_oci

API_PORT="${API_PORT:-40042}"
DASHBOARD_PORT="${DASHBOARD_PORT:-40043}"

# Kill only server processes LISTENING on our ports (not clients like Chrome/VS Code)
for port in "$API_PORT" "$DASHBOARD_PORT"; do
  pids=$(lsof -ti :"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "Killing server(s) listening on port $port: $pids"
    echo "$pids" | xargs kill 2>/dev/null || true
    sleep 0.5
  fi
done

# Ensure infra containers are up (dragonfly + openobserve)
$OCI_COMPOSE up -d dragonfly openobserve

# Wait for dragonfly health
echo "Waiting for DragonflyDB..."
until $OCI_COMPOSE exec -T dragonfly redis-cli ping 2>/dev/null | grep -q PONG; do
  sleep 1
done
echo "DragonflyDB ready"

# Flush stale locks so workers can re-acquire on fresh start
echo "Clearing stale locks..."
$OCI_COMPOSE exec -T dragonfly redis-cli --no-auth-warning keys "btr:*:lock" 2>/dev/null \
  | while read -r key; do
      $OCI_COMPOSE exec -T dragonfly redis-cli --no-auth-warning del "$key" >/dev/null 2>&1
      echo "  deleted $key"
    done
# Also clear restarting flags
$OCI_COMPOSE exec -T dragonfly redis-cli --no-auth-warning keys "btr:*:restarting" 2>/dev/null \
  | while read -r key; do
      $OCI_COMPOSE exec -T dragonfly redis-cli --no-auth-warning del "$key" >/dev/null 2>&1
    done

# Wait for OpenObserve health
echo "Waiting for OpenObserve..."
until curl -sf http://localhost:5080/healthz >/dev/null 2>&1; do
  sleep 2
done
echo "OpenObserve ready"

# Start backend (orchestrator + API) and frontend in parallel
echo "Starting backend (orchestrator + API) on port $API_PORT..."
bun --watch src/index.ts &
BACK_PID=$!

echo "Starting dashboard on port $DASHBOARD_PORT..."
bun run --cwd dashboard dev &
FRONT_PID=$!

# Forward signals for clean shutdown
cleanup() {
  echo "Shutting down..."
  kill "$BACK_PID" "$FRONT_PID" 2>/dev/null || true
  wait "$BACK_PID" "$FRONT_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait
