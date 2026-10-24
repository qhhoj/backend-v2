#!/usr/bin/env bash
# resolve-ref.sh <ref>: prints sha=<commit> and tag=<image/release tag> for $GITHUB_OUTPUT.
# Empty ref = the highest v* tag. A ref that is exactly a vX.Y.Z tag keeps its name; anything else becomes sha-<12>.
# Only a commit on origin/main deploys: a branch, a SHA or a tag off main is refused.
set -euo pipefail
ref="${1:-}"
if [ -z "$ref" ]; then
  ref="$(git tag --list 'v*' --sort=-v:refname | head -1)"
  [ -n "$ref" ] || { echo "no v* tag" >&2; exit 1; }
fi
sha="$(git rev-parse --verify --quiet "$ref^{commit}")" || { echo "unknown ref: $ref" >&2; exit 1; }
git merge-base --is-ancestor "$sha" origin/main || { echo "not on origin/main: $ref ($sha)" >&2; exit 1; }
if [[ $ref =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then tag="$ref"; else tag="sha-${sha:0:12}"; fi
echo "sha=$sha"
echo "tag=$tag"
