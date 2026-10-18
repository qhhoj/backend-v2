---
'qhhoj-backend': patch
---

An edit of `isVisible`, `isPrivate` or `isOrganizationPrivate` saves only while the stored three flags still match what the visibility gate checked (409 otherwise). Before, two concurrent edits that the gate allowed one at a time, such as showing a private contest and clearing the privacy of a hidden one, could combine to publish it without `judge.change_contest_visibility`.
