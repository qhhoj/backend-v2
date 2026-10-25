#!/usr/bin/env bash
# deploy/nginx/gate.test.sh: cloudflare-origin.conf in a real nginx (container): a peer that is neither Cloudflare nor
# loopback is refused, except an ACME http-01 challenge on port 80.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
engine="$(command -v docker || command -v podman)" || { echo "FAIL: needs docker or podman" >&2; exit 1; }
conf="$(mktemp -d)"; trap 'rm -rf "$conf"' EXIT
cp "$here/cloudflare-origin.conf" "$conf/a-gate.conf"
cp "$here/api-cache.conf" "$conf/20-api-cache.conf"
# 8443 stands in for 443: any port but 80
echo 'server { listen 80; listen 8443; access_log off; location / { if ($qhhoj_refuse_origin) { return 403; } return 200; } }' > "$conf/b-site.conf"
chmod -R a+rX "$conf"
# Inside the container the peer of a request to the container's own address is that address: not Cloudflare, not loopback.
# shellcheck disable=SC2016 # expanded by the container's sh
results="$("$engine" run --rm -v "$conf:/etc/nginx/conf.d:ro" docker.io/library/nginx:1.27-alpine sh -c '
  nginx -t -q && nginx || exit 1
  ip=$(hostname -i | cut -d" " -f1)
  for target in "$ip:80/.well-known/acme-challenge/t" "$ip:8443/.well-known/acme-challenge/t" "$ip:80/" "127.0.0.1:8443/"; do
    code=$(wget -S -O /dev/null "http://$target" 2>&1 | sed -n "s/^ *HTTP\/1.1 \([0-9]*\).*/\1/p" | head -1)
    echo "${target#"$ip"} $code"
  done' 2>/dev/null)"
expected=':80/.well-known/acme-challenge/t 200
:8443/.well-known/acme-challenge/t 403
:80/ 403
127.0.0.1:8443/ 200'
[ "$results" = "$expected" ] || { printf 'FAIL: gate answers\n%s\nexpected\n%s\n' "$results" "$expected" >&2; exit 1; }
echo "nginx gate ok"
