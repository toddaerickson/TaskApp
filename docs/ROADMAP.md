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

### Post-ship audit (PRs #116–#120)

Five-agent post-ship audit (adversarial / silent-killer / code-QA /
deferred-tracker / synthesis) on the #107–#113 work surfaced ~30
items; convergent BLOCKs shipped as a numbered sequence:

- **#116** PR-X1 critical fixes: rename `002_fix_boolean_columns.sql` → `003_fix_boolean_columns.sql` (numeric-prefix collision with `002_drop_phases.sql`); `004_evidence_tier_and_target_minutes_safety.sql` corrective ALTER (PR #107 retroactively edited `001_schema.sql`, leaving stamped-pre-#107 prod DBs missing the new columns); `MissedRemindersBanner` stale closure on first focus + don't-wipe-state on transient error; silent-fail telemetry pattern propagated to `loadRoutines` + `listSessions`; `test_snapshot_evidence_tier_matches_seed_workouts` value-equality ratchet.
- **#117** PR-X2 a11y + UX: REHAB chip white-on-`#e67e22` (2.65:1) → `colors.warningText` (≥ 4.63:1); PRIORITY chip white-on-`#d4a017` (2.2:1) → new `colors.accentText` `#7a5500` (≥ 7.8:1); banner Start + Dismiss 32pt → 44×44pt; tier filter empty-state copy split into query/tier/both branches with action button.
- **#118** PR-X3 validation + observability: Pydantic field validators on `reminder_time` (`^([01]\d|2[0-3]):[0-5]\d$`) + `reminder_days` (CSV gate); DST-safe `expected_local` via explicit `datetime(...,tzinfo=tz)` (replaces `now_local.replace(hour=hh)` which broke on US spring-forward); `_operator_tz` cache + warn-once on invalid `TASKAPP_TZ`; `_preflight_log()` startup audit (one structured `preflight=` line with TZ + presence-only env flags).
- **#119** PR-X4 architectural cleanup: `app/reminders.py` extracted (TZ + day-token + `compute_missed_reminders()`); `MissedReminder` Pydantic moved to `models.py`; `tests/test_route_order.py` asserts `/missed-reminders` declared before `/{routine_id}`; `conftest.tz_pinned` fixture replaces ad-hoc `fixed_now` + monkeypatch + cache-bust dance.
- **#120** PR-X5 docs (this PR): ROADMAP updated; CLAUDE.md test counts (200 → 660); CLAUDE.md post-ship audit convention codified; `docs/v2-web-push-plan.md` captures the deferred Tier 3-V2 plan.

### Silent-deploy recovery + web-tap polish (PRs #121–#134)

A 4-day silent-deploy outage was discovered when the user reported "tap green check on completed task does nothing." Four front-end-hardening PRs (#128/#129/#130/#131) shipped before the build-stamp diagnostic from #127 broke the misdiagnosis pattern and surfaced the actual root cause: `fly.toml`'s `release_command` had been silently aborting deploys since PR #111 due to a `&&`-without-`sh -c` parsing bug. Six backend PRs sat in master without ever reaching prod.

- **#121 / #134** Knee Valgus PT rehab routine seed; `GLOBAL_ROUTINES` auto-materializes for every registered user on every release_command run. Pattern: add a slug to that list to make a routine "shipped to everyone."
- **#122** task uncomplete toggle — `POST /tasks/{id}/uncomplete` (symmetric to `/complete`) + `useTaskStore.complete` reads `current.completed` and dispatches accordingly. Idempotent on already-active tasks.
- **#123** PinGate keyboard input on web — digits 0–9 + Backspace via `document.addEventListener('keydown')`. jsdom-pinned tests guard the path.
- **#124** logout button no-op on web — `Alert.alert` `onPress` callbacks don't fire reliably on RN Web. Mirrored the platform-aware `confirmDestructive` pattern (`Platform.OS === 'web'` falls back to `window.confirm`).
- **#125** hoisted `showError` / `showInfo` to `mobile/lib/alerts.ts`; replaced 9 callsites that were either bare `Alert.alert(title, msg)` (silent on web) or `if (Platform.OS === 'web') window.alert(...)` with no else (silent on native).
- **#126** a11y sweep — `colors.warning` text → `colors.warningText` on streak/reminder/due-date callsites (2.65:1 → 4.63:1); `RoutineImportCard` `smallBtn` minHeight 32→44; image-delete X hitSlop 4→8; folder rows `accessibilityRole="button"`.
- **#127** **build SHA + timestamp footer in Settings** — sourced via `EXPO_PUBLIC_BUILD_SHA` baked at build time by `scripts/build-web.sh`. Made post-deploy verification a one-tap check instead of requiring devtools. THIS is what unstuck the toggle-bug arc.
- **#128–#131** RN Web nested-Pressable bubble class. Lesson: RN Web's `Pressable` uses a dual event system; `e.stopPropagation()` only stops the responder bubble, but the outer Pressable's native DOM `onClick` still fires regardless. The proper fix (#131) is to STOP NESTING — outer container becomes a `<View>`, action handlers are sibling Pressables. Closes the bubble class across tasks/folders/sheets/ExerciseBlock.
- **#132** **`fly.toml release_command` `sh -c` wrapper** — THE root cause. Fly tokenizes `release_command` with shlex and execs directly without an implicit shell, so `&&` was passed as a literal argv to `migrate.py`. Six backend PRs (#112, #116, #118, #119, #121, #122) silently failed to deploy for 4 days. Fix wraps in `sh -c '...'` per Fly's canonical recipe.
- **#133** CI lint — `backend/scripts/lint_fly_release_command.py` blocks the regression class. Future contributors who try to "simplify" the wrapper get a red build with the exact fix recipe in the failure output.

## Open

Audit's Tier-2 / Tier-3 items remain queued. Pick from this list when
you want the next chunk of work — each is sized to one PR unless noted.

**UI-tier features**

- [ ] **Onboarding** — single-screen "what is this" + "what would you like to track first" → routes to `/(auth)/register` with the chosen first-tab pinned. Replaces the cold-start `(auth)/login` for first-launch users. (no spec yet)
- [ ] **Dark mode** — `colors.ts` is already token-driven; need a `useColorScheme()` hook + variant tokens + persist in `kvStorage`. ~3 day chunk because every StyleSheet that picks a hex literal has to migrate to a token. Half the work was done implicitly when `colors.warning` etc. landed.
- [ ] **Tasks export** — `/tasks/export` JSON endpoint + Settings row, mirroring the Workouts pattern. The hard part is the recurrence-rule round-trip; copy from the iCal-style serializer in mobile.
- [ ] **NL quick-add** — "tomorrow at 7am buy milk @errands #urgent" → folder + due + tag + priority. Use chrono-node-style parsing on the client (no LLM round-trip; latency matters). Ship to tasks tab first.
- [ ] **Smart lists** — saved query → pinned in the folders sidebar. Schema: `smart_lists(user_id, name, query_json)`. Reuse the existing tasks filter shape.
- [ ] **Persistent in-progress workout pill** — when a session is open and you tab away, show a 2-line pill above the tab bar. Tap → resume. Subscribe a Zustand selector to `currentSessionId`. Cross-tab via `BroadcastChannel` on web.

**Architectural debt**

- [ ] **`models.py` split** — `backend/app/models.py` is approaching 600 lines; split into `models/{auth,task,routine,session,exercise,reminder}.py`. PR #119 already extracted `MissedReminder` next to `RoutineResponse`; the rest are similar. Update imports + add `model_rebuild()` shims.
- [ ] **Optimistic Zustand updates** — `useWorkoutStore` + `useTaskStore` always wait for the server to reflect mutations. Switch to optimistic-with-rollback for the common cases (toggle complete, reorder, edit name). Pattern: action sets the new state, calls API, rolls back on failure with `UndoSnackbar` already wired.
- [ ] **`task_routes.py` hydration consolidation** — uses one-off SELECTs; should batch via `app/hydrate.py` like routines did in commit 788a5b9. ~50 N+1 candidates. Add a benchmark before/after.
- [ ] **Error contract types** — backend returns `{detail, code, request_id}` but the mobile axios layer treats `e.response.data.detail` ad-hoc. Define a shared `ApiError` type; centralize the unpack in `lib/apiErrors.ts`; remove the ~12 places that re-walk the same shape.
- [ ] **Residual `colors.warning` non-body callsites** — body-text instances were swept in #126. Remaining instances are workout-screen labels + chip backgrounds + icons (`workout/session/[id].tsx:940`, `workout/admin.tsx:351`, `workout/[routineId].tsx:340`, `task/[id].tsx:34`, `task/create.tsx:29`). Documented in `docs/a11y-audit-2026-04.md` "Residual" section; cleanest path is the AST-linter sweep below.
- [ ] **RN a11y AST linter + CI gate** — walk `mobile/app` and `mobile/components` for missing `accessibilityLabel`, undersized tap targets, and bad contrast tokens. ~50–100 LOC pure Python over a TS regex fallback or `@typescript-eslint/parser`. Wire into `.github/workflows/ci.yml` once it lands. Closes the only unticked items in `docs/a11y-audit-2026-04.md`.
- [ ] **Deploy-failure observability** — Fly's auto-deploy silently failed for 4 days in late April 2026 because failure-only email notifications weren't wired. Options: Fly release webhook → Sentry breadcrumb, or one-line `if: failure()` step in `.github/workflows/fly-deploy.yml` that posts to a channel. The CI lint in #133 catches the *static* class; this catches the runtime class.
- [ ] **Backend SHA in `/health/detailed`** — extends #127's frontend-SHA pattern so a single Settings tap can compare frontend SHA + backend SHA. Makes future "is it actually deployed?" questions a 5-second check.

Pull from the synthesis when you want the next chunk; each item is
its own PR.

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
