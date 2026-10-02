# QHHOJ v2 — Program Design

Rewrite of `qhhoj/online-judge` (Django) as `qhhoj/backend-v2` (Rust) + `qhhoj/frontend-v2` (Vue SPA).

## Decisions

| Area | Decision |
|---|---|
| Cutover | Big-bang; old stack runs until switch-over |
| Database | MariaDB → PostgreSQL. Same tables, columns, PKs; types mapped |
| Backend | Rust, Tokio, Axum, SQLx, Redis |
| Shape | One workspace, one binary `qhhoj`, roles: `serve`, `bridge`, `worker`, `realtime`, `all` |
| Judges | `qhhoj/judge-server` unchanged; bridge is wire-compatible |
| Sessions | All users logged out once at cutover |
| Authz | Django permission codenames and `auth_group*` tables kept |
| APIs | `/api/v2/*` keeps response shapes; SPA uses `/api/internal/*` |
| Frontend | Vue 3, TS, Vite, Vue Router, Pinia, TanStack Query, Tailwind, PrimeVue (unstyled), Lucide, vue-i18n (vi, en), Monaco, KaTeX |
| Link previews | Backend serves `index.html` with per-route OpenGraph tags |
| Deploy | Docker Compose: `api`, `bridge`, `worker`, `realtime`, Postgres, Redis, nginx |

## Scope

Everything in the current site except: Summer Challenge 2024 page, URL shortener (tables migrated, unused).

## Backend layout

```
crates/
  db/        SQLx queries over existing schema, migrations
  auth/      Django-compatible passwords, sessions, permissions, 2FA, WebAuthn, OAuth
  domain/    scoring, contest formats, ratings, PP, visibility (no I/O)
  render/    Markdown → HTML matching current output
  api/       /api/internal, /api/v2, index.html
  bridge/    judge TCP server
  jobs/      Redis job queue (replaces Celery)
  realtime/  WebSocket fan-out of Redis pub/sub (replaces Node daemon)
bin/qhhoj
```

Roles communicate via Postgres and Redis only. Site → bridge commands (`django_handler.py`) become Redis messages.

## Database

- `migrations/0001_baseline.sql` owns the Postgres DDL; Django migrations frozen.
- Type mapping: `tinyint(1)`→`boolean`, `datetime(6)`→`timestamptz`, JSON text→`jsonb`, FULLTEXT→GIN `tsvector`, case-insensitive identity columns→`citext`.
- Data: pgloader (data only) + verifier (row counts, per-table checksums).
- Encrypted columns keep their current format (see foundation spec §5.5).

## Frontend design tokens

| Token | Dark (default) | Light |
|---|---|---|
| background | `#0B1020` | `#F7F5F2` |
| card / raised | `#131A2C` / `#1A2238` | `#FFFFFF` / `#F0ECE6` |
| border | `rgba(255,255,255,.08)` | `rgba(60,40,30,.12)` |
| text / muted | `#F1F5F9` / `#94A3B8` | `#1C1917` / `#57534E` |
| primary | `#E8957A` | `#B5533A` |
| secondary | `#E3DCBF` | `#8A6D3B` |

Verdicts: AC `#22C55E`, WA `#EF4444`, TLE/MLE `#F59E0B`, RTE/OLE/IR `#A78BFA`, CE `#94A3B8`, partial = 3-step green scale; always with text label.
Fonts: Inter (UI, tabular numbers), JetBrains Mono (code). Contrast ≥ 4.5:1, visible focus, reduced-motion support.

## Sub-projects

| # | Sub-project | Depends on | Contents |
|---|---|---|---|
| 1 | Foundation | — | Workspace, baseline DDL, migration pipeline, `db`, `auth`, API skeleton, CI |
| 2 | Judging core | 1 | Bridge, submissions, rejudge, languages/judges, jobs, realtime |
| 3 | Problems & content | 1 | Problems, rendering, PDFs, tags, test data/`init.yml`, Polygon import, solutions |
| 4 | Contests & ranking | 2, 3 | Contests, 9 formats, participation, standings, rescoring, ratings, PP |
| 5 | Community | 1, 3 | Profiles, organizations, blog, comments, tickets, flatpages, nav bar, newsletter/Mailgun, user activity |
| 6 | External judge | 2, 3 | Virtual judge, problem mirroring |
| 7 | Management | 2–6 | Admin APIs/screens replacing Django admin, impersonation UI, revisions |
| 8 | Frontend | 1, then per area | Shell + design system, then screens per area |
| 9 | Cutover | all | Rehearsal, acceptance run, switch, rollback plan |

## Acceptance criteria

1. Existing users log in with old passwords; TOTP and WebAuthn work.
2. Statements and blog posts render equivalently (golden corpus from production).
3. Recomputed standings, ratings, PP match stored values.
4. Existing judge-server workers grade without changes.
5. `/api/v2` responses match old shapes.
6. Migration verifier passes.
