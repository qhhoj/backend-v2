---
'qhhoj-backend': minor
---

Problems admin: `POST /problems/bulk/visibility` publishes or unpublishes up to 100 problems through the PATCH path (optional `setDateToNow`, per-code `done`/`unchanged`/`failed`); `PATCH /problems/{code}` takes `changeMessage` as the revision comment; `GET /problems` gains `authorId` and `suggested` filters and `authors` on each item; the editor block gains `ogImage`; create and edit for problem types, groups and licenses under `/admin/problem-types`, `/admin/problem-groups`, `/admin/licenses` (`judge.add_*`/`judge.change_*` for `problemtype`, `problemgroup`, `license`).
