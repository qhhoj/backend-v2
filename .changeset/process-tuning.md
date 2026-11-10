---
'qhhoj-backend': patch
---

Test seams become process tuning: each process declares its fixed limits, hash cost, change-stream switch and outbound clients once (`TUNING`), and no production code reads a test-only environment variable. Shutdown drains BullMQ workers before Redis and Mongo close, by phase rather than module order. `SCHEMAS` derives from the schema export list. No environment variable changes.
