#!/usr/bin/env bash
set -euo pipefail

# E2E on Surfpool (devnet datasource) to validate prover/verifier/relayer all match
# before touching devnet program deployments.
#
# Usage:
#   cd /home/exidz/.openclaw/workspace/murkl
#   bash scripts/e2e-recipient-binding-surfpool.sh
#
# Notes:
# - Starts Surfpool locally on :8899 (RPC) / :8900 (WS)
# - Deploys local-built programs (stark-verifier + murkl) into Surfpool
# - Starts local relayer on :3001 pointing at Surfpool RPC
# - Runs scripts/e2e-recipient-binding.ts against the local relayer + Surfpool

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SURFPOOL_RPC="http://127.0.0.1:8899"
RELAYER_URL="http://127.0.0.1:3002"

STARK_PROGRAM_KP="/home/exidz/.openclaw/.secrets/StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw.json"
MURKL_PROGRAM_KP="/home/exidz/.openclaw/.secrets/muRkDGaY4yCc6rEYWhmJAnQ1abdCbUJNCr4L1Cmd1UF.json"

cleanup() {
  set +e
  if [[ -n "${RELAYER_PID:-}" ]] && kill -0 "$RELAYER_PID" 2>/dev/null; then
    kill "$RELAYER_PID" 2>/dev/null || true
  fi
  if [[ -n "${SURFPOOL_PID:-}" ]] && kill -0 "$SURFPOOL_PID" 2>/dev/null; then
    kill "$SURFPOOL_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

cd "$ROOT_DIR"

echo "==> Starting Surfpool (datasource=devnet) on $SURFPOOL_RPC"
# -y will auto-generate runbooks/manifest if missing.
# --no-deploy because we will deploy explicitly using solana/anchor.
# --no-tui to avoid interactive UI.
surfpool start --network devnet --port 8899 --ws-port 8900 --no-tui --no-studio --no-deploy -y --log-level warn &
SURFPOOL_PID=$!

# Wait for Surfpool RPC to be ready
for i in {1..60}; do
  if solana cluster-version --url "$SURFPOOL_RPC" >/dev/null 2>&1; then
    echo "==> Surfpool RPC is up"
    break
  fi
  sleep 1
  if [[ $i -eq 60 ]]; then
    echo "❌ Surfpool RPC did not become ready in time" >&2
    exit 1
  fi
done

echo "==> Building programs"
# anchor build only supports a single -p at a time
anchor build -p stark-verifier >/dev/null
anchor build -p murkl_program >/dev/null

echo "==> Deploying stark-verifier into Surfpool"
solana program deploy --url "$SURFPOOL_RPC" programs/target/deploy/stark_verifier.so --program-id "$STARK_PROGRAM_KP" >/dev/null

echo "==> Deploying murkl into Surfpool"
solana program deploy --url "$SURFPOOL_RPC" programs/target/deploy/murkl_program.so --program-id "$MURKL_PROGRAM_KP" >/dev/null

echo "==> Starting local relayer on :3002 (RPC_URL=$SURFPOOL_RPC)"
(
  cd relayer
  NODE_ENV=development PORT=3002 RPC_URL="$SURFPOOL_RPC" PROGRAM_ID=muRkDGaY4yCc6rEYWhmJAnQ1abdCbUJNCr4L1Cmd1UF node dist/index.js
) &
RELAYER_PID=$!

# Wait for relayer to be ready
for i in {1..30}; do
  if curl -fsS "$RELAYER_URL/health" >/dev/null 2>&1; then
    echo "==> Relayer is up"
    break
  fi
  sleep 1
  if [[ $i -eq 30 ]]; then
    echo "❌ Relayer did not become ready in time" >&2
    exit 1
  fi
done

echo "==> Running E2E recipient-binding test"
RELAYER_URL="$RELAYER_URL" RPC_URL="$SURFPOOL_RPC" npx tsx scripts/e2e-recipient-binding.ts

echo "✅ Surfpool E2E completed"
