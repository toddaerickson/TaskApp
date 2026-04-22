# TaskApp roadmap

Running log of merged PRs + open items. Living document, edited as work lands.

## Infrastructure

- **Frontend**: [taskapp-workout.vercel.app](https://taskapp-workout.vercel.app) (Vercel Hobby, one production domain alias)
- **Backend**: [taskapp-workout.fly.dev](https://taskapp-workout.fly.dev) (Fly.io, 1 machine, `min_machines_running = 0` — cold starts after idle)
- **Database**: Neon Postgres (prod) / SQLite (local dev)

Required Fly secrets: `CORS_ORIGINS` (= `https://taskapp-workout.vercel.app`), `JWT_SECRET`, `DATABASE_URL`.
Required Vercel env: `EXPO_PUBLIC_API_URL` (= `https://taskapp-workout.fly.dev`).

Diagnostic: `curl https://taskapp-workout.fly.dev/health/detailed` reports presence of each secret plus DB reachability.

**Disaster recovery**: see [`docs/DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) for the full runbook (Neon PITR restore, backup-dump restore, full rebuild on fresh Fly+Vercel, quarterly drill process).

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

## Open

- **Start-workout regression** — user reports alert still fires on tap. PR #86 improved surfacing so the alert should read `HTTP {status}: {detail} (req {id})`. Blocked on user reporting the actual text from a fresh preview build post-#89 merge. Root cause will likely be either CORS, Vercel env var, or a 5xx — diagnosable from the alert + `/health/detailed`.

## Deferred / parked (per prior planning discussions)

- HealthKit sync — requires native build; web-only user means ROI zero today
- Per-side L/R targets at plan time — rare; session-time `side` already captures it
- Strong / Hevy / FitNotes imports — niche, JSON export already works
- Drag-drop routine reorder on main list — routines are <30 rows; up/down arrows within-routine already enough
- Bulk actions on tasks / workouts lists — parked
- Superset / circuit grouping — schema change; parked behind plainer additions
- Custom Vercel preview-deployment suffix — Pro-tier feature; not worth $20/mo for a solo project
- Second Fly machine / multi-region — overkill for a single user

## Still-open from earlier plans (lower priority)

- Task import/export + reports
- Dark mode (System / Light / Dark toggle)
- Context field (GTD gate) — decision scheduled 2 weeks after PR #67, re-evaluate when user raises

## Conventions

- Each PR ships: backend tests + mobile `tsc --noEmit` + `npm test` + a11y AST scan, all green
- `backend/migrations/001_schema.sql` (PG canonical) and `SQLITE_SCHEMA` in `database.py` (dev) stay in sync — plus `_ensure_columns()` idempotent ALTER on startup for live installs
- No ORM; raw SQL with parameterized queries; shared hydration helpers in `backend/app/hydrate.py`
- Don't commit `taskapp.db`, `__pycache__/`, `.env`, or the TickTick CSV
- Mobile tests cover pure-function libs + a handful of RN component snapshots — no full-screen integration tests (expo-jest RN setup not installed)
