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
# The staging frontend (frontend-v2 deploys from its staging branch): the same helper, the helper checks the words.
: > "$calls"; serve 'sudo /usr/local/sbin/qhhoj-deploy frontend-staging sha-0123456789ab' > "$out" 2>&1 || fail "staging helper"
grep -qx 'sudo -n /usr/local/sbin/qhhoj-deploy frontend-staging sha-0123456789ab' "$calls" || fail "the staging deploy runs the helper"

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
# The staging key (RUNBOOK "Staging frontend" step 6): sshd runs the login shell (the dispatcher) with -c and the forced
# command, SSH_ORIGINAL_COMMAND holding the client's command.
FORCED_STAGING='/usr/local/sbin/qhhoj-deploy-serve --staging-only'
staging() { SSH_ORIGINAL_COMMAND="$1" QHHOJ_DEPLOY_ROOT="$host" bash "$here/qhhoj-deploy-serve" -c "$FORCED_STAGING"; }
cat > "$bin/ssh-staging" <<EOF
#!/usr/bin/env bash
while [ \$# -gt 0 ]; do case "\$1" in -[iloFp]) shift 2 ;; -*) shift ;; *) break ;; esac; done
shift
SSH_ORIGINAL_COMMAND="\$*" QHHOJ_DEPLOY_ROOT="$host" exec bash "$here/qhhoj-deploy-serve" -c "$FORCED_STAGING"
EOF
chmod +x "$bin/ssh-staging"
for command in 'sudo /usr/local/sbin/qhhoj-deploy frontend-staging sha-0123456789ab' \
  'sudo /usr/local/sbin/qhhoj-deploy frontend-staging v2.1.0' 'sudo /usr/local/sbin/qhhoj-deploy rollback frontend-staging'; do
  : > "$calls"; staging "$command" > "$out" 2>&1 || fail "staging key: '$command'"
  grep -qx "sudo -n ${command#sudo }" "$calls" || fail "the staging key runs '$command'"
done
: > "$calls"; SSH_ORIGINAL_COMMAND='sudo /usr/local/sbin/qhhoj-deploy frontend sha-0123456789ab' QHHOJ_DEPLOY_ROOT="$host" \
  bash "$here/qhhoj-deploy-serve" --staging-only > "$out" 2>&1 && fail "--staging-only as a plain argument must restrict too"
grep -q '^sudo' "$calls" && fail "--staging-only as a plain argument reached sudo"
for command in 'sudo /usr/local/sbin/qhhoj-deploy frontend sha-0123456789ab' 'sudo /usr/local/sbin/qhhoj-deploy backend v2.1.0' \
  'sudo /usr/local/sbin/qhhoj-deploy backend v2.1.0 --force' 'sudo /usr/local/sbin/qhhoj-deploy rollback backend' \
  'sudo /usr/local/sbin/qhhoj-deploy rollback frontend' 'sudo /usr/local/sbin/qhhoj-deploy status' \
  'sudo /usr/local/sbin/qhhoj-deploy frontend-staging ../../x' 'sudo /usr/local/sbin/qhhoj-deploy frontend-staging sha-0123456789ab --force' \
  'sudo /usr/local/sbin/qhhoj-deploy frontend-staging sha-0123456789ab frontend' 'sudo /usr/local/sbin/qhhoj-deploy frontend-staging' \
  'sudo /usr/local/sbin/qhhoj-deploy  frontend-staging sha-0123456789ab' 'sudo /bin/sh frontend-staging sha-0123456789ab' \
  'rsync --server --sender -logDtpre.iLsfxCIvu . /var/lib/qhhoj-deploy/incoming/' ls ''; do
  : > "$calls"; set +e; staging "$command" > "$out" 2>&1; rc=$?; set -e
  [ "$rc" = 1 ] || fail "staging key: '$command' must be refused (exit $rc)"
  grep -q '^sudo' "$calls" && fail "staging key: '$command' reached sudo"
done
# The staging key is an allow-list: a verb the general dispatch gains later stays refused to it.
# shellcheck disable=SC2016 # the sed pattern is the dispatcher's text
sed 's|^    \*) refuse "${command:-<no command>}" ;;|    "audit-log") exit 0 ;;\n&|' "$here/qhhoj-deploy-serve" > "$work/serve-future"
grep -q '"audit-log") exit 0' "$work/serve-future" || fail "the future-verb copy of the dispatcher"
SSH_ORIGINAL_COMMAND=audit-log QHHOJ_DEPLOY_ROOT="$host" bash "$work/serve-future" > "$out" 2>&1 || fail "full mode takes the future verb"
SSH_ORIGINAL_COMMAND=audit-log QHHOJ_DEPLOY_ROOT="$host" bash "$work/serve-future" -c "$FORCED_STAGING" > "$out" 2>&1 \
  && fail "the staging key must refuse a verb that is not on its allow-list"
# A shell request (no client command): sshd runs the forced command alone, which is refused for either key.
for forced in "$FORCED_STAGING" /usr/local/sbin/qhhoj-deploy-serve; do
  : > "$calls"; as_shell -c "$forced" > "$out" 2>&1 && fail "a shell request with forced command '$forced'"
  grep -q 'refused: shell request' "$calls" && ! grep -q '^sudo' "$calls" || fail "the shell request '$forced' is refused and logged"
done
# A forced command with an unknown option refuses everything; the production key's forced command keeps full rights.
SSH_ORIGINAL_COMMAND='sudo /usr/local/sbin/qhhoj-deploy frontend sha-0123456789ab' QHHOJ_DEPLOY_ROOT="$host" \
  bash "$here/qhhoj-deploy-serve" -c '/usr/local/sbin/qhhoj-deploy-serve --staging' > "$out" 2>&1 && fail "an unknown forced option"
: > "$calls"; SSH_ORIGINAL_COMMAND='sudo /usr/local/sbin/qhhoj-deploy backend v2.1.0' QHHOJ_DEPLOY_ROOT="$host" \
  bash "$here/qhhoj-deploy-serve" -c /usr/local/sbin/qhhoj-deploy-serve > "$out" 2>&1 || fail "production forced command"
grep -qx 'sudo -n /usr/local/sbin/qhhoj-deploy backend v2.1.0' "$calls" || fail "the production key keeps the backend deploy"

# Staging uploads: only frontend-staging-dist-<version>.tar.gz[.sha256] reach incoming/; any other name refuses the whole
# upload, so the staging key can never replace a production tarball between its upload and its deploy.
staged=frontend-staging-dist-sha-0123456789ab.tar.gz
echo prod > "$incoming/frontend-dist-sha-2.tar.gz"
echo dist > "$work/up/$staged"; echo sum > "$work/up/$staged.sha256"
rsync -e ssh-staging "$work/up/$staged" "$work/up/$staged.sha256" fakehost:/var/lib/qhhoj-deploy/incoming/ > "$out" 2>&1 \
  || fail "staging upload"
[ "$(cat "$incoming/$staged")" = dist ] && [ -f "$incoming/$staged.sha256" ] || fail "the staging upload lands in incoming/"
mkdir -p "$work/bad/frontend-staging-dist-v1.0.0.tar.gz"
echo evil > "$work/up/frontend-dist-sha-2.tar.gz"; echo evil > "$work/up/frontend-staging-dist-x.tar.gz"
echo two > "$work/up/frontend-staging-dist-v1.0.0.tar.gz"
for files in "$work/up/frontend-dist-sha-2.tar.gz" "$work/up/frontend-staging-dist-x.tar.gz" \
  "$work/up/frontend-staging-dist-v1.0.0.tar.gz $work/up/frontend-dist-sha-2.tar.gz" "-r $work/bad/"; do
  # shellcheck disable=SC2086 # $files is a word list
  rsync -e ssh-staging $files fakehost:/var/lib/qhhoj-deploy/incoming/ > "$out" 2>&1 && fail "staging upload of $files"
done
[ "$(cat "$incoming/frontend-dist-sha-2.tar.gz")" = prod ] || fail "the staging key replaced a production tarball"
[ ! -e "$incoming/frontend-staging-dist-v1.0.0.tar.gz" ] && [ ! -e "$incoming/frontend-staging-dist-x.tar.gz" ] \
  || fail "a refused staging upload moves nothing"
for target in fakehost: fakehost:/var/lib/qhhoj-deploy/ fakehost:/var/lib/qhhoj-deploy/incoming/../x \
  fakehost:/var/lib/qhhoj-deploy/incoming/sub/; do
  rsync -e ssh-staging "$work/up/$staged" "$target" > "$out" 2>&1 && fail "a staging upload to $target"
done
# A file over the size limit stops the receive: nothing lands.
head -c 200000 /dev/zero > "$work/up/frontend-staging-dist-v9.0.0.tar.gz"
QHHOJ_STAGING_MAX_FILE_KB=64 rsync -e ssh-staging "$work/up/frontend-staging-dist-v9.0.0.tar.gz" \
  fakehost:/var/lib/qhhoj-deploy/incoming/ > "$out" 2>&1 && fail "an oversize staging upload must be refused"
[ ! -e "$incoming/frontend-staging-dist-v9.0.0.tar.gz" ] || fail "an oversize staging upload lands nothing"
: > "$calls"; rsync -e ssh-staging "$work/up/$staged" fakehost:/var/lib/qhhoj-deploy/incoming/ > "$out" 2>&1 || fail "staging re-upload"
grep -q "staging upload $staged\$" "$calls" || fail "the staging upload logs the moved names"
[ -z "$(find "$incoming" -name '.staging.*')" ] || fail "the staging upload leaves no private directory"
[ "$(find "$host" -name 'frontend-staging-dist-*' | wc -l)" = 2 ] || fail "nothing staging lands outside incoming/"
echo "qhhoj-deploy-serve ok"
