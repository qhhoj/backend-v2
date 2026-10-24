---
'qhhoj-backend': patch
---

Contests: a clone starts unrated and drops gated settings the cloner may not set; hidden contests are never rated; a rejudge, reject or score override after the end of a contest with ratings re-rates it (debounced per contest); the public ranking is built once per burst and cached at least 5 s even with `scoreboardCacheTimeout` 0; rating ignores rows on removed problems; ICPC with `penalty: 0` marks an unsolved problem pending by its latest try.
