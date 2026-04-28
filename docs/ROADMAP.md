# TaskApp roadmap

Running log of merged PRs + open items. Living document, edited as work lands.

## Infrastructure

- **Frontend**: [taskapp-workout.vercel.app](https://taskapp-workout.vercel.app) (Vercel Hobby, one production domain alias)
- **Backend**: [taskapp-workout.fly.dev](https://taskapp-workout.fly.dev) (Fly.io, 1 machine, `min_machines_running = 0` — cold starts after idle)
- **Database**: Neon Postgres (prod) / SQLite (local dev)

**Required Fly secrets** (in deploy order):
- `DATABASE_URL` — Neon connection string
- `JWT_SECRET` — `openssl rand -hex 48`
- `CORS_ORIGINS` — `https://taskapp-workout.vercel.app`
- `SNAPSHOT_AUTH_TOKEN` — gates `/health/detailed` + `/admin/snapshot`; `openssl rand -hex 32`
- `BACKEND_PUBLIC_URL` — `https://taskapp-workout.fly.dev`; required for self-hosted exercise images on RN native
- `TASKAPP_TZ` — single-tenant TZ for the missed-reminder banner; e.g. `America/New_York`

**Optional**: `SENTRY_DSN` (backend) + `EXPO_PUBLIC_SENTRY_DSN` (Vercel) for error monitoring. See [DEPLOY.md §6](../DEPLOY.md).

**Required Vercel env**: `EXPO_PUBLIC_API_URL` = `https://taskapp-workout.fly.dev`.

**Diagnostic**: `curl -H "Authorization: Bearer $SNAPSHOT_AUTH_TOKEN" https://taskapp-workout.fly.dev/health/detailed` reports presence of each secret + DB reachability.

**Schema**: numbered SQL migrations in `backend/migrations/*.sql`, applied by `scripts/migrate.py` from `fly.toml`'s `release_command`. Tracked in `schema_migrations`. The app's `init_db` verifies — never runs DDL on boot. Dual-write rule: SQLite (dev) still uses inline `SQLITE_SCHEMA` + `_ensure_columns`.

**Disaster recovery**: see [`docs/DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md). Nightly encrypted Neon dumps committed to GitHub Releases via `.github/workflows/backup-neon.yml`.

## Recently merged

### Workouts post-audit roadmap (PRs #77–#85)
All 9 items from the April audit shipped.

- **#77** tracks_symptoms end-to-end e2e fix
- **#78** session-expiration mid-workout (touch-on-error + dropped 30s poll)
- **#79** safe-area + CTA overlap on iPhone
- **#80** Workouts list CRUD parity (search + filter + sort + group-by)
- **#81** routine clone (`POST /routines/{id}/clone`)
- **#82** per-set L/R side + `is_warmup` flag
- **#83** seed library expansion (squat/pushup/pullup/deadlift/row/lunge/plank)
- **#84** Progress volume metric + CSV export
- **#85** PWA manifest + favicon + iOS install icons

### Post-ship follow-ups (PRs #86–#90)

- **#86** workout reliability: error surfacing + direct-URL recovery + touch-on-error
- **#87** routine planning: target_rpe per exercise + bench/OHP seeds
- **#88** insight + PWA: group-by x3 + heatmap + pain overlay + PDF + SW
- **#89** boot resilience: graceful CORS fallback + `/health/detailed`
- **#90** UI polish: scrollable Settings + tighter tab bar

### Disaster recovery + image self-host (PRs #93–#106)

- **#93 / #95** `docs/DISASTER_RECOVERY.md` + Neon URL fix in docs
- **#94** nightly encrypted `pg_dump` workflow → GitHub Releases
- **#101** icon-only tab bar + safe-area + routine meta in title row
- **#102** `<ExerciseImage>` component with a11y label, loading skeleton, error fallback
- **#103** `/static/exercise-images` mount + `local:` URL resolver + `BACKEND_PUBLIC_URL`
- **#104** `scripts/backfill_exercise_images.py` — download + hash + rewrite to `local:` sentinel
- **#105** CLAUDE.md: multi-agent plan-review convention (adversarial → UI/architect/PM in parallel → silent-killer → refine)
- **#106** doc: image backfill is manual; auto-self-host on save deferred (R2/S3 if it ever scales)

### Evidence-tier + duration (PRs #107–#108)

- **#107** `exercises.evidence_tier` (RCT/MECHANISM/PRACTITIONER/THEORETICAL) + `routines.target_minutes`. Filled-primary chip with per-tier Ionicon + tier filter strip in `ExercisePickerModal` + clock-pill on routine cards. Schema + Pydantic + UI + tests in one PR with cleanup commit folded in.
- **#108** seed 11 high-conviction joint-snacks exercises + 5 quick-duration routines (curated from the user's evidence-graded protocol library; STRONG-evidence × no-special-equipment cut).

### Audit-driven hardening (PRs #109–#113)

After multi-agent review of the full codebase surfaced several silent prod-only bugs:

- **#109** Tier 1a "PG correctness": `date('now')` → `CURRENT_DATE`, `LIKE` → `ILIKE` on PG, deleted dead `db_compat.py`, rate-limited `/exercises/*/search-images` to 30/min, gated `/health/detailed` behind `SNAPSHOT_AUTH_TOKEN`.
- **#110** Tier 1b "operational reliability": PinGate Reset-PIN button + 15-min PIN window (was 8h; CLAUDE.md spec drift), `KeyboardAvoidingView` on session + routine-detail screens, folder-delete uses `UndoSnackbar`, `sw.js CACHE_VERSION` stamped at deploy via `mobile/scripts/build-web.sh`.
- **#111** Tier 2 numbered SQL migrations: `scripts/migrate.py` runner + `schema_migrations` table; `init_db` PG mode now verifies instead of running DDL. `release_command` runs `migrate.py && seed_workouts.py`.
- **#112** Tier 3-V1 missed-reminder inbox banner on Workouts tab. `GET /routines/missed-reminders` + client-side dismiss in `kvStorage`. Single-tenant TZ via `TASKAPP_TZ` env. Full web push (V2) deferred — V1 captures most of the morning-routine UX with one PR and zero infra.
- **#113** banner fails silently on fetch errors → telemetry only via `reportError` (Sentry sink). Caught: a deploy-lag window made `/routines/missed-reminders` 422 (FastAPI matched it as `/{routine_id}` against the older backend), banner showed "Some required information is missing or invalid" in red over the routine list. Now an ambient feature failure is invisible to the user.

## Open

None tracked here today. The audit's UI-tier features (onboarding, dark mode, tasks export, NL quick-add, smart lists, persistent in-progress pill) and architectural debt items (`models.py` split, optimistic Zustand updates, `task_routes` hydration consolidation, error contract types) remain queued — pick from the post-audit synthesis when you want the next chunk of work.

## Deferred / parked (with rationale)

**Reminders + notifications**
- **Tier 3-V2 full web push** — VAPID + cron + service-worker push handler + iOS PWA install gating + DST-aware schema. 3-PR sequence with several documented iOS Safari quirks. PM-recommended deferral: ship the V1 inbox first, dogfood ~2 weeks, only build V2 if dogfooding shows the open-app-when-you-remember path is insufficient.

**Image self-host**
- **Auto-self-host on image save** — explicitly cut. At 1-5 image uploads/month the manual `scripts/backfill_exercise_images.py` step is cheaper than wiring GitHub Contents API + admin gating + background tasks. Revisit (and pick R2 / S3, **not** git) if upload volume ever climbs past ~50/month.

**Fitness app gaps surfaced by the UI agent**
- Plate calculator, supersets / drop-sets / AMRAP, body-weight tracking, demo media (GIFs / videos), HealthKit sync — fitness-app polish that doesn't fit a rehab-first single-user. Revisit if the workouts module feels under-featured.
- Strong / Hevy / FitNotes imports — niche; JSON export already works.
- Drag-drop routine reorder on main list — routines are <30 rows; existing within-routine arrows are enough.

**Other**
- Bulk actions on tasks / workouts lists — parked.
- Custom Vercel preview-deployment suffix — Pro-tier feature; not worth $20/mo for a solo project.
- Second Fly machine / multi-region — overkill for a single user.
- Per-side L/R targets at plan time — rare; session-time `side` already captures it.
- Superset / circuit grouping — schema change; parked behind plainer additions.

## Conventions

- Each PR ships: backend tests + mobile `tsc --noEmit` + `npm test` + a11y AST scan, all green
- Schema changes: add a numbered `backend/migrations/NNN_*.sql` (PG) AND mirror into `SQLITE_SCHEMA` + `_ensure_columns()` in `backend/app/database.py` (dev). Dual-write rule.
- No ORM; raw SQL with parameterized queries; shared hydration helpers in `backend/app/hydrate.py`
- Don't commit `taskapp.db`, `__pycache__/`, `.env`, or the TickTick CSV
- Mobile tests cover pure-function libs + a handful of RN component snapshots — no full-screen integration tests (expo-jest RN setup not installed)
- Multi-agent plan review (CLAUDE.md): for any plan that ships in 2+ PRs or touches more than one module, run adversarial → UI/architect/PM in parallel → silent-killer → refine → ask for approval
- Ambient features fail silently to telemetry, never to UI (see PR #113 pattern)
