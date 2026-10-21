---
'qhhoj-backend': patch
---

Free a Polygon problem for a new import when the problem linked to it is purged (the purge clears the link); a link held by a problem still in its deletion grace period answers 409 `polygon_linked_deleted` with `linkedProblemCode`. One problem per Polygon problem is now enforced by a unique index and re-checked in the import transaction, and `POST /internal/polygon/resolve` takes an optional `code` so a problem may re-check its own link.
