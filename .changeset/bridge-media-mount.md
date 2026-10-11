---
'qhhoj-backend': patch
---

Bridge quadlet mounts `/srv/qhhoj/media` read-only, so judges can fetch file-only (OUTPUT zip) submissions. Host step: re-run `install-host.sh` (or install the unit), `systemctl daemon-reload`, restart `qhhoj-bridge`.
