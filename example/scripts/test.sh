#!/usr/bin/env bash
# Runs the tests against a fresh AWS Emulator. The emulator keeps its state in memory, so every run
# starts empty. Extra arguments go to `bun test`, e.g. `npm test -- --watch`.
set -euo pipefail

PORT="${EMULATOR_PORT:-9297}"
CA="$HOME/.aws/emulator/$PORT/ca.pem"
LOG="${TMPDIR:-/tmp}/aws-emulator-$PORT.log"

if ! command -v aws-emulator >/dev/null; then
  echo "aws-emulator is not installed: open the project in its devcontainer, or see" >&2
  echo "https://docs.aws.amazon.com/emulator/latest/userguide/getting-started.html" >&2
  exit 1
fi

EMULATOR_TELEMETRY=off aws-emulator --bind 127.0.0.1 --port "$PORT" --telemetry off --auth off >"$LOG" 2>&1 &
EMULATOR_PID=$!
trap 'kill "$EMULATOR_PID" 2>/dev/null || true' EXIT

# The emulator writes a new certificate authority at each start: wait for it, and for the health route.
ready=false
for _ in $(seq 1 120); do
  if [ -f "$CA" ] && curl -fsS --cacert "$CA" "https://127.0.0.1:$PORT/__admin/health" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 0.5
done
if [ "$ready" != true ]; then
  echo "AWS Emulator did not start; its log:" >&2
  cat "$LOG" >&2
  exit 1
fi

export NODE_EXTRA_CA_CERTS="$CA"
export AWS_ENDPOINT_URL="https://127.0.0.1:$PORT"
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
unset AWS_PROFILE AWS_SESSION_TOKEN

bun test "$@"
