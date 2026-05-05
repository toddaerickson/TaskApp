# TaskApp — Collaboration Guide for Claude Code

## Stack

- **Backend:** FastAPI + SQLite (dev) / PostgreSQL (prod dual-support in
  `app/database.py`). Auth via HS256 JWT + SHA-256 password hashing.
- **Mobile:** Expo + React Native + expo-router. Axios client (`mobile/lib/api.ts`).
  Zustand stores. Expo SecureStore for tokens + PIN secrets.
- **No ORM** — raw SQL with parameterized queries. Shared hydration helpers
  in `backend/app/hydrate.py`.

## Modules

- **Tasks/Folders/Subfolders/Tags/Reminders** — original GTD-style app.
- **Workouts** — exercises (global + per-user), routines, sessions, set
  logging, symptom tracking. See `app/routes/{exercise,routine,session}_routes.py`
  and `mobile/app/workout/`.
- **PinGate** — 4-digit PIN on app launch, hashed in SecureStore, optional
  Face ID / Touch ID, 15-minute soft timeout. See `mobile/components/PinGate.tsx`
  and `mobile/lib/{pin,biometric}.ts`.

## Installed Skills (in `.claude/skills/`)

Invoke via the `Skill` tool when the trigger applies. When in doubt, **run
the skill** instead of winging it — they catch things I miss.

| When | Use skill |
|---|---|
| Before merging a PR or committing multi-file changes | `code-reviewer` — automated PR analysis, complexity/risk scoring, SOLID + smell checks. Runs `pr_analyzer.py` on the diff. |
| After I say "looks good" on my own code, or before a release | `adversarial-reviewer` — counterweight to my agreeableness bias. Hostile-persona review that catches blind spots the author shares with a compliant reviewer. |
| Before shipping any user-facing UI changes | `a11y-audit` — WCAG 2.2 AA scan (color contrast, focus order, alt text, screen-reader flow). The workout UI has not been audited. |
| When colors, spacing, typography feel inconsistent across screens | `ui-design-system` — extract design tokens, document components, generate dev handoff. Our workout screens still have hardcoded colors (`#1a73e8`, `#e67e22`, `#27ae60`) duplicated in ~7 StyleSheets. |
| When a feature is "broken end-to-end" across files | `focused-fix` — systematic deep-dive repair, not single-bug patching. E.g. "session logging is flaky across mobile + API + DB." |
| When a free API doesn't cover what we need (image search, tutorial sites, open-data extraction) | `browser-automation` — Playwright-based scraping with anti-detection patterns. Use instead of brittle `urllib`+regex attempts. |

### Skill bundles (under `.claude/skills/_*/`)

Invoke sub-skills directly, e.g. `_product-team/ui-design-system`, `_project-management/senior-pm`.

| Bundle | Top picks for this project |
|---|---|
| `_product-team` | `ux-researcher-designer`, `ui-design-system`, `product-manager-toolkit`, `experiment-designer`, `spec-to-repo` |
| `_project-management` | `senior-pm`, `scrum-master`, `meeting-analyzer`, `team-communications` |
| `_ra-qm-team` | `gdpr-dsgvo-expert`, `information-security-manager-iso27001` — only relevant if this app starts handling other users' health data |

## Workflow conventions

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
  the April 2026 run the deferred-tracker flagged "Settings PIN
  management UI" as missing; it was already shipped end-to-end at
  `mobile/app/settings/account.tsx`. The agent followed
  `(tabs)/settings.tsx` and missed the chevron link. Skip findings
  that don't survive a 30-second look at the file.
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
  was deliberately punted** — at 1-5 image uploads/month the manual
  step is cheaper than wiring GitHub Contents API + admin gating +
  background tasks. Revisit (and pick R2 / S3, not git) if upload
  volume ever climbs past ~50/month.
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
  | `backup-heartbeat.yml` | Daily 12:00 UTC | Polls publish workflow age — alerts if last run >36h old (catches "cron stopped firing") |

  All three open / comment on a single `[backup] Nightly Neon
  backup is failing` issue. **That issue thread is the operator's
  only push-style notification.** Subscribe to repo issues; close
  it when a green run lands. Subsequent failures re-open via a
  fresh issue (since the search filters `state: open`).

  **PG client pin lives in two workflows** (`backup-neon.yml` +
  `backup-restore-drill.yml`). They MUST move together when Neon
  majors-upgrade. The pre-flight step in publish (PR #139) fails
  loudly with the bump-the-pin recipe when this is needed; obey
  it. A workflow lint to enforce the two pins match is on the
  open list — not yet built.

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

~705 tests across backend (pytest) and mobile (jest). Run:
```bash
cd backend && venv/bin/pytest    # 459 cases (3 PG-only skipped on the SQLite leg)
cd mobile && npm test            # 246 cases (23 suites: pure-function libs + RN component tests)
```

Counts drift fast — when you bump these, also bump the matching line
in [README.md](README.md). The `test_seed_snapshot` ratchet pattern is
the canonical example: a numeric expectation in the test that has to
move down when seed gaps close.

## CI / pre-commit

- **GitHub Actions** (`.github/workflows/ci.yml`) runs backend pytest and
  mobile tsc+jest on every push and PR.
- **Pre-commit hook** is shipped in `.githooks/pre-commit`. Enable once
  per clone: `git config core.hooksPath .githooks`. It runs the relevant
  suite only when staged changes touch that stack, and skips cleanly
  when venv/node_modules aren't present yet.

## Known gaps worth flagging when relevant

- Mobile jest is split into two projects: `node-libs` (pure-function
  libs — pin, format, progress, etc.) and `rn-components` (renders
  PinGate, Login, Register via @testing-library/react-native +
  jest-expo). Adding more component tests is straightforward — match
  the existing rn-components patterns.
- `expo-local-authentication` doesn't work in Expo Go. Needs a dev build
  (`npx expo prebuild && npx expo run:ios`) or EAS build to test Face ID.
- Route `GET /routines` and `GET /sessions` are no longer N+1 and have
  cursor-based pagination (`limit` + `cursor`). Mobile `getRoutines()`
  pages transparently; `listSessions()` accepts an optional `cursor`.
- 2 exercises still need images: `seated_soleus_stretch` and
  `banded_fire_hydrant`. Use the admin screen's "Find" button. The
  `MAX_IMAGELESS` ratchet in `backend/tests/test_seed_snapshot.py` is
  set to 2 — bump it down when you source these.
