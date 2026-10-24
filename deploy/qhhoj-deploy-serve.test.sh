#!/usr/bin/env bash
# deploy/qhhoj-deploy-serve.test.sh: the deploy user's dispatcher, as forced command and as login shell. A fake ssh runs
# it on a fake host root; real rsync and rrsync, stub sudo and logger. Needs rsync with rrsync, and python3.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
for tool in rsync rrsync python3; do
  command -v "$tool" > /dev/null || { echo "qhhoj-deploy-serve.test: $tool is not installed" >&2; exit 1; }
done
unset SSH_CONNECTION # the dispatcher ignores QHHOJ_DEPLOY_ROOT under sshd, so a test run over ssh would hit the real paths
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
bin="$work/bin" host="$work/host" calls="$work/calls" out="$work/out"
incoming="$host/var/lib/qhhoj-deploy/incoming"
export PATH="$bin:$PATH"
fail() { echo "FAIL: $*" >&2; cat "$out" "$calls" >&2 2>/dev/null || true; exit 1; }

mkdir -p "$bin" "$incoming" "$work/up"
# shellcheck disable=SC2016 # $* belongs to the stubs
for tool in logger sudo; do printf '#!/usr/bin/env bash\necho "%s $*" >> "%s"\n' "$tool" "$calls" > "$bin/$tool"; done
# fake ssh: drops its options and the host name, then runs the dispatcher with the rest as SSH_ORIGINAL_COMMAND
cat > "$bin/ssh" <<EOF
#!/usr/bin/env bash
while [ \$# -gt 0 ]; do case "\$1" in -[iloFp]) shift 2 ;; -*) shift ;; *) break ;; esac; done
shift
SSH_ORIGINAL_COMMAND="\$*" QHHOJ_DEPLOY_ROOT="$host" exec bash "$here/qhhoj-deploy-serve"
EOF
chmod +x "$bin"/*
serve() { SSH_ORIGINAL_COMMAND="$1" QHHOJ_DEPLOY_ROOT="$host" bash "$here/qhhoj-deploy-serve"; }
as_shell() { (unset SSH_ORIGINAL_COMMAND; QHHOJ_DEPLOY_ROOT="$host" bash "$here/qhhoj-deploy-serve" "$@"); }

# The helper, as the CD runs it (deploy/ci/remote-deploy.sh), with stdin passed through for --token-stdin.
: > "$calls"; serve 'sudo /usr/local/sbin/qhhoj-deploy backend v2.1.0 --token-stdin' > "$out" 2>&1 || fail "helper"
grep -qx 'sudo -n /usr/local/sbin/qhhoj-deploy backend v2.1.0 --token-stdin' "$calls" || fail "the helper runs through sudo"
: > "$calls"; as_shell -c 'sudo /usr/local/sbin/qhhoj-deploy frontend sha-0123456789ab' > "$out" 2>&1 || fail "as login shell"
grep -qx 'sudo -n /usr/local/sbin/qhhoj-deploy frontend sha-0123456789ab' "$calls" || fail "the login shell runs the helper"

# The upload, as the frontend deploy sends it (the full incoming path): lands in incoming/ only.
echo dist > "$work/up/frontend-dist-sha-1.tar.gz"; echo sum > "$work/up/frontend-dist-sha-1.tar.gz.sha256"
rsync -e ssh "$work/up/frontend-dist-sha-1.tar.gz" "$work/up/frontend-dist-sha-1.tar.gz.sha256" fakehost:/var/lib/qhhoj-deploy/incoming/ > "$out" 2>&1 \
  || fail "upload"
[ "$(cat "$incoming/frontend-dist-sha-1.tar.gz")" = dist ] && [ -f "$incoming/frontend-dist-sha-1.tar.gz.sha256" ] \
  || fail "the upload lands in incoming/"
for target in fakehost: fakehost:/var/lib/qhhoj-deploy/ fakehost:/var/lib/qhhoj-deploy/incoming/../x \
  fakehost:/var/lib/qhhoj-deploy/incoming/sub/; do
  rsync -e ssh "$work/up/frontend-dist-sha-1.tar.gz" "$target" > "$out" 2>&1 && fail "an upload to $target"
done
[ "$(find "$host" -name 'frontend-dist-*' | wc -l)" = 2 ] || fail "nothing lands outside incoming/"
rsync -e ssh fakehost:/var/lib/qhhoj-deploy/incoming/frontend-dist-sha-1.tar.gz "$work/back" > "$out" 2>&1 && fail "a download must be refused"
[ ! -e "$work/back" ] || fail "nothing is read back"

for command in '' ls 'bash -i' 'sudo -i' 'sudo /usr/local/sbin/qhhoj-deploy' 'sudo /bin/sh -c id' \
  'sudo /usr/local/sbin/qhhoj-deploy backend v1 ; id' 'sudo /usr/local/sbin/qhhoj-deploy backend $(id)' \
  'sudo /usr/local/sbin/qhhoj-deploy backend v1'$'\n''id' '/usr/lib/openssh/sftp-server' internal-sftp \
  'scp -t /var/lib/qhhoj-deploy/incoming/' 'rsync --server --sender -logDtpre.iLsfxCIvu . .'; do
  : > "$calls"; set +e; serve "$command" > "$out" 2>&1; rc=$?; set -e
  [ "$rc" = 1 ] || fail "'$command' must be refused (exit $rc)"
  grep -q 'logger -t qhhoj-deploy-serve -p auth.warning -- refused: ' "$calls" || fail "the refusal of '$command' is logged"
  grep -q '^sudo' "$calls" && fail "'$command' reached sudo"
done
as_shell > "$out" 2>&1 && fail "an interactive login must be refused"
as_shell -c 'id' > "$out" 2>&1 && fail "the login shell refuses other commands"
SSH_CONNECTION='192.0.2.1 50000 192.0.2.2 22' serve 'rsync --server -logDtpre.iLsfxCIvu . /var/lib/qhhoj-deploy/incoming/' \
  > "$out" 2>&1 \
  && fail "QHHOJ_DEPLOY_ROOT must be ignored under sshd"
echo "qhhoj-deploy-serve ok"
