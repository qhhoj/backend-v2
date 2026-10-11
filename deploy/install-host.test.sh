#!/usr/bin/env bash
# deploy/install-host.test.sh: install-host.sh into a fake root with stub user tools.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(mktemp -d)"; bin="$(mktemp -d)"; trap 'rm -rf "$root" "$bin"' EXIT
calls="$root/calls"
fail() { echo "FAIL: $*" >&2; cat "$calls" >&2; exit 1; }
stub() { printf '#!/usr/bin/env bash\necho "%s $*" >> "%s"\n%s\n' "$1" "$calls" "${2:-}" > "$bin/$1"; chmod +x "$bin/$1"; }
fresh() {
  rm -rf "${root:?}"/*; : > "$calls"
  for tool in groupadd useradd usermod systemctl chown chgrp; do stub "$tool"; done
  stub visudo 'true'
  stub getent '[ "${STUB_TAKEN:-}" = "$2" ] && echo "other:x:$2:"; [ "${STUB_TAKEN:-}" = "$2" ]'
  stub id 'exit 1'
}
install_host() { PATH="$bin:$PATH" QHHOJ_INSTALL_ROOT="$root" bash "$here/install-host.sh"; }

fresh; install_host >/dev/null || fail "install"
for f in usr/local/sbin/qhhoj-deploy etc/containers/systemd/qhhoj-api.container \
  etc/containers/systemd/qhhoj-worker.container etc/containers/systemd/qhhoj-bridge.container \
  etc/systemd/system/qhhoj.target etc/sudoers.d/qhhoj-deploy etc/nginx/snippets/qhhoj-gate.conf var/www/qhhoj-maintenance/maintenance.html; do
  [ -f "$root/$f" ] || fail "missing $f"
done
[ "$(stat -c %a "$root/etc/sudoers.d/qhhoj-deploy")" = 440 ] || fail "sudoers mode"
[ "$(stat -c %a "$root/var/www/qhhoj-maintenance/maintenance.html")" = 644 ] || fail "maintenance page mode"
[ "$(stat -c %a "$root/srv/qhhoj")" = 2750 ] || fail "data root mode"
[ "$(stat -c %a "$root/srv/qhhoj/media")" = 2750 ] || fail "media must be group-readable for nginx"
[ "$(stat -c %a "$root/srv/qhhoj/problem-data")" = 2750 ] || fail "problem-data must be group-readable for the local judge"
for d in pdf-cache contest-data user-data; do [ "$(stat -c %a "$root/srv/qhhoj/$d")" = 2700 ] || fail "$d must not be group-readable"; done
for d in media problem-data pdf-cache contest-data user-data; do [ -d "$root/srv/qhhoj/$d" ] || fail "missing $d"; done
grep -q "useradd .*--home-dir /home/deploy" "$calls" || fail "deploy home outside the root-owned state dir"
grep -q "chown root:root $root/var/lib/qhhoj-deploy\$" "$calls" || fail "state dir root-owned"
[ -d "$root/var/lib/qhhoj-deploy/incoming" ] || fail "incoming dirs"
grep -q "groupadd -g 987 qhhoj" "$calls" && grep -q "useradd -u 987" "$calls" || fail "qhhoj 987"
grep -q "systemctl daemon-reload" "$calls" && grep -q "systemctl enable qhhoj.target" "$calls" || fail "systemd"
grep -q "systemctl start" "$calls" && fail "must not start services"

echo "# edited" > "$root/etc/nginx/snippets/qhhoj-gate.conf"; install_host >/dev/null
grep -q edited "$root/etc/nginx/snippets/qhhoj-gate.conf" || fail "gate snippet is kept on re-install"

fresh; STUB_TAKEN=987 install_host >/dev/null 2>&1 && fail "uid 987 taken by another user must refuse"
echo "install-host ok"
