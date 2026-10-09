---
'qhhoj-backend': patch
---

Replay: a verdict graded after the end queues a rebuild, so a judge backlog no longer leaves the replay behind the board; a build delayed for an old end is moved forward when the contest ends early; the editor's rebuild budget is refunded when nothing was queued; Redis failures answer 404 `replay_not_ready` (read) or 503 `replay_unavailable` (rebuild) instead of 500; a build never deletes or overtakes a later-started build. Ghost list ranks ghosts over current problems like the replay; ghost CSV download starts with a UTF-8 BOM. Sync standings of a hidden board: 403 `forbidden` with issue `board_hidden`.
