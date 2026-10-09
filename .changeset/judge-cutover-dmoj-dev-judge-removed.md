---
'qhhoj-backend': patch
---

The DMOJ dev judge (`npm run judge:up` / `judge:down`, `scripts/judge/Containerfile`) is removed; the local real judge is judge-v2 (`npm run judge:v2:up` on a `STACK_JUDGE=none` stack). The runbook's cutover sequence now stamps `.data-version`, prunes languages no judge runs and switches the judge hosts to `qhhoj-judge`.
