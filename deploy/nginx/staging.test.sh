#!/usr/bin/env bash
# deploy/nginx/staging.test.sh: qhhoj-staging.conf is make-staging.sh's output, and in a real nginx (container) next to
# qhhoj.conf it loads (no duplicate upstream or map), serves its own root, sends X-Robots-Tag on every kind of response
# and disallows everything in robots.txt, while the production host sends no X-Robots-Tag.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
diff <(bash "$here/make-staging.sh") "$here/qhhoj-staging.conf" > /dev/null \
  || { echo "FAIL: qhhoj-staging.conf is stale: bash deploy/nginx/make-staging.sh > deploy/nginx/qhhoj-staging.conf" >&2; exit 1; }
engine="$(command -v docker || command -v podman)" || { echo "FAIL: needs docker or podman" >&2; exit 1; }
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
mkdir -p "$work/conf.d" "$work/snippets" "$work/tls" "$work/www/qhhoj/current/assets" "$work/www/qhhoj-staging/current/assets"
openssl req -x509 -newkey rsa:2048 -nodes -subj /CN=test -keyout "$work/tls/k.pem" -out "$work/tls/c.pem" -days 1 2>/dev/null
cp "$here/cloudflare-origin.conf" "$work/conf.d/a-gate.conf"
cp "$here/login-limit.conf" "$work/conf.d/10-login-limit.conf"
cp "$here/api-cache.conf" "$work/conf.d/20-api-cache.conf"
for site in qhhoj qhhoj-staging; do
  sed -E 's#/etc/letsencrypt/live/[^/]+/fullchain.pem#/tls/c.pem#; s#/etc/letsencrypt/live/[^/]+/privkey.pem#/tls/k.pem#' \
    "$here/$site.conf" > "$work/conf.d/$site.conf"
  echo "<!doctype html>$site" > "$work/www/$site/current/index.html"; echo "js" > "$work/www/$site/current/assets/a.js"
done
cp "$here/security-headers.conf" "$work/snippets/qhhoj-security-headers.conf"
cp "$here/staging-headers.conf" "$work/snippets/qhhoj-staging-headers.conf"
cp "$here/qhhoj-gate.conf" "$work/snippets/qhhoj-gate.conf"
chmod -R a+rX "$work"
# Each line: host path status x-robots-tag body-first-line (the api is down, so /api answers nginx's own 502).
# shellcheck disable=SC2016 # expanded by the container's sh
results="$("$engine" run --rm -v "$work/conf.d:/etc/nginx/conf.d:ro" -v "$work/snippets:/etc/nginx/snippets:ro" \
  -v "$work/tls:/tls:ro" -v "$work/www:/var/www:ro" docker.io/library/nginx:1.27 sh -c '
  nginx -t -q 2>&1 && nginx || { echo "nginx failed to start" >&2; exit 1; }; sleep 0.5
  for request in "staging.qhhoj.com /" "staging.qhhoj.com /some/route" "staging.qhhoj.com /assets/a.js" \
                 "staging.qhhoj.com /api/internal/site" "staging.qhhoj.com /robots.txt" "oj.example.org /" "oj.example.org /robots.txt"; do
    set -- $request
    reply="$(printf "GET %s HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n" "$2" "$1" \
      | openssl s_client -quiet -connect 127.0.0.1:443 -servername "$1" 2>/dev/null | tr -d "\r")"
    status="$(echo "$reply" | head -1 | cut -d" " -f2)"
    robots="$(echo "$reply" | sed -n "1,/^$/p" | sed -n "s/^[Xx]-[Rr]obots-[Tt]ag: //p")"
    body="$(echo "$reply" | sed "1,/^$/d" | head -2 | tr "\n" "|")"
    echo "$1 $2 $status [${robots}] $body"
  done' 2>"$work/engine.err" | grep -E '^(staging.qhhoj.com|oj.example.org) ')" || { echo "FAIL: nginx did not run; container stderr:" >&2; cat "$work/engine.err" >&2; exit 1; }
expected='staging.qhhoj.com / 200 [noindex, nofollow] <!doctype html>qhhoj-staging|
staging.qhhoj.com /some/route 200 [noindex, nofollow] <!doctype html>qhhoj-staging|
staging.qhhoj.com /assets/a.js 200 [noindex, nofollow] js|
staging.qhhoj.com /api/internal/site 502 [noindex, nofollow] <html>|<head><title>502 Bad Gateway</title></head>|
staging.qhhoj.com /robots.txt 200 [noindex, nofollow] User-agent: *|Disallow: /|
oj.example.org / 200 [] <!doctype html>qhhoj|
oj.example.org /robots.txt 502 [] <html>|<head><title>502 Bad Gateway</title></head>|'
[ "$results" = "$expected" ] || { printf 'FAIL: staging answers\n%s\nexpected\n%s\n' "$results" "$expected" >&2; exit 1; }
echo "nginx staging ok"
