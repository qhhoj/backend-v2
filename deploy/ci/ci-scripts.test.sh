#!/usr/bin/env bash
# deploy/ci/ci-scripts.test.sh: resolve-ref, wait-for-ci, ci-gate and remote-deploy with stub git/gh/ssh/sleep.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="$(mktemp -d)"; repo="$(mktemp -d)"; trap 'rm -rf "$bin" "$repo"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
printf '#!/usr/bin/env bash\necho "$1" >> "%s/sleeps"\n' "$bin" > "$bin/sleep"; chmod +x "$bin/sleep"

git -C "$repo" init -q; git -C "$repo" -c user.email=t@t -c user.name=t -c commit.gpgSign=false commit -q --allow-empty -m one
git -C "$repo" -c tag.gpgSign=false tag v2.0.0; git -C "$repo" -c user.email=t@t -c user.name=t -c commit.gpgSign=false commit -q --allow-empty -m two
git -C "$repo" -c tag.gpgSign=false tag v2.10.0; head="$(git -C "$repo" rev-parse HEAD)"
git -C "$repo" update-ref refs/remotes/origin/main HEAD
resolve() { (cd "$repo" && bash "$here/resolve-ref.sh" "$1"); }
[ "$(resolve '')" = "$(printf 'sha=%s\ntag=v2.10.0' "$head")" ] || fail "empty ref = highest version tag"
[ "$(resolve v2.0.0 | sed -n 's/^tag=//p')" = v2.0.0 ] || fail "tag ref keeps the tag"
[ "$(resolve HEAD | sed -n 's/^tag=//p')" = "sha-${head:0:12}" ] || fail "non-tag ref = sha-<12>"
(cd "$repo" && bash "$here/resolve-ref.sh" 'nope;rm -rf /' >/dev/null 2>&1) && fail "unknown ref must fail"
git -C "$repo" checkout -q -b side; git -C "$repo" -c user.email=t@t -c user.name=t -c commit.gpgSign=false commit -q --allow-empty -m side
git -C "$repo" -c tag.gpgSign=false tag v9.0.0; git -C "$repo" checkout -q -
resolve side >/dev/null 2>&1 && fail "a branch off origin/main must fail"
resolve v9.0.0 >/dev/null 2>&1 && fail "a version tag off origin/main must fail"
resolve '' >/dev/null 2>&1 && fail "the highest tag off origin/main must fail, not deploy"
git -C "$repo" tag -d v9.0.0 >/dev/null

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
echo "\$*" >> "$bin/ssh-calls"; [ -z "\${SSH_MSG:-}" ] || echo "\$SSH_MSG"; head -n 1 >> "$bin/ssh-stdin"; code=\$(head -1 "$bin/codes"); sed -i 1d "$bin/codes"; exit "\$code"
EOT
chmod +x "$bin/ssh"; }
remote() { PATH="$bin:$PATH" DEPLOY_HOST=h RETRY_INTERVAL=0 RETRY_MAX=3 bash "$here/remote-deploy.sh" "$@" </dev/null; }
ssh_codes 75 75 0; remote backend v2.1.0 >/dev/null || fail "retries deferred then succeeds"
[ "$(wc -l < "$bin/ssh-calls")" = 3 ] || fail "three attempts"
grep -q "deploy@h sudo /usr/local/sbin/qhhoj-deploy backend v2.1.0" "$bin/ssh-calls" || fail "ssh command"
ssh_codes 75 75 75; remote backend v2.1.0 >/dev/null 2>&1 && fail "gives up after RETRY_MAX"
ssh_codes 1; set +e; remote backend v2.1.0 >/dev/null 2>&1; code=$?; set -e
[ "$code" = 1 ] || fail "other exits pass through"
: > "$bin/ssh-stdin"; ssh_codes 75 75 0
REGISTRY_TOKEN=tok-123 remote backend v2.1.0 >/dev/null || fail "token deploy retries"
[ "$(wc -l < "$bin/ssh-stdin")" = 3 ] || fail "token on ssh stdin on every attempt"
[ "$(sort -u "$bin/ssh-stdin")" = tok-123 ] || fail "ssh stdin carries only the token"
grep -q "deploy@h sudo /usr/local/sbin/qhhoj-deploy backend v2.1.0 --token-stdin" "$bin/ssh-calls" || fail "--token-stdin appended"
! grep -q tok-123 "$bin/ssh-calls" || fail "token must not appear in ssh argv"
commit() { mkdir -p "$repo/$(dirname "$1")"; echo "$RANDOM" >> "$repo/$1"; git -C "$repo" add -A; git -C "$repo" -c user.email=t@t -c user.name=t -c commit.gpgSign=false commit -q -m "$1"; }
# a deferral that names the contest's end retries just after it, within [30, RETRY_INTERVAL]
iso() { date -u -d "@$(( $(date +%s) + $1 ))" +%FT%T.000Z; }
retry_sleep() { : > "$bin/sleeps"; ssh_codes 75 0; SSH_MSG="deferred: a contest is running; retry after $1" \
  PATH="$bin:$PATH" DEPLOY_HOST=h RETRY_INTERVAL="$2" RETRY_MAX=3 bash "$here/remote-deploy.sh" backend v2.1.0 </dev/null >/dev/null; head -1 "$bin/sleeps"; }
d="$(retry_sleep "$(iso 100)" 600)"; { [ "$d" -ge 100 ] && [ "$d" -le 135 ]; } || fail "retry just after the contest end (got $d)"
[ "$(retry_sleep "$(iso -500)" 600)" = 30 ] || fail "an ended contest retries after the slack"
[ "$(retry_sleep "$(iso 7200)" 600)" = 600 ] || fail "a far contest end is capped by the interval"
[ "$(retry_sleep "garbage" 600)" = 600 ] || fail "no readable end waits the interval"
# ci-gate.sh: a version-packages commit gates on its parent's CI, every other commit on its own
printf '#!/usr/bin/env bash\necho "$*" >> "%s/gh-calls"; echo "completed success"\n' "$bin" > "$bin/gh"; chmod +x "$bin/gh"
gate() { : > "$bin/gh-calls"; (cd "$repo" && PATH="$bin:$PATH" bash "$here/ci-gate.sh" "$(git rev-parse "$1")" ci.yml 1 >/dev/null); sed -n 's/.*--commit \([0-9a-f]*\).*/\1/p' "$bin/gh-calls"; }
printf '{\n  "version": "1.0.0",\n  "dependencies": { "a": "1" }\n}\n' > "$repo/package.json"; mkdir -p "$repo/.changeset"; echo c > "$repo/.changeset/x.md"
git -C "$repo" add -A; git -C "$repo" -c user.email=t@t -c user.name=t -c commit.gpgSign=false commit -q -m seed
parent="$(git -C "$repo" rev-parse HEAD)"
sed -i 's/"version": "1.0.0"/"version": "1.0.1"/' "$repo/package.json"; git -C "$repo" rm -q .changeset/x.md; echo "## 1.0.1" > "$repo/CHANGELOG.md"
git -C "$repo" add -A; git -C "$repo" -c user.email=t@t -c user.name=t -c commit.gpgSign=false commit -q -m version
[ "$(gate HEAD)" = "$parent" ] || fail "a version-packages commit gates on its parent"
parent="$(git -C "$repo" rev-parse HEAD)"
sed -i 's/"a": "1"/"a": "2"/' "$repo/package.json"; git -C "$repo" -c user.email=t@t -c user.name=t -c commit.gpgSign=false commit -qam dep
[ "$(gate HEAD)" = "$(git -C "$repo" rev-parse HEAD)" ] || fail "a dependency change waits for its own CI"
sed -i 's/"version": "1.0.1"/"version": "1.0.2"/' "$repo/package.json"; commit apps/y.ts
[ "$(gate HEAD)" = "$(git -C "$repo" rev-parse HEAD)" ] || fail "a version bump with code waits for its own CI"
parent="$(git -C "$repo" rev-parse HEAD)"; sed -i 's/"dependencies"/"scripts": { "x": "y" },\n  "version": "9.9.9",\n  "dependencies"/' "$repo/package.json"
git -C "$repo" -c user.email=t@t -c user.name=t -c commit.gpgSign=false commit -qam "version-looking line under scripts"
[ "$(gate HEAD)" = "$(git -C "$repo" rev-parse HEAD)" ] || fail "a package.json change beyond the version waits for its own CI"
echo "$RANDOM" >> "$repo/CHANGELOG.md"; git -C "$repo" -c user.email=t@t -c user.name=t -c commit.gpgSign=false commit -qam notes
parent="$(git -C "$repo" rev-parse HEAD)"; echo "$RANDOM" >> "$repo/CHANGELOG.md"; git -C "$repo" -c user.email=t@t -c user.name=t -c commit.gpgSign=false commit -qam notes2
[ "$(gate HEAD)" = "$parent" ] || fail "a changelog-only commit gates on its parent"
# code-changed.sh: light-only pushes (docs, changesets, deploy scripts) skip the heavy CI jobs
cc() { (cd "$repo" && CI_LIGHT_PATHS='^(.*[.]md|docs/.*|[.]changeset/.*|deploy/.*)$' CI_HEAVY_PATHS='^deploy/container/' bash "$here/code-changed.sh" "$1"); }
base="$(git -C "$repo" rev-parse HEAD)"; commit docs/guide.md; commit deploy/RUNBOOK.md; commit .changeset/x.md
[ "$(cc "$base")" = code=false ] || fail "docs, changeset and deploy-only push is light"
base="$(git -C "$repo" rev-parse HEAD)"; commit deploy/container/smoke.sh
[ "$(cc "$base")" = code=true ] || fail "deploy/container is heavy (the image)"
base="$(git -C "$repo" rev-parse HEAD)"; commit README.md; commit apps/api/main.ts
[ "$(cc "$base")" = code=true ] || fail "any code file makes the push heavy"
[ "$(cc 0000000000000000000000000000000000000000)" = code=true ] || fail "no base (new branch) runs everything"
[ "$(cc "")" = code=true ] || fail "empty base runs everything"
[ "$(cc deadbeefdeadbeefdeadbeefdeadbeefdeadbeef)" = code=true ] || fail "unknown base runs everything"
echo "ci scripts ok"
