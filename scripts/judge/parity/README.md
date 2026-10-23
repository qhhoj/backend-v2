# Parity run: judge-v2 against the DMOJ judge

Proves that judge-v2 grades the legacy problem shapes like the DMOJ judge: 21 seeded problems (`apps/api/src/seed/seed-parity-data.ts`: plain, zip, batches, pretests, partial and short-circuit, float/identical/linecount checkers, testlib and `type: default` bridged checkers, file I/O, interactive, signature graders, output-only with TEXT and an OUTPUT zip, a pretests-only contest, a crashing interactor, a 0-point sample), 58 runs in PY3, CPP17, TEXT and OUTPUT. Verdicts, case points, totals and batches are compared; time, memory and ids are not, feedback only for `+feedback` runs.

1. DMOJ side: a backend-v2 worktree at the last commit before the gRPC bridge (`git log --diff-filter=D -1 -- apps/bridge/src/protocol/packet-codec.ts`, its parent) and the DMOJ dev judge from that worktree's `scripts/judge` (podman; it needs `testlib.h`, e.g. mounted at `/usr/local/include/testlib.h`). `STACK_JUDGE=none npm run stack:up` there; `npm run seed:parity` from this checkout with that stack's env and `RUN`; then `npm run judge:up` there (that commit still has it; the DMOJ judge lists problems once, at start).
2. `node scripts/judge/parity/submit-all.mjs --manifest "$RUN/parity-manifest.json" --out dmoj.json`, then stop that stack and judge.
3. judge-v2 side, here: `STACK_JUDGE=none npm run stack:up && npm run judge:v2:up`, `npm run seed:parity`, `submit-all.mjs ... --out v2.json`, `npm run stack:down`.
4. `node scripts/judge/parity/compare.mjs dmoj.json v2.json` prints one line per difference (`label: field dmoj → v2`) and exits 1 when there is any.

Reading a difference: the DMOJ side is the reference. Accepted differences, the same list as `docs/decisions.md` ("Parity with DMOJ"): an uncaught exception is RTE on judge-v2, IR on DMOJ; memory over the limit is MLE (cgroup) on judge-v2, RTE (`bad_alloc` under RLIMIT_AS) on DMOJ; a testlib checker's message is the case feedback on judge-v2; testlib `quitp` partial points are a 0..1 fraction of the case on judge-v2 (the DMOJ dev judge answers IE). Limits of the DMOJ dev image, not judge-v2 differences: no `file_io`, no OUTPUT executor (`TIMEOUT`), seccomp kills `sleep`. Anything else is a judge-v2 defect, fixed in the judge-v2 module that owns it (case plan, short-circuit, verdict classification, checker interpretation) with a test, then the run repeats. The comparer exits 1 while any accepted difference is listed: review the lines, not the exit code.

Comparer tests: `node --test scripts/judge/parity/*.test.mjs`.

## Migration gate: snapshot and compare

Tooling for the rejudge-and-compare gate of a problem flip. Exports hold contestant source: keep them in a private directory, never in a repository. The tools are read-only on the database.

- Snapshot: `QHHOJ_MONGO_URL=mongodb://… node scripts/judge/parity/gate-snapshot.mjs --problem <code> --out <private>/stored.json` writes `{ exportedAt, problem, dataVersion, rows }`, one row per submission of the problem (all users, languages, results): `id, language` (key), `result, points, casePoints, caseTotal, judgedDataVersion, cases[]` (`position, status, time, memory, points, total`) and `source`. The user is not exported. It reads through a wrapper that exposes only `find` and `findOne`. Times are in seconds, as stored.
- The control and candidate passes (local judge runs) write the same format; any two snapshots compare.
- Compare: `node scripts/judge/parity/gate-compare.mjs --control control.json --candidate candidate.json [--stored stored.json] [--json report.json]`. The totals line is `unchanged, timing-only, improved, worsened, other, missing, tle-flips`. With `--stored`, the control pass is first compared with the stored snapshot: that is the pre-existing list.
- A row is **improved** when its verdict or points only got better (more points; with equal points AC over any other verdict; every changed case likewise), **worsened** when any of them got worse, **other** for changes that are not ordered (WA to RTE with equal points, anything to or from CE/IE, points up with AC lost, a different case count or total), and **unchanged** otherwise. A row takes its worst field, so one worsened case outweighs better totals. A row only in one snapshot is listed as **missing**.
- Improved rows are accepted without review; only worsened rows stop a flip. Exit code 1: a worsened row; 2: no worsened row but `other` or missing rows to decide; 0 otherwise.
- Case times that move by more than 10 % and 20 ms (`classify` options `relative`, `absoluteSeconds`) with an unchanged status make a row timing-only (listed, not counted as changed). Rows where a TLE appears or vanishes are also listed under "TLE flips".
- Worsened and other rows carry a proposal, never a decision: `exploit` when the source matches `pread|lseek|fseek|freopen|extern|/proc/self|_exit`, `read-catch` when it contains `catch`, `tle-flip`.

Tests: `node --test scripts/judge/parity/gate-classify.test.mjs` (pure); `node --test scripts/judge/parity/gate-snapshot.db.test.mjs` needs mongodb-memory-server and runs locally only.
