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
- **Multi-agent plan review** — for any plan that ships in 2+ PRs or
  touches more than one module: (1) adversarial agent critiques the
  plan; (2) UI + software-architect + project-manager agents review
  *in parallel* to add value; (3) silent-killer agent finds problems;
  (4) whichever agent owns each finding refines the plan; (5) ask me
  to approve before starting work.
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

## Running locally

```bash
# Backend
cd backend && venv/bin/uvicorn main:app --reload
venv/bin/python seed_workouts.py your@email.com all   # seed routines

# Mobile
cd mobile && npx expo start
```

## Tests

200 tests across backend (pytest) and mobile (jest). Run:
```bash
cd backend && venv/bin/pytest    # 155 cases
cd mobile && npm test            # 45 cases (3 suites, pure-function libs only)
```

## CI / pre-commit

- **GitHub Actions** (`.github/workflows/ci.yml`) runs backend pytest and
  mobile tsc+jest on every push and PR.
- **Pre-commit hook** is shipped in `.githooks/pre-commit`. Enable once
  per clone: `git config core.hooksPath .githooks`. It runs the relevant
  suite only when staged changes touch that stack, and skips cleanly
  when venv/node_modules aren't present yet.

## Known gaps worth flagging when relevant

- Mobile tests cover pure-function libs only (pin, format, progress).
  No component / RN-rendering tests yet — the heavy Expo+RN test setup
  isn't installed. PinGate and screen flows are still TS+runtime only.
- `expo-local-authentication` doesn't work in Expo Go. Needs a dev build
  (`npx expo prebuild && npx expo run:ios`) or EAS build to test Face ID.
- Route `GET /routines` and `GET /sessions` are no longer N+1 and have
  cursor-based pagination (`limit` + `cursor`). Mobile `getRoutines()`
  pages transparently; `listSessions()` accepts an optional `cursor`.
- 2 exercises still need images: `seated_soleus_stretch` and
  `banded_fire_hydrant`. Use the admin screen's "Find" button. The
  `MAX_IMAGELESS` ratchet in `backend/tests/test_seed_snapshot.py` is
  set to 2 — bump it down when you source these.
