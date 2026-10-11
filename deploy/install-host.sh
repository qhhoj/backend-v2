#!/usr/bin/env bash
# install-host.sh (root, idempotent): installs QHHOJ's own files on the v2 host from this deploy/ directory.
# Packages (podman, nginx, mongodb, redis, mongosh, mongodb-database-tools, rsync), secrets, TLS and the
# nginx site config stay manual (RUNBOOK "First install"). Never starts a service.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
ROOT="${QHHOJ_INSTALL_ROOT:-}"
ID=987

die() { echo "install-host: $*" >&2; exit 1; }

ensure_users() {
  if ! id qhhoj >/dev/null 2>&1; then
    getent group "$ID" >/dev/null && die "gid $ID is taken; pick a free id and rebuild the image with --build-arg QHHOJ_UID"
    getent passwd "$ID" >/dev/null && die "uid $ID is taken; pick a free id and rebuild the image with --build-arg QHHOJ_UID"
    groupadd -g "$ID" qhhoj
    useradd -u "$ID" -g "$ID" --system --home-dir /var/lib/qhhoj --create-home --shell /usr/sbin/nologin qhhoj
  fi
  id deploy >/dev/null 2>&1 || useradd --system --home-dir /home/deploy --create-home --shell /bin/bash deploy
  usermod -aG qhhoj www-data 2>/dev/null || usermod -aG qhhoj nginx 2>/dev/null || true
}

ensure_dirs() {
  install -d -m 2750 "$ROOT/srv/qhhoj"
  # nginx (group qhhoj) serves only media; every other tree stays owner-only so a web-server compromise cannot read hidden test data.
  install -d -m 2750 "$ROOT/srv/qhhoj/media"
  for dir in problem-data pdf-cache contest-data user-data; do install -d -m 2700 "$ROOT/srv/qhhoj/$dir"; done
  chown -R "$ID:$ID" "$ROOT/srv/qhhoj"
  install -d -m 700 "$ROOT/backup"
  # qhhoj-deploy (root) keeps its history here: root-owned; only incoming/ is writable by the deploy user
  install -d -m 755 "$ROOT/var/lib/qhhoj-deploy"
  chown root:root "$ROOT/var/lib/qhhoj-deploy"
  install -d -m 750 "$ROOT/var/lib/qhhoj-deploy/incoming"
  chown deploy:deploy "$ROOT/var/lib/qhhoj-deploy/incoming"
  install -d -m 755 "$ROOT/var/www/qhhoj/releases"
  install -d -m 755 "$ROOT/var/www/qhhoj-maintenance"
  install -d -m 700 "$ROOT/etc/qhhoj"
}

install_files() {
  install -d "$ROOT/usr/local/sbin" "$ROOT/etc/containers/systemd" "$ROOT/etc/systemd/system" "$ROOT/etc/sudoers.d" "$ROOT/etc/nginx/snippets"
  install -m 755 "$here/qhhoj-deploy" "$ROOT/usr/local/sbin/qhhoj-deploy"
  install -m 644 "$here"/quadlet/*.container "$ROOT/etc/containers/systemd/"
  install -m 644 "$here/quadlet/qhhoj.target" "$ROOT/etc/systemd/system/qhhoj.target"
  visudo -cf "$here/sudoers.qhhoj-deploy" >/dev/null || die "sudoers file does not parse"
  install -m 440 "$here/sudoers.qhhoj-deploy" "$ROOT/etc/sudoers.d/qhhoj-deploy"
  install -m 644 "$here/nginx/security-headers.conf" "$ROOT/etc/nginx/snippets/qhhoj-security-headers.conf"
  [ -f "$ROOT/etc/nginx/snippets/qhhoj-gate.conf" ] || install -m 644 "$here/nginx/qhhoj-gate.conf" "$ROOT/etc/nginx/snippets/qhhoj-gate.conf"
  install -m 644 "$here/nginx/maintenance.html" "$ROOT/var/www/qhhoj-maintenance/maintenance.html"
}

ensure_users
ensure_dirs
install_files
systemctl daemon-reload
systemctl enable qhhoj.target
echo "installed. Next: RUNBOOK \"First install\" steps for env, TLS, nginx site, GHCR auth."
