#!/usr/bin/env bash
# deploy/nginx/redirects.test.sh: the legacy redirects (/problem/<code>/pdf, /url/<code>) in qhhoj.conf, in a real nginx
# (container): a code redirects, a path with control bytes in the code never adds a response header.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
engine="$(command -v docker || command -v podman)" || { echo "FAIL: needs docker or podman" >&2; exit 1; }
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
mkdir -p "$work/conf.d" "$work/snippets" "$work/tls" "$work/www/current"
openssl req -x509 -newkey rsa:2048 -nodes -subj /CN=oj.example.org -keyout "$work/tls/k.pem" -out "$work/tls/c.pem" -days 1 2>/dev/null
cp "$here/cloudflare-origin.conf" "$work/conf.d/a-gate.conf"
sed -e 's#/etc/letsencrypt/live/oj.example.org/fullchain.pem#/tls/c.pem#; s#/etc/letsencrypt/live/oj.example.org/privkey.pem#/tls/k.pem#' \
  "$here/qhhoj.conf" > "$work/conf.d/qhhoj.conf"
cp "$here/security-headers.conf" "$work/snippets/qhhoj-security-headers.conf"
cp "$here/qhhoj-gate.conf" "$work/snippets/qhhoj-gate.conf"
echo '<!doctype html>spa' > "$work/www/current/index.html"
chmod -R a+rX "$work"
# shellcheck disable=SC2016 # expanded by the container's sh
results="$("$engine" run --rm -v "$work/conf.d:/etc/nginx/conf.d:ro" -v "$work/snippets:/etc/nginx/snippets:ro" \
  -v "$work/tls:/tls:ro" -v "$work/www:/var/www/qhhoj:ro" docker.io/library/nginx:1.27 sh -c '
  nginx -t -q && nginx || exit 1; sleep 0.5
  for path in "/url/my-link" "/problem/aplusb/pdf" "/problem/aplusb/pdf/vi" \
              "/url/a%0d%0aX-Injected:%20yes" "/problem/x%0d%0aX-Injected:%20yes/pdf" "/problem/x%0d%0aX-Injected:%20yes/pdf/en"; do
    printf "GET %s HTTP/1.1\r\nHost: oj.example.org\r\nConnection: close\r\n\r\n" "$path" \
      | openssl s_client -quiet -connect 127.0.0.1:443 -servername oj.example.org 2>/dev/null \
      | sed -n "1,/^\r$/p" | tr -d "\r" | grep -ciE "^X-Injected:" | sed "s#^#$path injected-headers #"
  done' 2>/dev/null | grep injected-headers)"
expected='/url/my-link injected-headers 0
/problem/aplusb/pdf injected-headers 0
/problem/aplusb/pdf/vi injected-headers 0
/url/a%0d%0aX-Injected:%20yes injected-headers 0
/problem/x%0d%0aX-Injected:%20yes/pdf injected-headers 0
/problem/x%0d%0aX-Injected:%20yes/pdf/en injected-headers 0'
[ "$results" = "$expected" ] || { printf 'FAIL: redirects\n%s\nexpected\n%s\n' "$results" "$expected" >&2; exit 1; }
echo "nginx redirects ok"
