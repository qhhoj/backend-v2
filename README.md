# QHHOJ backend-v2

NestJS 11 (Fastify) + Mongoose 8 on MongoDB backend for the QHHOJ online judge.

Background jobs (statement PDFs, Polygon imports) run in `apps/worker` on BullMQ.

Judges connect to `apps/bridge` over the DMOJ judge protocol.

Points, stats and rescores run in the worker; submission status streams to browsers over SSE.

Contests: seven scoring formats, live and frozen rankings, virtual participation and final-submission judging.

Ratings, MOSS and contest data run in the worker; announcements stream over SSE.

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions.

Design docs live in `docs/superpowers/specs/`.
