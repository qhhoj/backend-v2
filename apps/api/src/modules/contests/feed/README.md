# Event feed

Read-only ICPC contest-API style feed of one contest, for resolver tools.

| Route                                                                                 | Auth                                                       | Body                                           |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| `GET /api/internal/contests/:key/feed`                                                | HTTP Basic, user `feed`, password = the contest's feed key | NDJSON snapshot, `Cache-Control: no-store`     |
| `GET /api/internal/events/contests/:key/feed`                                         | same                                                       | NDJSON stream: the snapshot, then new events   |
| `GET\|POST\|DELETE /api/internal/contests/:key/feed-key`, `POST .../feed-key/release` | editor session (not an API token, not impersonated)        | key status, mint (shown once), revoke, release |

Each line is `{"type", "id", "data", "token"}`. Order: `contest`, `judgement-types`, `languages`, `groups`, `teams`, `problems`, `submissions`, `judgements`, `state`; every id an event refers to appears in an earlier event. Times are RFC 3339 (`...Z`), contest times `H:MM:SS.mmm` from the team's own start. Ids are UUIDs (teams are participation ids, groups are listed organization ids, a judgement has its submission's id); judgement types are labels.

Teams: live, non-disqualified participations only (no virtual, spectating or disqualified rows).

## Keys

Per contest, `qhf_` + 32 url-safe characters, shown once, stored as sha256, compared in constant time. Expires after 14 days (1 to 30 at mint). Bound to the editor who minted it: it stops working when that user is deactivated or can no longer edit the contest. Minting a new key revokes the older ones. Every failure is the same 401 with `WWW-Authenticate: Basic realm="feed"`. Five wrong attempts per IP per 10 minutes lock that IP out of every contest's feed with the same 429, whether the contest exists or not, so a locked prober cannot tell a hidden contest key from a made-up one; a key may make 60 requests a minute.

Modes: `frozen-until-release` (default) and `live`. While the contest is frozen and the key is `frozen-until-release` and unreleased, no submission or judgement dated at or after the freeze is published and `state.frozen` is set. "Release to resolver" (only while the contest is frozen, `409 not_frozen` otherwise) or unfreezing the contest lifts the cut; a release counts only for the freeze that was current when it was made, so it cannot open a later freeze. `live` is never cut.

## Verdicts

| Our result                          | Judgement type | Counts as a try |
| ----------------------------------- | -------------- | --------------- |
| `AC`                                | `AC` (solved)  | no              |
| `WA`, `SC`                          | `WA`           | yes             |
| `TLE`                               | `TLE`          | yes             |
| `MLE`                               | `MLE`          | yes             |
| `OLE`                               | `OLE`          | yes             |
| `RTE`, `IR`                         | `RTE`          | yes             |
| `CE`                                | `CE`           | no              |
| `IE`, `AB`, `RJ`, or not yet judged | no judgement   |                 |

Streams of one contest share one feed build per tick (each stream only diffs against what it was sent); each stream re-checks its key every 10 s and ends when it stops qualifying; a contest that grows past 20 000 submissions ends its streams; at most two streams per key, capped at `contestFeedTotal` (100) per api process and counted in the shared SSE caps (`perIp`, `total`).

A contest with more than 100 000 submissions answers `409 feed_too_large`; one with more than 20 000 cannot be streamed (`409 feed_too_large_for_stream`, poll the snapshot). A submission whose problem left the contest, whose language is not listed or whose team is not a feed team is not published.
