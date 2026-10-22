#!/usr/bin/env bash
# deploy/backup/pull/qhhoj-pull.test.sh: qhhoj-pull-serve's dispatcher, then qhhoj-pull through a fake ssh that runs
# qhhoj-pull-serve on a fake host root in a temp dir. Real rsync, rrsync and restic; stub mongodump, logger and
# notify-send (no MongoDB: CI is service-free). Needs restic, rsync with rrsync, and python3.
# shellcheck disable=SC2015 # `check && check || fail`: fail runs when a check failed, which is the point
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
for tool in restic rsync rrsync python3; do
  command -v "$tool" > /dev/null || { echo "qhhoj-pull.test: $tool is not installed" >&2; exit 1; }
done
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
bin="$work/bin" host="$work/host" calls="$work/calls" out="$work/out"
data="$host/srv/qhhoj"
export PATH="$bin:$PATH" RESTIC_CACHE_DIR="$work/cache" QHHOJ_PULL_ENV="$work/pull.env" STATE_DIRECTORY="$work/state"
fail() { echo "FAIL: $*" >&2; cat "$out" "$calls" >&2 2>/dev/null || true; exit 1; }

mkdir -p "$bin" "$host/etc/qhhoj-pull" "$data/problem-data/p1" "$data/media" "$data/contest-data" "$data/user-data" "$data/pdf-cache"
echo tests > "$data/problem-data/p1/tests.zip"; echo img > "$data/media/a.png"; echo pdf > "$data/pdf-cache/x.pdf"
echo board > "$data/contest-data/c1.json"; echo avatar > "$data/user-data/u1.png"
printf '%s\n' "MONGO_BACKUP_URL='mongodb://qhhoj-backup@127.0.0.1:27017/?authSource=admin&replicaSet=rs0'" \
  "MONGO_BACKUP_PASSWORD='s3cret'" > "$host/etc/qhhoj-pull/mongo.env"
# mongodump stub: records its argv and its --config file, writes an archive or (STUB_DUMP_FAIL) a partial one and fails.
cat > "$bin/mongodump" <<EOF
#!/usr/bin/env bash
echo "mongodump \$*" >> "$calls"
while [ \$# -gt 0 ]; do [ "\$1" = --config ] && cat "\$2" > "$work/mongodump-config"; shift; done
if [ -n "\${STUB_DUMP_FAIL:-}" ]; then printf partial; exit 2; fi
printf 'archive-%s' "\${STUB_NIGHT:-1}"
EOF
# shellcheck disable=SC2016 # $* belongs to the stubs
for tool in logger notify-send; do printf '#!/usr/bin/env bash\necho "%s $*" >> "%s"\n' "$tool" "$calls" > "$bin/$tool"; done
# fake ssh: drops its options and the host name, then runs qhhoj-pull-serve with the rest as the forced command's
# SSH_ORIGINAL_COMMAND; FAKE_SSH_DOWN fails like an unreachable host (255).
cat > "$bin/ssh" <<EOF
#!/usr/bin/env bash
[ -z "\${FAKE_SSH_DOWN:-}" ] || { echo "ssh: connect to host \$*: Network is unreachable" >&2; exit 255; }
while [ \$# -gt 0 ]; do case "\$1" in -[iloFp]) shift 2 ;; -*) shift ;; *) break ;; esac; done
shift
SSH_ORIGINAL_COMMAND="\$*" QHHOJ_PULL_ROOT="$host" exec bash "$here/qhhoj-pull-serve"
EOF
chmod +x "$bin"/*

serve() { SSH_ORIGINAL_COMMAND="$1" QHHOJ_PULL_ROOT="$host" bash "$here/qhhoj-pull-serve"; }
pull_rsync() { rsync -e ssh "$@" > "$out" 2>&1; } # client options and paths, through the fake ssh

# --- qhhoj-pull-serve ---
: > "$calls"; serve dump > "$work/dump" 2> "$out" || fail "dump"
[ "$(cat "$work/dump")" = archive-1 ] || fail "dump streams mongodump's archive"
grep -q 'mongodump .*--archive --oplog --numParallelCollections=1' "$calls" || fail "point-in-time dump, one collection at a time"
grep -q s3cret "$calls" && fail "the password must not be in mongodump's argv"
grep -qx "password: 's3cret'" "$work/mongodump-config" || fail "the password reaches mongodump through its config file"
grep -qx 'logger -t qhhoj-pull-serve -p auth.info -- dump' "$calls" || fail "the dump is logged"

mv "$host/etc/qhhoj-pull/mongo.env" "$work/mongo.env"; : > "$calls"
serve dump > /dev/null 2>&1 && fail "a dump without credentials fails"
grep -q mongodump "$calls" && fail "no dump without credentials"
mv "$work/mongo.env" "$host/etc/qhhoj-pull/mongo.env"

opts='-logDtpre.iLsfxCIvu'
for command in '' ls 'dump now' dumpx 'bash -c id' "rsync --server $opts . media/" \
  "rsync --server --sender $opts . pdf-cache/" "rsync --server --sender $opts . media/../pdf-cache" \
  "rsync --server --sender $opts . /etc" "rsync --server --sender $opts . ." "rsync --server --sender $opts ." \
  "rsync --server --sender $opts . media/ ; touch $work/pwned" "rsync --server --sender $opts . media/ --remove-source-files" \
  "rsync --server --sender $opts . media/"$'\n'"pdf-cache" "rsync --server --sender $opts . media/*"; do
  : > "$calls"; set +e; serve "$command" > "$out" 2>&1; rc=$?; set -e
  [ "$rc" = 1 ] || fail "'$command' must be refused with exit 1, got $rc"
  grep -q 'logger -t qhhoj-pull-serve -p auth.warning -- refused: ' "$calls" || fail "the refusal of '$command' is logged"
  grep -q mongodump "$calls" && fail "'$command' ran mongodump"
done
[ ! -e "$work/pwned" ] || fail "no shell runs the command"

# Read-only rsync of the four data roots (rrsync -ro behind the path allow-list).
pull_rsync -a fakehost:problem-data fakehost:media fakehost:contest-data fakehost:user-data "$work/copy/" || fail "rsync read"
[ -f "$work/copy/problem-data/p1/tests.zip" ] && [ -f "$work/copy/user-data/u1.png" ] || fail "the data roots arrive"
grep -q 'auth.info -- rsync problem-data media contest-data user-data' "$calls" || fail "the rsync read is logged"
pull_rsync -a fakehost:pdf-cache "$work/copy/" && fail "pdf-cache is not served"
[ ! -e "$work/copy/pdf-cache" ] || fail "nothing of pdf-cache arrives"
mkdir -p "$work/push"; echo x > "$work/push/pushed"
pull_rsync -a "$work/push/" fakehost:media/ && fail "a push (write) must be refused"
[ ! -e "$data/media/pushed" ] || fail "a push wrote to the host"
pull_rsync -a --remove-source-files fakehost:media/ "$work/copy2/" && fail "--remove-source-files must be refused"
[ -f "$data/media/a.png" ] || fail "--remove-source-files deleted on the host"
ln -s "$data/pdf-cache/x.pdf" "$data/media/link.pdf"
pull_rsync -aL fakehost:media/ "$work/copy3/" && fail "--copy-links must be refused (rrsync -ro on a subdirectory)"
rm "$data/media/link.pdf"
echo extra > "$work/copy/media/extra.png"
pull_rsync -a --delete fakehost:media "$work/copy/" || fail "--delete on a pull"
[ ! -e "$work/copy/media/extra.png" ] && [ -f "$data/media/a.png" ] || fail "--delete on a pull deletes only on the laptop"

# --- qhhoj-pull ---
echo 'test pass' > "$work/restic-password"; touch "$work/key"
cat > "$QHHOJ_PULL_ENV" <<EOF
SERVER=fakehost
SSH_KEY=$work/key
RESTIC_PASSWORD_FILE=$work/restic-password
REPO=$work/repo
MIRROR=$work/mirror
MIN_FREE_GB=0
EOF
export RESTIC_PASSWORD_FILE="$work/restic-password"
restic init -q -r "$work/repo"
pull() { TMPDIR="$work" bash "$here/qhhoj-pull" > "$out" 2>&1; }
count() { restic -r "$work/repo" snapshots --json --tag "$1" | grep -o '"id"' | wc -l; }
archive() { restic -r "$work/repo" dump --tag qhhoj-db latest /qhhoj-mongo.archive; }
files_ls() { restic -r "$work/repo" ls "$1" --tag qhhoj-files; } # latest | snapshot id

: > "$calls"; pull || fail "first pull"
[ "$(archive)" = archive-1 ] || fail "the database snapshot holds the dump"
restic -r "$work/repo" snapshots --json --tag qhhoj-db,oplog | grep -c '"id"' > /dev/null || fail "tagged qhhoj-db and oplog"
files_ls latest | grep -c "^$work/mirror/problem-data/p1/tests.zip$" > /dev/null || fail "the files snapshot holds the mirror"
[ ! -e "$work/mirror/pdf-cache" ] || fail "pdf-cache is not mirrored"
first_files="$(restic -r "$work/repo" snapshots --json --tag qhhoj-files --latest 1 | grep -o '"id":"[0-9a-f]*"' | cut -d'"' -f4)"

rm "$data/media/a.png"; echo new > "$data/media/b.png"
STUB_NIGHT=2 pull || fail "second pull"
[ "$(archive)" = archive-2 ] || fail "the second night's dump"
[ ! -e "$work/mirror/media/a.png" ] && [ -f "$work/mirror/media/b.png" ] || fail "the mirror follows deletions"
files_ls latest | grep -c '/media/a.png$' > /dev/null && fail "the newest files snapshot lacks the deleted file"
files_ls "$first_files" | grep -c '/media/a.png$' > /dev/null || fail "the older snapshot still holds the deleted file"
grep -q 'unmodified' "$out" || fail "the second files snapshot is incremental"

# A failed dump fails the run and forgets its partial snapshot; the files step still runs.
db_before="$(count qhhoj-db)" files_before="$(count qhhoj-files)"
: > "$calls"; STUB_DUMP_FAIL=1 pull && fail "a failed dump must fail the run"
[ "$(count qhhoj-db)" = "$db_before" ] && [ "$(archive)" = archive-2 ] || fail "the partial snapshot is forgotten"
grep -q 'failed: database' "$out" || fail "the failed step is named"
grep -q '^notify-send .*failed: database' "$calls" || fail "a failure raises a desktop notification"
[ "$(count qhhoj-files)" -ge "$files_before" ] && grep -q 'files snapshot of' "$out" || fail "the files step still runs"

# An unreachable host: exit 75, the repository unchanged; a notification only once the last good pull is old.
pull || fail "a good night before the outage"
db_before="$(count qhhoj-db)" files_before="$(count qhhoj-files)"
: > "$calls"; set +e; FAKE_SSH_DOWN=1 pull; rc=$?; set -e
[ "$rc" = 75 ] || fail "unreachable host exits 75, got $rc"
grep -q 'cannot reach fakehost' "$out" || fail "the unreachable host is named"
[ "$(count qhhoj-db)" = "$db_before" ] && [ "$(count qhhoj-files)" = "$files_before" ] || fail "an unreachable host changes nothing"
grep -q notify-send "$calls" && fail "a recent good pull: no notification"
touch -d '2 days ago' "$STATE_DIRECTORY/last-success"; set +e; FAKE_SSH_DOWN=1 pull; set -e
grep -q '^notify-send .*cannot reach fakehost' "$calls" || fail "an old last good pull raises a notification"

# Bad configuration exits 64.
rm "$QHHOJ_PULL_ENV"; set +e; pull; rc=$?; set -e
[ "$rc" = 64 ] || fail "missing env file exits 64, got $rc"
echo "qhhoj-pull ok"
