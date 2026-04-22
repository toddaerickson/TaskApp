# Disaster recovery — TaskApp

Single source of truth for how to restore production after a data-loss event. Living document; update whenever secrets, services, or the restore procedure change.

## Architecture

```
          Client (iPhone Safari, laptop browser)
               │
               ▼
        https://taskapp.vercel.app
        (Vercel Hobby, Expo web static assets)
               │
               ▼
        https://taskapp-workout.fly.dev
        (Fly.io, 1 stateless machine, FastAPI)
               │
               ▼
        Neon Postgres — the only place user data lives
```

Source: https://github.com/toddaerickson/TaskApp — CI/CD only. **No runtime writes to GitHub except one `repository_dispatch` event that re-commits `backend/seed_data/exercise_snapshot.json` (curated library metadata, not user data).**

All user-generated state — accounts, tasks, routines, sessions, set logs, symptom logs — lives in **Neon Postgres**. Fly machines are ephemeral. Nothing persists on disk there.

## Required secrets

| Secret | Where stored | What it does | Rotation cost |
|---|---|---|---|
| `DATABASE_URL` | Fly (`taskapp-workout` app) | Neon connection string the app uses | Low — create a new Neon role + update the Fly secret; machine restarts |
| `JWT_SECRET` | Fly | Signs auth tokens. Rotating invalidates every live session. | Medium — all users re-login |
| `CORS_ORIGINS` | Fly | Comma-separated list of allowed frontend origins | Low — update the Vercel production domain string |
| `SENTRY_DSN` | Fly (optional) | Error reporting. No-op if unset. | None — cosmetic |
| `EXPO_PUBLIC_API_URL` | Vercel (`taskapp` project, all environments) | Frontend bundle's backend URL, inlined at build time by Metro | Medium — re-build Vercel |
| `GITHUB_DISPATCH_TOKEN` | Fly (optional) | Fine-grained PAT that fires the snapshot workflow | Low — create a new PAT, update the secret |

**Backup secrets** (when the nightly backup workflow lands — see "Off-site backups" below):

| Secret | Where stored | What it does |
|---|---|---|
| `NEON_READONLY_DATABASE_URL` | GitHub repo secrets | Read-only Neon role the workflow uses; isolated from the app role |
| `BACKUP_PASSPHRASE` | GitHub repo secrets + operator's password manager | GPG symmetric key for the nightly dumps. **Losing this makes every backup unusable. Store it in two places.** |

## Scenario 1 — User deletes data by mistake, or the app corrupts a table

Recovery window: **minutes to hours**. Source of truth: Neon's point-in-time recovery (PITR).

Neon's Hobby plan includes 7 days of PITR. The cheapest restore is a Neon **branch** forked at the moment before the bad change.

```bash
# 1. Fork the DB to the desired timestamp (UTC).
neonctl branches create --project-id <project> \
  --name rescue-$(date -u +%Y%m%dT%H%M%S) \
  --parent main \
  --timestamp '2026-04-21T14:00:00Z'

# The command prints a connection string for the branch.
export RESCUE_URL='postgresql://...rescue-branch...'

# 2. Sanity-check the fork — did the expected rows come back?
psql "$RESCUE_URL" <<'SQL'
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM tasks;
SELECT COUNT(*) FROM workout_sessions;
SELECT MAX(started_at) FROM workout_sessions;
SQL
```

**Two restore modes.** Pick based on whether you're willing to lose data written after the target timestamp.

### Mode A — Point-in-time replace (lose changes since timestamp)

Use when the bad change happened recently and there's nothing between the bad change and "now" worth keeping.

```bash
# Flip Fly to the rescue branch. The app doesn't care — same schema.
fly secrets set DATABASE_URL="$RESCUE_URL" -a taskapp-workout

# Verify the app comes up healthy:
curl -fsS https://taskapp-workout.fly.dev/health/detailed | jq

# When you're satisfied, promote the branch to replace main in Neon's UI.
# (Neon dashboard → Branches → rescue-XXXX → "Promote to primary".)
# Then set Fly back to the primary endpoint:
fly secrets set DATABASE_URL="<primary connection string>" -a taskapp-workout
```

### Mode B — Selective row merge (preserve recent changes)

Use when the bad change hit one or two tables and other activity continued. Safer but more manual.

```bash
# Dump just the affected tables from the rescue branch.
pg_dump "$RESCUE_URL" --format=custom --data-only \
  --table=public.sessions --table=public.session_sets \
  > rescue.dump

# Import into the live primary with a careful ON CONFLICT policy.
# NOTE: pg_restore has no native "on conflict do nothing" — use
# --data-only + a staging schema + hand-merged INSERT ... ON CONFLICT.
# This is hand-work; plan 30-60 min.
```

When in doubt, do Mode A. It's mechanical and the "data loss" window is usually small.

## Scenario 2 — Neon itself loses the database beyond the 7-day PITR window

Recovery window: **hours**. Source of truth: the nightly encrypted `pg_dump` backups in GitHub Releases.

The nightly workflow (see "Off-site backups") uploads a `backup-YYYY-MM-DD.dump.gpg` to a GitHub Release every night. The most-recent one is at most 24 hours old.

```bash
# 1. Download the most recent backup and decrypt.
gh release download backup-2026-04-21 -R toddaerickson/TaskApp -p backup-2026-04-21.dump.gpg
gpg --decrypt --batch --passphrase "$BACKUP_PASSPHRASE" \
  backup-2026-04-21.dump.gpg > backup-2026-04-21.dump

# 2. Provision a fresh Neon database (or a new project).
# Dashboard → New project → copy the connection string.
export FRESH_NEON_URL='postgresql://...'

# 3. Restore the dump.
pg_restore --dbname="$FRESH_NEON_URL" --clean --if-exists backup-2026-04-21.dump

# 4. Update Fly to point at the new DB.
fly secrets set DATABASE_URL="$FRESH_NEON_URL" -a taskapp-workout

# 5. Verify.
curl -fsS https://taskapp-workout.fly.dev/health/detailed | jq
```

A convenience wrapper lives at `backend/scripts/restore_from_dump.sh` — pipes steps 1 + 3 into one command.

## Scenario 3 — Full rebuild on fresh Fly + fresh Vercel

Recovery window: **2-4 hours**. Use when losing both the Fly app and the Neon project simultaneously — e.g. account compromise, accidentally-deleted Fly org, or migrating clouds.

1. **Provision Neon project** (dashboard → New project). Copy `DATABASE_URL`.
2. **Provision Fly app**:
   ```bash
   fly launch --name taskapp-workout --region iad --no-deploy
   cd backend
   fly secrets set \
     DATABASE_URL="..." \
     JWT_SECRET="$(openssl rand -hex 48)" \
     CORS_ORIGINS="https://taskapp.vercel.app" \
     -a taskapp-workout
   fly deploy -a taskapp-workout
   ```
   The `release_command` in `fly.toml` runs `python seed_workouts.py` — re-populates the global exercise library from `backend/seed_data/exercise_snapshot.json`.
3. **Restore user data** from the most recent GPG backup (Scenario 2, steps 1 + 3).
4. **Provision Vercel project**: import from GitHub, set `EXPO_PUBLIC_API_URL` to the new Fly URL in project → Settings → Environment Variables → Production + Preview.
5. **Verify end-to-end**: register a new user, create a task, start a workout, log a set, refresh. Confirm `/health/detailed` shows `db_reachable: true` and `cors_origins_configured: true`.

## Verification after any restore

In order — stop at the first red flag.

1. `curl https://taskapp-workout.fly.dev/health` returns `200 {"status":"ok"}`.
2. `curl https://taskapp-workout.fly.dev/health/detailed` shows `db_reachable: true`, `jwt_secret_configured: true`, `cors_origins_configured: true`.
3. Existing user can log in (test against a known account; note that rotating `JWT_SECRET` during the restore forces re-login — that's not a failure).
4. A new session created via the mobile app persists across a full refresh.
5. `SELECT COUNT(*)` on `users`, `tasks`, `workout_sessions`, `session_sets` against the restored DB matches the previous-known-good counts (record these in a log after the last drill).

## Off-site backups

When the backup workflow lands, nightly encrypted dumps go to GitHub Releases. Operator responsibilities:

- **Quarterly recovery drill** — download the latest backup, decrypt, restore against a Neon *branch* (not primary), verify `SELECT COUNT(*)` matches an independently-captured count from primary. If the drill fails, the prod backup is unusable — fix before the next real outage.
- **Watch the workflow run history** — `.github/workflows/backup-neon.yml` fails if `NEON_READONLY_DATABASE_URL` rotates silently. Subscribe to workflow failure notifications.
- **Two copies of `BACKUP_PASSPHRASE`** — password manager + sealed envelope / physical backup. Losing it makes every backup a brick.

## Anti-patterns to avoid

- **Don't write user data to disk on Fly.** The fly.toml has no `[mounts]` block and no volume — that's by design. Any feature that needs to persist a file should go to Neon as a `bytea` column or to a dedicated object store (S3), not `/app/data`.
- **Don't reuse the app's `DATABASE_URL` role for the backup workflow.** The backup role should be read-only — blast radius of a leaked GitHub Actions secret then stays at "read a nightly dump" rather than "drop the DB."
- **Don't delete old GitHub Releases by hand.** The workflow has a retention step. If you need to clear space, update the retention count in the workflow, not the UI.
- **Don't trust "it worked last time."** Schedule the quarterly drill on a calendar.

## See also

- `docs/ROADMAP.md` — living log of PRs merged + open items.
- `backend/DEPLOY.md` — initial Fly + Vercel deployment (green-field, not recovery).
- `CLAUDE.md` — project conventions, schema-sync rules, known gaps.
