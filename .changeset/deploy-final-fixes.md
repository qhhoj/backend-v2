---
'qhhoj-backend': patch
---

Deploys defer (exit 75) while a migration or another deploy holds the lock, and only for contests ending within 24 h; a failed deploy resets systemd start limits, health-checks the restored version, and the frontend check is file-only until nginx serves v2. A resumed go-live keeps its pre-start dump, and the maintenance and preview pages keep the security headers.
