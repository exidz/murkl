#!/bin/bash
cd /home/exidz/.openclaw/workspace/murkl/relayer
export RPC_URL=http://127.0.0.1:8899
exec npx tsx src/index.ts
