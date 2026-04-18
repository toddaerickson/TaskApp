# TaskApp

A self-hosted GTD-style task manager plus a rehab / strength workout tracker,
running as a FastAPI backend + Expo (React Native / web) client.

Single user by design. Your server, your data, no subscription.

## What's in the box

**Tasks** — folders + subfolders, priorities, tags, recurring schedules,
reminders, starred items, and fast search. `(auth)/register` → `(tabs)/tasks`
gets you from zero to an inbox in about a minute.

**Workouts** — routines composed of exercises, with sets, weight / reps /
duration / RPE per set, and symptom tracking (useful for rehab programs).
Mid-session features:
- Rest-timer banner with ±15 s / Stop controls, survives tapping between
  exercises
- "New PR!" badges when a set beats your prior best for that exercise
- Offline queue — if the network drops mid-workout, sets are stashed
  locally and flushed on the next successful call
- Suggestions pre-fill next-set targets based on your last session

**Auth + shell** — email / password (bcrypt, backward-compat with a legacy
SHA-256 upgrade path), 10/min login rate limit, JWT (72 h), device-level PIN
+ Face ID / Touch ID with a 15-min soft timeout, cross-platform 401
session-expired modal.

**Admin** — image library for exercises with bulk paste, per-slug upload
progress, search / filter by name / category / "needs image", and a
cross-provider image picker (Pixabay + DuckDuckGo + Wikimedia Commons, with
a per-provider negative cache so a flaky API doesn't cascade).

## Stack

| Layer | Tech |
|---|---|
| Backend | FastAPI, raw SQL (no ORM) |
| DB | SQLite in dev, Postgres in prod (both schemas in sync, see `backend/migrations/001_schema.sql` + `backend/app/database.py`) |
| Auth | HS256 JWT, bcrypt, slowapi rate limit |
| Mobile | Expo SDK 52 + React Native 0.76 + expo-router, Zustand, axios + axios-retry, expo-secure-store |
| Observability | `X-Request-Id` middleware + ContextVar-backed log filter, structured `{detail, code, request_id}` error bodies, admin audit log |
| Deploy | Fly.io (backend), Neon (DB), Vercel (web). See [DEPLOY.md](./DEPLOY.md). |

## Quickstart (local dev)

```bash
# backend — creates taskapp.db on first run
cd backend
python3 -m venv venv
venv/bin/pip install -r requirements.txt
venv/bin/uvicorn main:app --reload
# http://localhost:8000/docs for the OpenAPI UI

# mobile (separate shell)
cd mobile
npm install
npx expo start
# press w for web, or scan the QR with Expo Go on your phone
```

Register a user in the app, then (optionally) seed workout routines:

```bash
cd backend
venv/bin/python seed_workouts.py your@email.com all
```

## Tests

**Backend** — pytest against both SQLite and Postgres matrices in CI:

```bash
cd backend && venv/bin/pytest
```

**Mobile** — jest, split into a node-only project (pure-function libs) and
an `rn-components` project (renders PinGate, Login, Register):

```bash
cd mobile && npm test
```

Current totals: **209 backend + 100 mobile**, `tsc --noEmit` + `ruff --select F` clean.

## CI

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs backend pytest
(sqlite + postgres matrix), ruff `--select F`, mobile `tsc`, and jest on
every push and pull request. A second workflow
(`.github/workflows/snapshot.yml`) keeps `backend/seed_data/exercise_snapshot.json`
in sync with the live library via the `/admin/snapshot` endpoint.

## Project layout

```
backend/
  app/
    routes/           # one file per resource (tasks, routines, sessions, …)
    models.py         # pydantic request/response shapes
    database.py       # connection + SQLite schema
    auth.py           # bcrypt + legacy SHA-256 verify + JWT
    rate_limit.py     # slowapi limiter instance
    request_id.py     # X-Request-Id middleware + log filter
    admin_audit.py    # audit middleware for /admin/*
    hydrate.py        # shared row-hydration helpers (batched, avoids N+1)
    progression.py    # next-session target suggestion algorithm
  migrations/001_schema.sql   # Postgres schema (mirrors database.py)
  seed_data/                  # committed exercise snapshot
  tests/                      # pytest suite
mobile/
  app/                # expo-router file-based routes
    (auth)/           # login / register
    (tabs)/           # tasks / folders / workouts / settings
    task/             # task detail, create
    workout/          # routine detail, session, admin, progress, track
    _layout.tsx       # root layout + ErrorBoundary + session-expired modal
  components/         # PinGate, Skeleton, DateField, Dropdown
  lib/                # api client, stores, pr, restTimer, offlineQueue, …
  __tests__/          # jest tests (pure-function libs + rn-components)
tools/
  a11y_rn_filter.py   # wraps the a11y-audit skill, drops HTML-only rules
docs/
  a11y-audit-2026-04.md       # most recent accessibility audit + contrast report
CLAUDE.md             # AI-collaboration guide (workflow conventions, skill pointers)
DEPLOY.md             # Fly + Neon + Vercel setup
```

## Accessibility

See [`docs/a11y-audit-2026-04.md`](./docs/a11y-audit-2026-04.md) for the
most recent contrast sweep of the design tokens and the follow-up list
(darken `textMuted`, `accessibilityLabel` AST linter, CI gate).

## License

No license declared; private / personal use.
