#!/usr/bin/env bash
set -euo pipefail

# E2E on Surfpool to validate prover/verifier/relayer all match
# before touching devnet program deployments.
#
# Usage:
#   cd /home/exidz/.openclaw/workspace/murkl
#   bash scripts/e2e-recipient-binding-surfpool.sh
#
# Tunables (optional env vars):
# - SURFPOOL_PORT (default 8899)
# - SURFPOOL_WS_PORT (default 8900)
# - SURFPOOL_STUDIO_PORT (default 18488)
# - RELAYER_PORT (default 3002)
# - SURFPOOL_DATASOURCE_RPC_URL (optional) override upstream datasource RPC (instead of --network devnet)
# - SURFPOOL_DATASOURCE_RPC_URL_FILE (optional) file containing the upstream RPC URL (preferred; avoids leaking in shell history)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SURFPOOL_PORT="${SURFPOOL_PORT:-8899}"
SURFPOOL_WS_PORT="${SURFPOOL_WS_PORT:-8900}"
SURFPOOL_STUDIO_PORT="${SURFPOOL_STUDIO_PORT:-18488}"
RELAYER_PORT="${RELAYER_PORT:-3002}"

SURFPOOL_RPC="http://127.0.0.1:${SURFPOOL_PORT}"
RELAYER_URL="http://127.0.0.1:${RELAYER_PORT}"

# Cron/daemon environments may not load shell profile PATH.
SOLANA_BIN="${SOLANA_BIN:-$HOME/.local/share/solana/install/active_release/bin/solana}"
ANCHOR_BIN="${ANCHOR_BIN:-$HOME/.cargo/bin/anchor}"

if [[ ! -x "$SOLANA_BIN" ]]; then
  echo "❌ solana CLI not found at $SOLANA_BIN (set SOLANA_BIN)" >&2
  exit 1
fi
if [[ ! -x "$ANCHOR_BIN" ]]; then
  echo "❌ anchor not found at $ANCHOR_BIN (set ANCHOR_BIN)" >&2
  exit 1
fi

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

port_is_free() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ! ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${port}$"
    return
  fi
  if command -v lsof >/dev/null 2>&1; then
    ! lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi
  return 0
}

cd "$ROOT_DIR"

# If default ports are taken (common in cron), slide to the next free trio.
if ! port_is_free "$SURFPOOL_PORT" || ! port_is_free "$SURFPOOL_WS_PORT" || ! port_is_free "$SURFPOOL_STUDIO_PORT"; then
  for _try in {1..40}; do
    SURFPOOL_PORT=$((SURFPOOL_PORT + 10))
    SURFPOOL_WS_PORT=$((SURFPOOL_WS_PORT + 10))
    SURFPOOL_STUDIO_PORT=$((SURFPOOL_STUDIO_PORT + 10))
    if port_is_free "$SURFPOOL_PORT" && port_is_free "$SURFPOOL_WS_PORT" && port_is_free "$SURFPOOL_STUDIO_PORT"; then
      break
    fi
  done
fi

SURFPOOL_RPC="http://127.0.0.1:${SURFPOOL_PORT}"
RELAYER_URL="http://127.0.0.1:${RELAYER_PORT}"

TMP_DIR="$ROOT_DIR/.tmp"
mkdir -p "$TMP_DIR"
SURFPOOL_LOG="$TMP_DIR/surfpool-${SURFPOOL_PORT}.log"

SURFPOOL_DATASOURCE=""
if [[ -n "${SURFPOOL_DATASOURCE_RPC_URL_FILE:-}" ]]; then
  if [[ ! -f "$SURFPOOL_DATASOURCE_RPC_URL_FILE" ]]; then
    echo "❌ SURFPOOL_DATASOURCE_RPC_URL_FILE not found: $SURFPOOL_DATASOURCE_RPC_URL_FILE" >&2
    exit 1
  fi
  # trim whitespace/newlines
  SURFPOOL_DATASOURCE="$(tr -d '\r\n\t ' < "$SURFPOOL_DATASOURCE_RPC_URL_FILE")"
elif [[ -n "${SURFPOOL_DATASOURCE_RPC_URL:-}" ]]; then
  SURFPOOL_DATASOURCE="$SURFPOOL_DATASOURCE_RPC_URL"
fi

if [[ -n "$SURFPOOL_DATASOURCE" ]]; then
  # Some datasource URLs include auth query params (e.g., Helius). Surfpool may not
  # preserve the query string internally, so prefer the base origin.
  if [[ "$SURFPOOL_DATASOURCE" == https://devnet.helius-rpc.com/*\?api-key=* ]]; then
    SURFPOOL_DATASOURCE="https://devnet.helius-rpc.com"
  fi

  echo "==> Starting Surfpool (custom datasource) on $SURFPOOL_RPC"
  SURFPOOL_UPSTREAM_ARGS=(--rpc-url "$SURFPOOL_DATASOURCE")
else
  echo "==> Starting Surfpool (datasource=devnet) on $SURFPOOL_RPC"
  SURFPOOL_UPSTREAM_ARGS=(--network devnet)
fi

set +e
surfpool start "${SURFPOOL_UPSTREAM_ARGS[@]}" \
  --port "$SURFPOOL_PORT" \
  --ws-port "$SURFPOOL_WS_PORT" \
  --studio-port "$SURFPOOL_STUDIO_PORT" \
  --no-tui \
  --no-deploy \
  -y \
  --log-level warn >"$SURFPOOL_LOG" 2>&1 &
SURFPOOL_PID=$!
set -e

sleep 0.5
if ! kill -0 "$SURFPOOL_PID" 2>/dev/null; then
  echo "❌ Surfpool failed to start (ports may be in use)." >&2
  echo "(See $SURFPOOL_LOG)" >&2
  exit 1
fi

# Wait for Surfpool RPC to be ready
for i in {1..120}; do
  if curl -fsS "$SURFPOOL_RPC" -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' >/dev/null 2>&1; then
    echo "==> Surfpool RPC is up"
    break
  fi
  sleep 1
  if [[ $i -eq 120 ]]; then
    echo "❌ Surfpool RPC did not become ready in time" >&2
    echo "(See $SURFPOOL_LOG)" >&2
    exit 1
  fi
done

echo "==> Building programs"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
mkdir -p "$ROOT_DIR/programs/target"

"$ANCHOR_BIN" build -p stark-verifier >/dev/null
"$ANCHOR_BIN" build -p murkl_program >/dev/null

# Avoid solana CLI printing an ephemeral deploy mnemonic by providing explicit buffer signers.
BUFFER_STARK="$TMP_DIR/surfpool-buffer-stark.json"
BUFFER_MURKL="$TMP_DIR/surfpool-buffer-murkl.json"

if [[ ! -f "$BUFFER_STARK" ]]; then
  solana-keygen new --no-bip39-passphrase --silent -o "$BUFFER_STARK" >/dev/null 2>&1
fi
if [[ ! -f "$BUFFER_MURKL" ]]; then
  solana-keygen new --no-bip39-passphrase --silent -o "$BUFFER_MURKL" >/dev/null 2>&1
fi

echo "==> Deploying stark-verifier into Surfpool"
"$SOLANA_BIN" program deploy --url "$SURFPOOL_RPC" \
  --buffer "$BUFFER_STARK" \
  programs/target/deploy/stark_verifier.so \
  --program-id "$STARK_PROGRAM_KP" >/dev/null 2>&1

echo "==> Deploying murkl into Surfpool"
"$SOLANA_BIN" program deploy --url "$SURFPOOL_RPC" \
  --buffer "$BUFFER_MURKL" \
  programs/target/deploy/murkl_program.so \
  --program-id "$MURKL_PROGRAM_KP" >/dev/null 2>&1

echo "==> Starting local relayer on :$RELAYER_PORT (RPC_URL=$SURFPOOL_RPC)"
(
  cd relayer
  NODE_ENV=development PORT="$RELAYER_PORT" RPC_URL="$SURFPOOL_RPC" PROGRAM_ID=muRkDGaY4yCc6rEYWhmJAnQ1abdCbUJNCr4L1Cmd1UF node dist/index.js
) &
RELAYER_PID=$!

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
if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  echo "==> Installing root deps (npm ci)"
  npm ci >/dev/null
fi

RELAYER_URL="$RELAYER_URL" RPC_URL="$SURFPOOL_RPC" npx tsx scripts/e2e-recipient-binding.ts

echo "✅ Surfpool E2E completed"
