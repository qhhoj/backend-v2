#!/usr/bin/env bash
# Generates the TypeScript of the vendored contract into libs/judge-proto/src/generated (or into $1),
# with the protoc that grpc-tools pins and the ts-proto that package.json pins, so CI regenerates byte for byte.
set -euo pipefail
BACKEND="$(cd "$(dirname "$0")/../.." && pwd)"
LIB="$BACKEND/libs/judge-proto"
OUT="${1:-$LIB/src/generated}"
OPTIONS=outputServices=grpc-js,oneof=unions,forceLong=number,esModuleInterop=true,env=node,useOptionals=none,annotateFilesWithVersion=false
rm -rf "$OUT"
mkdir -p "$OUT"
"$BACKEND/node_modules/.bin/grpc_tools_node_protoc" \
  --plugin=protoc-gen-ts_proto="$BACKEND/node_modules/.bin/protoc-gen-ts_proto" \
  --ts_proto_out="$OUT" --ts_proto_opt="$OPTIONS" \
  -I "$LIB/proto" qhhoj/judge/v1/judge.proto
