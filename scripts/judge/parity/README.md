# Parity run: judge-v2 against the DMOJ judge

Proves that judge-v2 grades the legacy problem shapes like the DMOJ judge: 21 seeded problems (`apps/api/src/seed/seed-parity-data.ts`: plain, zip, batches, pretests, partial and short-circuit, float/identical/linecount checkers, testlib and `type: default` bridged checkers, file I/O, interactive, signature graders, output-only with TEXT and an OUTPUT zip, a pretests-only contest, a crashing interactor, a 0-point sample), 58 runs in PY3, CPP17, TEXT and OUTPUT. Verdicts, case points, totals and batches are compared; time, memory and ids are not, feedback only for `+feedback` runs.

1. DMOJ side: a backend-v2 worktree at the last commit before the gRPC bridge (`git log --diff-filter=D -1 -- apps/bridge/src/protocol/packet-codec.ts`, its parent) and the DMOJ dev judge from that worktree's `scripts/judge` (podman; it needs `testlib.h`, e.g. mounted at `/usr/local/include/testlib.h`). `STACK_JUDGE=none npm run stack:up` there; `npm run seed:parity` from this checkout with that stack's env and `RUN`; then `npm run judge:up` there (that commit still has it; the DMOJ judge lists problems once, at start).
2. `node scripts/judge/parity/submit-all.mjs --manifest "$RUN/parity-manifest.json" --out dmoj.json`, then stop that stack and judge.
3. judge-v2 side, here: `STACK_JUDGE=none npm run stack:up && npm run judge:v2:up`, `npm run seed:parity`, `submit-all.mjs ... --out v2.json`, `npm run stack:down`.
4. `node scripts/judge/parity/compare.mjs dmoj.json v2.json` prints one line per difference (`label: field dmoj → v2`) and exits 1 when there is any.

Reading a difference: the DMOJ side is the reference. Known, accepted ones (docs/decisions.md): case points are a 0..1 fraction of the case total on judge-v2 versus DMOJ's integer `points N` checker answers; DMOJ's `K` (skipped) case status; a language or executor the dev image lacks (`TIMEOUT` on the DMOJ side: OUTPUT zips). Anything else is a judge-v2 defect, fixed in the judge-v2 module that owns it (checker interpretation, plan selection, verdict classification) with a test, then the run repeats.

Comparer tests: `node --test scripts/judge/parity/*.test.mjs`.
