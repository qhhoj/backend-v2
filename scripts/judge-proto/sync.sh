#!/usr/bin/env bash
# Vendors judge-v2's proto/ at a tag: copies it into libs/judge-proto/proto, writes proto.lock.json and
# regenerates the TypeScript. Usage: npm run judge-proto:sync -- <judge-v2 checkout> <tag>
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: $0 <judge-v2 checkout> <tag>" >&2; exit 1; }
SOURCE="$(cd "$1" && pwd)"
TAG="$2"
BACKEND="$(cd "$(dirname "$0")/../.." && pwd)"
LIB="$BACKEND/libs/judge-proto"
COMMIT="$(git -C "$SOURCE" rev-parse --verify "$TAG^{commit}")"
rm -rf "$LIB/proto"
git -C "$SOURCE" archive --format=tar "$COMMIT" proto | tar -x -C "$LIB"
node "$BACKEND/scripts/judge-proto/lock.js" write "$TAG" "$COMMIT"
bash "$BACKEND/scripts/judge-proto/generate.sh"
echo "vendored judge-v2 proto at $TAG ($COMMIT)"
