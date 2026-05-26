# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# TaskApp — Collaboration Guide for Claude Code

## Stack

- **Backend:** FastAPI + SQLite (dev) / PostgreSQL (prod dual-support in
  `app/database.py`). Auth via HS256 JWT (30-day expiry) + bcrypt password hashing.
  No `/auth/verify-password` endpoint — it existed for the PinGate reset flow,
  removed with PinGate in #180. Don't recreate it unless there's a new caller
  that genuinely needs read-only credential re-verification.
- **Mobile:** Expo + React Native + expo-router. Axios client (`mobile/lib/api.ts`).
  Zustand stores. Expo SecureStore for the JWT.
- **No ORM** — raw SQL with parameterized queries. Shared hydration helpers
  in `backend/app/hydrate.py`.

## Modules

- **Tasks/Folders/Subfolders/Tags/Reminders** — original GTD-style app.
- **Workouts** — exercises (global + per-user), routines, sessions, set
  logging, symptom tracking. See `app/routes/{exercise,routine,session}_routes.py`
  and `mobile/app/workout/`.

## Skills

The `.claude/skills/` directory was removed in commit `1d62294` ("Remove 285
unused .claude/skills/ files"). The multi-agent review conventions below
referenced sub-skills like `adversarial-reviewer`, `silent-killer`,
`code-reviewer`, `a11y-audit`, `ui-design-system`, `focused-fix`, and
`browser-automation` — none of those are currently installed. If you need
that workflow, reinstall the skills first or run the equivalent reasoning
manually via the Agent tool with `subagent_type=general-purpose`.

## Workflow conventions

- **Default ship loop** — for any task that produces a code change:
  commit → push → open a non-draft PR → let CI run → if all required
  checks go green, squash-merge → delete the branch (local + remote) →
  move to the next task. If there is no next task, prompt the operator.
  Don't pause for permission between these steps unless something
  fails or is architecturally ambiguous. Don't open PRs as drafts.
  Don't merge on red — fix the failure or surface it.
- **Don't commit** `taskapp.db`, `__pycache__/`, `.env`, or the TickTick CSV.
  `*.db` is in `.gitignore`; the CSV is not.
- **Schema changes** go in BOTH `backend/migrations/001_schema.sql` (PG) and
  `backend/app/database.py` `SQLITE_SCHEMA` (SQLite). Keep them in sync.
- **Pydantic models** in `backend/app/models.py` need `model_rebuild()` at
  the bottom if they use forward refs.
- **New routes**: add router in `backend/app/routes/X_routes.py`, import
  and `include_router` in `backend/main.py`.
- **Mobile routing** is file-based via expo-router. Files under `app/` are
  routes; put non-route components under `components/` or `lib/`.
- **Batch hydration**: use helpers in `backend/app/hydrate.py`. Do NOT write
  per-row hydration loops in route files — they caused N+1s that were fixed
  in commit 788a5b9.
- **Set logging** is race-safe: don't send `set_number` from the client;
  the server assigns it atomically. See `/sessions/{id}/sets`.
- **Multi-agent plan review (pre-implementation)** — for any plan
  that ships in 2+ PRs or touches more than one module: (1)
  adversarial agent critiques the plan; (2) UI + software-architect +
  project-manager agents review *in parallel* to add value; (3)
  silent-killer agent finds problems; (4) whichever agent owns each
  finding refines the plan; (5) ask me to approve before starting
  work.
- **Multi-agent post-ship audit (after a multi-PR feature lands)** —
  separate convention from the plan review above; runs *after* the
  PRs merge to find what shipped that we'd want to fix in a follow-up
  sequence. Five agents in parallel, each writing back a SEVERE /
  IMPORTANT / NICE-TO-HAVE punch list:
  1. **adversarial-reviewer** — hostile read of the merged diff
  2. **silent-killer** — focus on bugs that are silent in dev but
     surface in prod (race conditions, TZ/DST, schema drift, route
     ordering, lock files)
  3. **code-reviewer** — SOLID + complexity + dead code + module size
  4. *Deferred-tracker pass* — read every "deferred" / "punted" /
     "out of scope" comment in CLAUDE.md + recent PRs, sanity-check
     they're still the right call given what shipped
  5. **Synthesis agent** — dedupes the four findings into a
     prioritized PR sequence, calls out which agent flagged each
     item (so when two agents converge on the same finding, you know
     it's a real BLOCK not a one-agent opinion).

  Then ship the BLOCK / SEVERE items in a numbered PR sequence
  (e.g. PR-X1..PR-X5 for the April 2026 audit: critical fixes →
  a11y → validation → architecture → docs). Each PR description
  links the audit findings back to which agent flagged them.
  See PRs #116, #117, #118, #119, #120 for the canonical example.

  **Don't** trust an audit agent's claim without spot-checking — in
  the April 2026 run the deferred-tracker flagged a "missing"
  Settings sub-screen that was already shipped end-to-end one
  chevron-tap below `(tabs)/settings.tsx`. Audit agents that crawl
  the tab root and don't follow links produce false positives at
  this exact shape. Skip findings that don't survive a 30-second
  look at the file.
- **Self-hosted exercise images** — image bytes live at
  `backend/seed_data/exercise_images/<sha256>.<ext>`, served via the
  `/static/exercise-images` mount on Fly. DB rows store the sentinel
  `local:<sha256>.<ext>` and `app/image_urls.resolve_image_url()`
  expands it to `${BACKEND_PUBLIC_URL}/static/exercise-images/...` at
  read time. New images get added remotely via the existing Find /
  bulk-paste flow (URL stays as `https://...`); to migrate them to
  self-hosted bytes, run the manual backfill:

  ```bash
  cd backend
  venv/bin/python scripts/backfill_exercise_images.py             # dry-run, audit
  venv/bin/python scripts/backfill_exercise_images.py --apply     # mutate
  cd .. && git add backend/seed_data/exercise_images
  git commit -m "chore: backfill self-hosted exercise images"
  git push                                                        # deploy follows
  ```

  The script is idempotent + content-addressed, so reruns only fetch
  URLs that haven't been self-hosted yet. **Auto-self-hosting on save
  is now live** — PR-A2b (#153) wired `add_image` + `bulk_images`
  through `R2Storage.put_object` when `config.r2_configured()`. The
  git-backed `backfill_exercise_images.py` script is now strictly the
  migrate-old-rows tool; new admin uploads land in R2 immediately on
  R2-configured deploys. Dev (no R2 secrets) stays in URL-passthrough
  mode.
- **Routine reminders (V1)** — `GET /routines/missed-reminders` returns
  routines whose `reminder_time` already passed today (in operator
  TZ) and the user hasn't started yet. Surfaces as a banner at the
  top of the Workouts tab via `MissedRemindersBanner`. **TZ source is
  the `TASKAPP_TZ` env var** (IANA, default `UTC`) — single-tenant
  hack to avoid a `users.timezone` schema migration. Set on Fly:
  `fly secrets set TASKAPP_TZ=America/New_York`. **Full web push** is
  deliberately deferred: requires VAPID keys + service-worker push
  handler + a 5-min cron + iOS-PWA install gating + DST-aware schema
  changes. The in-app banner captures most of the value at one PR;
  revisit V2 if dogfooding shows the open-app-when-you-remember path
  is insufficient.
- **Global vs per-user routines** — `seed_workouts.GLOBAL_ROUTINES`
  (e.g. `["knee_valgus_pt"]`) auto-materializes for every registered
  user on every `release_command` run via
  `seed_global_routines_for_all_users()`. To make a routine "shipped
  to everyone," add the slug there. To make a routine **per-user-only**
  (someone's custom plan, an ad-hoc protocol), leave it out of
  `GLOBAL_ROUTINES` and seed manually:
  `fly ssh console -a taskapp-workout -C "cd /app && python seed_workouts.py user@email.com <slug>"`.
  Both paths use the same idempotent `seed_routine_for(email, slug)`
  helper, so re-runs are safe.
- **Verify deploy before debugging code** — when a freshly-merged
  endpoint or screen "doesn't work," the FIRST diagnostic is the
  build-stamp, NOT a source dive. PWA Settings tab footer shows
  `Build <sha> · <timestamp>` (PR #127); compare against the latest
  master commit on GitHub. If SHA matches: it's a real bug, dig into
  source. If SHA mismatches: the user is on a stale bundle — full
  Safari Clear-Data + delete-and-re-add home-screen icon. The April
  2026 toggle-bug arc spent 4 PRs hardening front-end Pressables
  before realizing the backend route literally didn't exist on prod
  because Fly's `release_command` had been silently aborting deploys
  for 4 days. The build-stamp diagnostic is what finally broke the
  misdiagnosis pattern; treat it as the first question for any
  user-reported "doesn't work" report.
- **NEVER reference `secrets.X` directly in a GitHub Actions `if:`**
  clause (job-level OR step-level). GitHub rejects this with
  "Unrecognized named-value: 'secrets'" and fails the ENTIRE
  workflow file at registration. The blast radius isn't just the
  one step — every event (push, pull_request, schedule,
  workflow_dispatch) produces a 0s phantom failure run, and the
  cron silently stops firing. PR-X2 is the canonical fix:
  materialize the secret in `env:`, then gate via bash inside
  `run:`:
  ```yaml
  env:
    R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
  run: |
    if [ -z "${R2_ENDPOINT:-}" ]; then
      echo "R2 not configured — skipping"; exit 0
    fi
    # ...
  ```
  Rejected: `if: ${{ secrets.R2_ENDPOINT != '' }}`. Same trap
  applies to `vars.X` in `if:` (use `env.X` instead, after
  materializing). The May 2026 backup-pipeline outage was this
  exact mode — registration broke May 4 when the R2 mirror step
  shipped, and the heartbeat single-dimension check (since
  hardened in PR-X1) hid it for two days.
- **Pinning `postgresql-client-N` is not enough — also prepend
  `/usr/lib/postgresql/N/bin` to `GITHUB_PATH`.** Ubuntu 24.04
  runners install `postgresql-client-N` from pgdg alongside the
  default `postgresql-client-16`, but `/usr/bin/pg_dump` is the
  pg_wrapper, which on a multi-major install picks the OLDER
  major (the "default cluster"). The pinned client is on disk
  but not the binary that actually runs. Without the PATH
  prefix, pg_dump silently runs as v16 against a v17 Neon
  server and aborts with `server version mismatch`. PR-X3 is
  the canonical fix shape — single-line addition at the end of
  the install step:
  ```bash
  sudo apt-get install -y --no-install-recommends postgresql-client-17
  echo "/usr/lib/postgresql/17/bin" >> "$GITHUB_PATH"
  ```
  Both `backup-neon.yml` and `backup-restore-drill.yml` carry
  this; when Neon majors-upgrade, BOTH the apt pin AND this
  PATH literal must move together (in addition to the parity
  guard from `workflow-lint.yml`). The `Verify pg_dump version`
  step is the canary that catches a regression here.
- **`fly.toml release_command` MUST be wrapped in `sh -c '...'`**
  for any multi-command chain. Fly tokenizes via shlex and execs
  directly without an implicit shell — `&&`, `|`, `;` etc. become
  literal argv tokens to the first program. Caught in CI by
  `backend/scripts/lint_fly_release_command.py` (PR #133). Don't
  "simplify" the wrapper.
- **Backup pipeline = three workflows + one alert thread** (PRs
  #136–#143). The pipeline survives the publish workflow itself
  failing silently (which it did 9 nights in a row before this
  rebuild), the dump being unrestorable, and cron stopping
  altogether.

  | Workflow | Cadence | Catches |
  |---|---|---|
  | `backup-neon.yml` | Daily 07:00 UTC | Publish dump → GH Release (+ optional R2 mirror) + `schema_state.txt` sidecar |
  | `backup-restore-drill.yml` | Weekly Mon 09:00 UTC | Decrypt + restore into PG 17 container, assert critical tables non-empty (catches "dump exists but is a brick") |
  | `backup-heartbeat.yml` | Daily 12:00 UTC | Two-dimensional check (PR-X1): alerts if (a) most recent SUCCESS run >36h old OR (b) most recent SCHEDULE-event run >36h old. Catches both "publish keeps failing" and "cron stopped firing." Single-dimension age check was insufficient — phantom push-event failed runs masked a 5-day cron silence in May 2026. |

  All three open / comment on a single `[backup] Nightly Neon
  backup is failing` issue. **That issue thread is the operator's
  only push-style notification.** Subscribe to repo issues; close
  it when a green run lands. Subsequent failures re-open via a
  fresh issue (since the search filters `state: open`).

  **PG client pin lives in two workflows** (`backup-neon.yml` +
  `backup-restore-drill.yml`). They MUST move together when Neon
  majors-upgrade. The pre-flight step in publish (PR #139) fails
  loudly with the bump-the-pin recipe when this is needed; obey it.
  The `Postgres client pin matches across backup workflows` job in
  `workflow-lint.yml` (lines 27–50) greps both files and fails CI
  with `::error::PG client pin mismatch` if they diverge — keeps
  the two pins in sync without operator memory.

  **R2 mirror is opt-in** — set the four `R2_*` repo secrets
  (recipe in `docs/DISASTER_RECOVERY.md` § Required secrets) to
  enable. Unset = silent skip. Lifecycle rules on the bucket
  must match `RETENTION_DAYS=30` in the workflow; not auto-synced.

  Full restore runbook: `docs/DISASTER_RECOVERY.md`. Don't
  improvise during a real outage — read schema_state.txt first
  (before decrypt) to confirm the backup vintage.

## Running locally

```bash
# Backend
cd backend && venv/bin/uvicorn main:app --reload
venv/bin/python seed_workouts.py your@email.com all   # seed routines

# Mobile
cd mobile && npx expo start
```

## Tests

~820 tests across backend (pytest) and mobile (jest). Run:
```bash
cd backend && venv/bin/pytest    # 511 cases (3 PG-only skipped on the SQLite leg)
cd mobile && npm test            # 306 cases (split into `node-libs` and `rn-components` projects)
```

Counts drift fast — when you bump these, also bump the matching line
in [README.md](README.md). The `test_seed_snapshot` ratchet pattern is
the canonical example: a numeric expectation in the test that has to
move down when seed gaps close.

To run a single backend test: `venv/bin/pytest tests/test_<file>.py::test_<name>`.
For a single mobile test: `npm test -- -t "<test name pattern>"` or
`npm test -- <path/to/file.test.ts>`.

## CI / pre-commit

- **GitHub Actions** (`.github/workflows/ci.yml`) runs backend pytest and
  mobile tsc+jest on every push and PR.
- **Pre-commit hook** is shipped in `.githooks/pre-commit`. Enable once
  per clone: `git config core.hooksPath .githooks`. It runs the relevant
  suite only when staged changes touch that stack, and skips cleanly
  when venv/node_modules aren't present yet.

## Known gaps worth flagging when relevant

- Mobile jest is split into two projects: `node-libs` (pure-function
  libs — format, progress, etc.) and `rn-components` (renders Login,
  Register via @testing-library/react-native + jest-expo). Adding more
  component tests is straightforward — match the existing rn-components
  patterns.
- Route `GET /routines` and `GET /sessions` are no longer N+1 and have
  cursor-based pagination (`limit` + `cursor`). Mobile `getRoutines()`
  pages transparently; `listSessions()` accepts an optional `cursor`.
- 2 exercises still need images: `seated_soleus_stretch` and
  `banded_fire_hydrant`. Use the admin screen's "Find" button. The
  `MAX_IMAGELESS` ratchet in `backend/tests/test_seed_snapshot.py` is
  set to 2 — bump it down when you source these.
