---
'qhhoj-backend': patch
---

Contest fixes: deleting a contest with participations needs `judge.edit_all_contest`; a clone is refused when it holds a problem the cloner could not add to the copy; removing a user from a contest's authors, curators or testers clears the spectator participation that role gave them.
