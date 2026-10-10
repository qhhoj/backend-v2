#!/usr/bin/env bash
# deploy/ci/ci-scripts.test.sh: resolve-ref, wait-for-ci and remote-deploy with stub git/gh/ssh/sleep.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="$(mktemp -d)"; repo="$(mktemp -d)"; trap 'rm -rf "$bin" "$repo"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
printf '#!/usr/bin/env bash\ntrue\n' > "$bin/sleep"; chmod +x "$bin/sleep"

git -C "$repo" init -q; git -C "$repo" -c user.email=t@t -c user.name=t commit -q --allow-empty -m one
git -C "$repo" tag v2.0.0; git -C "$repo" -c user.email=t@t -c user.name=t commit -q --allow-empty -m two
git -C "$repo" tag v2.10.0; head="$(git -C "$repo" rev-parse HEAD)"
resolve() { (cd "$repo" && bash "$here/resolve-ref.sh" "$1"); }
[ "$(resolve '')" = "$(printf 'sha=%s\ntag=v2.10.0' "$head")" ] || fail "empty ref = highest version tag"
[ "$(resolve v2.0.0 | sed -n 's/^tag=//p')" = v2.0.0 ] || fail "tag ref keeps the tag"
[ "$(resolve HEAD | sed -n 's/^tag=//p')" = "sha-${head:0:12}" ] || fail "non-tag ref = sha-<12>"
(cd "$repo" && bash "$here/resolve-ref.sh" 'nope;rm -rf /' >/dev/null 2>&1) && fail "unknown ref must fail"

gh_answers() { printf '%s\n' "$@" > "$bin/answers"; cat > "$bin/gh" <<EOT
#!/usr/bin/env bash
head -1 "$bin/answers"; sed -i 1d "$bin/answers"
EOT
chmod +x "$bin/gh"; }
wait_ci() { PATH="$bin:$PATH" WAIT_INTERVAL=0 bash "$here/wait-for-ci.sh" abc ci.yml 1; }
gh_answers "" "in_progress " "completed success"; wait_ci >/dev/null || fail "success after waiting"
gh_answers "completed failure"; wait_ci >/dev/null 2>&1 && fail "failure must fail"
gh_answers "completed cancelled"; wait_ci >/dev/null 2>&1 && fail "cancelled must fail"

ssh_codes() { printf '%s\n' "$@" > "$bin/codes"; : > "$bin/ssh-calls"; cat > "$bin/ssh" <<EOT
#!/usr/bin/env bash
echo "\$*" >> "$bin/ssh-calls"; code=\$(head -1 "$bin/codes"); sed -i 1d "$bin/codes"; exit "\$code"
EOT
chmod +x "$bin/ssh"; }
remote() { PATH="$bin:$PATH" DEPLOY_HOST=h RETRY_INTERVAL=0 RETRY_MAX=3 bash "$here/remote-deploy.sh" "$@"; }
ssh_codes 75 75 0; remote backend v2.1.0 >/dev/null || fail "retries deferred then succeeds"
[ "$(wc -l < "$bin/ssh-calls")" = 3 ] || fail "three attempts"
grep -q "deploy@h sudo /usr/local/sbin/qhhoj-deploy backend v2.1.0" "$bin/ssh-calls" || fail "ssh command"
ssh_codes 75 75 75; remote backend v2.1.0 >/dev/null 2>&1 && fail "gives up after RETRY_MAX"
ssh_codes 1; set +e; remote backend v2.1.0 >/dev/null 2>&1; code=$?; set -e
[ "$code" = 1 ] || fail "other exits pass through"
echo "ci scripts ok"
