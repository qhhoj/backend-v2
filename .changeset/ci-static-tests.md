---
'qhhoj-backend': patch
---

CI runs only the unit and static OpenAPI specs, with no MongoDB or Redis; specs that need them are `*.db.spec.ts` or `*.e2e-spec.ts` and run locally with `npm run test:db`.
