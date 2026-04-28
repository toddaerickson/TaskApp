# TaskApp

A self-hosted GTD-style task manager plus a rehab / strength workout tracker,
running as a FastAPI backend + Expo (React Native / web) client.

Single user by design. Your server, your data, no subscription.

## What's in the box

**Tasks** — folders + subfolders, priorities, tags, recurring schedules,
reminders, starred items, and fast search. `(auth)/register` → `(tabs)/tasks`
gets you from zero to an inbox in about a minute.

**Workouts** — routines composed of exercises, with sets (weight / reps /
duration / RPE per set), priority markers (the "don't skip" moves),
phased progressions, and per-set pain tracking for rehab. Highlights:
- **Routine CRUD** — Quick-start template strip, "New routine" modal,
  exercise picker (search by name / slug / **evidence tier**), inline
  edit of sets/reps/weight via tappable dose chips, reorder / remove,
  portable JSON import.
- **Phased progression (Curovate-style)** — split a routine into phases
  (e.g. Foundation 2w → Loading 6w → Return-to-activity 4w); exercises
  tagged with a `phase_id` auto-filter based on the current phase.
- **Rehab mode** — toggle `tracks_symptoms` on a routine and sessions
  inherit a snapshot of the flag. Pain chip per set feeds a Silbernagel-
  style advance / hold / back-off policy (`progression_policies/silbernagel.py`)
  that replaces the default RPE path.
- **Evidence-tier chip** — each exercise can carry an
  `RCT / MECHANISM / PRACTITIONER / THEORETICAL` tag with an Ionicon +
  filled-primary chip + filter strip in the picker. Ships with 11
  high-conviction joint-snacks exercises (bird dog, dead bug, side
  plank, push-up plus, wall sit, wall slide, single-leg glute bridge,
  Alfredson heel drops, Copenhagen plank, cross-body stretch, inverted
  row) curated from a literature review.
- **Quick-duration routine pill** — `routines.target_minutes` drives a
  clock-icon pill on routine cards (orthogonal to `goal`, so a 5-min
  Copenhagen prehab can still be `goal: strength`). Five quick routines
  ship with the joint-snacks library.
- **Missed-reminder inbox** — a routine whose `reminder_time` already
  passed today (in `TASKAPP_TZ`) and you haven't started yet shows up
  as a banner on the Workouts tab with [Start] / [Dismiss for today].
  V1 of routine reminder UX in lieu of full web push (deferred —
  iOS-Safari-PWA quirks make it a 3-PR sequence and the inbox captures
  most of the value at one PR).
- **Suggestion engine** — next-session targets pre-fill from last session
  bests, with a human-readable reason string ("Pain 2/10 — advancing 10%"
  or "RPE 6 — add 2 reps").
- **Self-hosted exercise images** — bytes live at
  `backend/seed_data/exercise_images/<sha256>.<ext>`, served via the
  `/static/exercise-images` mount on Fly. DB rows store the sentinel
  `local:<sha256>.<ext>`; resolver expands to
  `${BACKEND_PUBLIC_URL}/static/exercise-images/...` at read time.
  Manual backfill: `python scripts/backfill_exercise_images.py --apply`.
- **Rest timer** with ±15 s / Stop, survives tapping between exercises.
- **"New PR!" badges** when a set beats the prior best for that exercise.
- **Offline queue** — if the network drops mid-workout, sets stash locally
  and flush on the next successful call.
- **Undo snackbar** — 5-second grace on every destructive action (set
  delete, routine delete, **folder delete**, etc.) — local-only until
  the timer commits.

**Auth + shell** — email / password (bcrypt, backward-compat with a legacy
SHA-256 upgrade path), 10/min login rate limit, JWT (72 h), device-level PIN
+ Face ID / Touch ID with a 15-min soft timeout, cross-platform 401
session-expired modal. PinGate "locked" state has an explicit Reset
PIN button (used to brick after 5 wrong attempts; SecureStore-backed
counter survived process restarts and the message lied about
re-launching).

**Admin** — image library for exercises with bulk paste, per-slug upload
progress, search / filter by name / category / "needs image", and a
cross-provider image picker (Pixabay + DuckDuckGo + Wikimedia Commons, with
a per-provider negative cache so a flaky API doesn't cascade).

## Stack

| Layer | Tech |
|---|---|
| Backend | FastAPI, raw SQL (no ORM) |
| DB | SQLite in dev, Postgres in prod (both schemas in sync — see `backend/migrations/001_schema.sql` + `backend/app/database.py`) |
| Migrations | Numbered SQL files in `backend/migrations/`, applied by `scripts/migrate.py` (PG-only); tracked in `schema_migrations`. Runs at deploy via `fly.toml release_command`; never on app boot. |
| Auth | HS256 JWT, bcrypt, slowapi rate limit. `/exercises/{id}/search-images` is rate-limited too (30/min) to avoid burning Pixabay/DDG/Wikimedia quotas via a leaked token. |
| Mobile | Expo SDK 52 + React Native 0.76 + expo-router, Zustand, axios + axios-retry, expo-secure-store, PWA shell with per-deploy service-worker cache versioning (`scripts/build-web.sh` stamps `taskapp-${COMMIT_SHA}` into `dist/sw.js`). |
| Observability | `X-Request-Id` middleware + ContextVar-backed log filter, structured `{detail, code, request_id}` error bodies, admin audit log, optional Sentry. `/health/detailed` is gated behind `SNAPSHOT_AUTH_TOKEN` so the field-by-field truthiness reporting isn't free recon. |
| Deploy | Fly.io (backend), Neon (DB), Vercel (web). See [DEPLOY.md](./DEPLOY.md). Disaster recovery runbook at [`docs/DISASTER_RECOVERY.md`](./docs/DISASTER_RECOVERY.md); nightly encrypted Neon dumps via GitHub Actions. |

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

Current totals: **405 backend (3 PG-only skipped on the SQLite leg) + 244 mobile**, `tsc --noEmit` + `ruff --select F` clean.

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
    database.py       # connection + SQLite schema; PG init verifies
                      #   schema_migrations stamped (no DDL on boot)
    auth.py           # bcrypt + legacy SHA-256 verify + JWT
    rate_limit.py     # slowapi limiter instance
    request_id.py     # X-Request-Id middleware + log filter
    admin_audit.py    # audit middleware for /admin/*
    hydrate.py        # shared row-hydration helpers (batched, avoids N+1)
    image_urls.py     # local: → ${BACKEND_PUBLIC_URL}/static/... resolver
    progression.py    # next-session target suggestion algorithm
  migrations/         # numbered .sql files; applied by scripts/migrate.py
    001_schema.sql    # baseline schema (idempotent, mirrors database.py)
    002_*.sql         # subsequent migrations
  scripts/
    migrate.py        # PG migration runner, called from fly.toml deploy
    backfill_exercise_images.py   # ratchet remote URLs to local: bytes
    snapshot_exercises.py         # dump library JSON for seed_data/
  seed_data/
    exercise_snapshot.json        # committed library snapshot
    exercise_images/<sha256>.<ext>  # self-hosted bytes (PR #103+)
  tests/                      # pytest suite (~405 cases)
mobile/
  app/                # expo-router file-based routes
    (auth)/           # login / register
    (tabs)/           # tasks / folders / workouts / settings
    task/             # task detail, create
    workout/          # routine detail, session, admin, progress, track
    _layout.tsx       # root layout + ErrorBoundary + session-expired modal
  components/         # PinGate, Skeleton, EvidenceTierChip,
                      #   RoutineDurationPill, MissedRemindersBanner,
                      #   ExerciseImage, UndoSnackbar, …
  lib/                # api client, stores, pr, restTimer, offlineQueue,
                      #   missedReminders, exercisePicker, …
  scripts/build-web.sh  # Vercel buildCommand: expo export + sw.js stamp
  public/sw.js        # service worker (CACHE_VERSION rewritten at deploy)
  __tests__/          # jest tests (~244)
tools/
  a11y_rn_filter.py   # wraps the a11y-audit skill, drops HTML-only rules
docs/
  ROADMAP.md                  # running log of merged PRs + open work
  DISASTER_RECOVERY.md        # Neon PITR + dump restore + full rebuild
  a11y-audit-2026-04.md       # accessibility audit + contrast report
CLAUDE.md             # AI-collaboration guide (multi-agent review
                      #   convention, skill pointers, schema sync rules)
DEPLOY.md             # Fly + Neon + Vercel setup + secret list
```

## Monitoring

Three layers, all optional and free at this scale:

- **Sentry** for backend + mobile errors. Set `SENTRY_DSN` (Fly secret)
  + `EXPO_PUBLIC_SENTRY_DSN` (Vercel env). Both `app/sentry_setup.py`
  and `lib/sentry.ts` are no-ops without the DSN. Backend forwards 5xx
  automatically; the axios interceptor (`mobile/lib/api.ts`) forwards
  5xx + network errors; ambient features like `MissedRemindersBanner`
  route their fetch failures to `reportError` instead of UI so a deploy
  lag doesn't show the user a scary red banner.
- **GitHub Actions email** for CI / deploy failures (Settings → Notifications
  → Watch this repo → Custom → check Actions). Also enable Fly deploy
  notifications at https://fly.io/dashboard/personal/notifications.
- **`/health/detailed`** behind `Authorization: Bearer $SNAPSHOT_AUTH_TOKEN`
  for ad-hoc curl checks of secret presence + DB reachability.

## Accessibility

See [`docs/a11y-audit-2026-04.md`](./docs/a11y-audit-2026-04.md) for the
most recent contrast sweep of the design tokens and the follow-up list
(darken `textMuted`, `accessibilityLabel` AST linter, CI gate).

## License

No license declared; private / personal use.
