---
'qhhoj-backend': patch
---

Migration gate tooling: `scripts/judge/parity/gate-snapshot.mjs` exports a problem's submissions and verdicts from Mongo (read-only), `gate-compare.mjs` classifies two snapshots into unchanged, improved, worsened and other rows.
