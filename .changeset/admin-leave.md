---
'qhhoj-backend': minor
---

`POST /organizations/:slug/leave` lets an administrator leave while another administrator remains (dropping their admin rights, recorded in the history); the last administrator gets 409 with issue `last_admin`.
