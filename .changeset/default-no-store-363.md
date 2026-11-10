---
'qhhoj-backend': patch
---

Every api answer without its own `Cache-Control` gets `private, no-store`, whatever the path. The Polygon and external judge connection tests are limited to 10 per user per minute. A password login that overlaps a sign out everywhere, password change or reset, staff set-password or ban no longer leaves a session behind (401 instead).
