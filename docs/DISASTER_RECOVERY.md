# Disaster recovery — TaskApp

Single source of truth for how to restore production after a data-loss event. Living document; update whenever secrets, services, or the restore procedure change.

## Architecture

```
          Client (iPhone Safari, laptop browser)
               │
               ▼
        https://taskapp-workout.vercel.app
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

**Backup secrets** (the nightly backup workflow at `.github/workflows/backup-neon.yml` is live as of PR #136-#141):

| Secret | Where stored | What it does |
|---|---|---|
| `NEON_READONLY_DATABASE_URL` | GitHub repo secrets | Read-only Neon role the workflow uses; isolated from the app role |
| `BACKUP_PASSPHRASE` | GitHub repo secrets + operator's password manager | GPG symmetric key for the nightly dumps. **Losing this makes every backup unusable. Store it in two places.** |

**Optional R2 mirror secrets** (PR #141 — when set, each nightly backup also uploads to a Cloudflare R2 bucket as a second-target hedge against GitHub-side failures):

| Secret | Where stored | What it does |
|---|---|---|
| `R2_ENDPOINT` | GitHub repo secrets | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | GitHub repo secrets | Bucket name (suggested: `taskapp-backups`) |
| `R2_ACCESS_KEY_ID` | GitHub repo secrets | R2 token id with object:write on the bucket only |
| `R2_SECRET_ACCESS_KEY` | GitHub repo secrets | Paired secret |

If `R2_ENDPOINT` is unset, the mirror step is a silent no-op — the GitHub Releases path still runs. Cloudflare R2 lifecycle rules (set in the dashboard, not the workflow) should match the 30-day retention enforced by the workflow's GH-Releases prune step. **Drift risk:** if you change the workflow's `RETENTION_DAYS`, also update the bucket lifecycle rule.

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

Recovery window: **hours**. Source of truth: the nightly encrypted `pg_dump` backups in GitHub Releases (and, if R2 mirroring is enabled, Cloudflare R2 as a second copy).

The nightly workflow uploads two artifacts to each Release:

- `backup-YYYY-MM-DD.dump.gpg` — encrypted custom-format dump.
- `schema_state.txt` — **plaintext** list of `schema_migrations` rows applied at dump time. Read this **first** to confirm the backup is the right vintage and to know which migrations to apply forward against current code.

The most-recent Release is at most 24 hours old.

```bash
# 1. (PRIMARY PATH) Download from the GitHub Release.
gh release download backup-2026-04-21 -R toddaerickson/TaskApp \
   -p backup.dump.gpg -p schema_state.txt

# 1-alt. (FALLBACK if GH itself is the failure mode, only if R2 mirror
# is enabled — see "Backup secrets" table.) Pull from R2:
aws s3 cp s3://taskapp-backups/backup-2026-04-21.dump.gpg . \
  --endpoint-url "$R2_ENDPOINT"

# 2. Inspect schema_state.txt — confirm the migration list matches what
#    you expect, and note which migrations in current backend/migrations/
#    are NOT in this list (those will need to apply forward).
cat schema_state.txt

# 3. Decrypt.
gpg --decrypt --batch --passphrase "$BACKUP_PASSPHRASE" \
    --output backup.dump backup.dump.gpg

# 4. Provision a fresh Neon database (or a new project).
# Dashboard → New project → copy the connection string.
export FRESH_NEON_URL='postgresql://...'

# 5. Restore the dump. Use pg_restore matching the dump's PG major
#    (currently 17 — see backup-neon.yml's `postgresql-client-N` pin).
pg_restore --dbname="$FRESH_NEON_URL" --clean --if-exists --no-owner --no-privileges backup.dump

# 6. Apply forward migrations newer than schema_state.txt.
DATABASE_URL="$FRESH_NEON_URL" python backend/scripts/migrate.py

# 7. Update Fly to point at the new DB.
fly secrets set DATABASE_URL="$FRESH_NEON_URL" -a taskapp-workout

# 8. Verify.
curl -fsS https://taskapp-workout.fly.dev/health/detailed | jq
```

A convenience wrapper lives at `backend/scripts/restore_from_dump.sh` — pipes steps 1 + 3 + 5 into one command. **Note:** the script currently only knows the GitHub Releases path; if the GH-outage fallback is needed, run step 1-alt manually then call the script with the local `.dump.gpg` already in place. (Adding a `--from-r2` flag is tracked but deferred until R2 has actually been needed for a recovery.)

The script also warns if `pg_restore`'s major is older than the dump's producer (PR #139). Heed it — silent partial restores during disaster recovery are catastrophic.

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
     CORS_ORIGINS="https://taskapp-workout.vercel.app" \
     -a taskapp-workout
   fly deploy -a taskapp-workout
   ```
   The `release_command` in `fly.toml` runs `python seed_workouts.py` — re-populates the global exercise library from `backend/seed_data/exercise_snapshot.json`.
3. **Restore user data** from the most recent GPG backup (Scenario 2, steps 1 + 3).
4. **Provision Vercel project**: import from GitHub, set `EXPO_PUBLIC_API_URL` to the new Fly URL in project → Settings → Environment Variables → Production + Preview.
5. **Verify end-to-end**: register a new user, create a task, start a workout, log a set, refresh. Confirm `/health/detailed` shows `db_reachable: true` and `cors_origins_configured: true`.

## Scenario 4 — Forgotten account password (lockout escape hatch)

Recovery window: **5 minutes**. Use when the owner can no longer log in because the account password was forgotten. There is **no in-app password reset** today (no SMTP provider, no recovery email flow); this V1 workaround uses `fly ssh` to reset the bcrypt hash directly. A real recovery flow (magic link or recovery code) is tracked as `docs/followups-2026-05.md` item #3.

**Pre-requisites:** operator has `flyctl` installed locally and `fly auth whoami` returns the account that owns `taskapp-workout`.

1. **SSH into the running Fly machine.**
   ```bash
   fly ssh console -a taskapp-workout
   ```

2. **Rewrite the password hash for your account.** Inside the SSH session:
   ```bash
   cd /app
   python - <<'PY'
   from app.auth import hash_password
   from app.database import get_db

   EMAIL = "you@example.com"        # ← edit
   NEW_PASSWORD = "<temporary>"     # ← edit, then rotate via Settings → Account after login

   with get_db() as conn:
       cur = conn.cursor()
       cur.execute(
           "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE email = ?",
           (hash_password(NEW_PASSWORD), EMAIL),
       )
       if cur.rowcount != 1:
           raise SystemExit(f"Expected 1 row updated, got {cur.rowcount} — check the email exists")
   print(f"Password reset for {EMAIL}.")
   PY
   ```

   The `token_version` bump invalidates any pre-existing JWT (PR #209), so a leaked token from before the reset can't outlive the lockout event.

3. **Log in with the temporary password**, then **immediately rotate it** via Settings → Account → Change password. The shell-set password lives in your terminal scrollback; treat it as compromised.

4. **Exit the SSH session.** Fly machines are ephemeral — no cleanup needed.

**Don't do this while the owner is actively logged in on another device** unless you intend to log them out — the `token_version` bump signs out every existing session immediately.

**If `flyctl` access itself is lost** (compromised Fly account, MFA-locked, etc.), this scenario degrades to "provision a new Fly app + restore from backup" — see Scenario 3.

## Verification after any restore

In order — stop at the first red flag.

1. `curl https://taskapp-workout.fly.dev/health` returns `200 {"status":"ok"}`.
2. `curl https://taskapp-workout.fly.dev/health/detailed` shows `db_reachable: true`, `jwt_secret_configured: true`, `cors_origins_configured: true`.
3. Existing user can log in (test against a known account; note that rotating `JWT_SECRET` during the restore forces re-login — that's not a failure).
4. A new session created via the mobile app persists across a full refresh.
5. `SELECT COUNT(*)` on `users`, `tasks`, `workout_sessions`, `session_sets` against the restored DB matches the previous-known-good counts (record these in a log after the last drill).

## Off-site backups

The backup pipeline is **two workflows + one alert thread**:

| Workflow | Cadence | What it does |
|---|---|---|
| `.github/workflows/backup-neon.yml` | Daily 07:00 UTC | Dumps Neon → GPG-encrypts → publishes to GH Release (and to R2 if configured). Captures `schema_state.txt` sidecar. |
| `.github/workflows/backup-restore-drill.yml` | Weekly Mondays 09:00 UTC | Downloads the latest `backup-*` Release, decrypts, restores into a fresh PG 17 container, asserts `users` / `tasks` / `workout_sessions` / `session_sets` are non-empty. Catches "the dump exists but doesn't restore" / "the dump restored but a critical table is empty due to silent grant loss." |

**Both workflows on failure:** open or comment on a single GitHub issue titled `[backup] Nightly Neon backup is failing`. Subscribe to repo issue notifications — this is the operator's heads-up that something in the backup pipeline needs attention.

### Operator responsibilities

- **Watch for the `[backup]` alert issue.** It re-uses the same title across publish + drill failures; one open issue means *something* in the pipeline is broken. Close the issue once a green run lands; subsequent failures will reopen the conversation in a fresh issue.
- **Two copies of `BACKUP_PASSPHRASE`.** Password manager + sealed envelope / physical backup. Losing it makes every backup a brick.
- **Bump the PG client pin when Neon majors-upgrade.** The "Pre-flight client/server version compat" step in `backup-neon.yml` will fail loudly when this is needed and tell you which version to bump to. Update the pin in **both** workflow files (the drill mirrors the same pin) and ship as one PR.
- **R2 lifecycle drift.** If you change the workflow's `RETENTION_DAYS=30` or the R2 bucket's lifecycle rule, update the other to match. They're not auto-synced.

### Rotating `BACKUP_PASSPHRASE`

`BACKUP_PASSPHRASE` is a single static GPG passphrase shared across the entire 30-day retention window. If it leaks (e.g. logs leak, password-manager compromise, accidental commit to a public repo), **every retained backup is compromised** — they're all encrypted with the same key. Rotation is a multi-step operator procedure; don't improvise it during the moment of a leak.

**Recovery window:** ~30 minutes operator time + one nightly cycle for the new key to start producing fresh backups.

1. **Generate the new passphrase** (≥ 32 random chars):
   ```bash
   openssl rand -base64 48
   ```
   Save to your password manager + the offline copy **before** any other step. Losing the new key mid-rotation strands you.

2. **Decrypt every retained backup with the OLD key, re-encrypt with the NEW key.** Run from a trusted local machine — `BACKUP_PASSPHRASE_OLD` should never live in CI:
   ```bash
   mkdir -p /tmp/backup-rotate && cd /tmp/backup-rotate
   gh release list --repo toddaerickson/TaskApp --limit 60 \
     | awk '/^backup-/{print $1}' > tags.txt
   while read -r TAG; do
     gh release download "$TAG" --repo toddaerickson/TaskApp -p '*.gpg' -D "$TAG"
     gpg --decrypt --batch --yes --passphrase "$BACKUP_PASSPHRASE_OLD" \
         "$TAG/backup.dump.gpg" > "$TAG/backup.dump"
     gpg --symmetric --batch --yes --cipher-algo AES256 \
         --passphrase "$BACKUP_PASSPHRASE_NEW" \
         --output "$TAG/backup.dump.gpg.new" "$TAG/backup.dump"
     gh release upload "$TAG" "$TAG/backup.dump.gpg.new" \
        --repo toddaerickson/TaskApp --clobber
     rm -f "$TAG/backup.dump"
   done < tags.txt
   ```
   This downloads each Release asset, decrypts with the OLD key, re-encrypts with the NEW key, and uploads in-place with `--clobber`. `schema_state.txt` is plaintext and doesn't need re-encryption.

3. **Repeat for R2** (if the mirror is configured). Same loop, swap `gh release` for `aws s3 cp` against the R2 bucket — the asset names match.

4. **Update the GitHub secret.** Repo Settings → Secrets and variables → Actions → `BACKUP_PASSPHRASE` → Update value to the new passphrase. The next nightly `backup-neon.yml` run will encrypt with the new key.

5. **Verify on the next scheduled drill.** `backup-restore-drill.yml` runs Mondays 09:00 UTC. Confirm it lands green — that proves the new key decrypts and restores cleanly end-to-end. If the rotation happened Mon–Sun, you can also manually trigger the drill via `workflow_dispatch` to avoid waiting up to a week.

6. **Wipe the old passphrase** from your password manager and the offline copy **only after** the next backup has been verified restorable with the new key. Until that's done, the old key is your safety net.

**Anti-patterns:**
- Don't rotate by deleting old backups and waiting 30 days for the retention window to roll over — that leaves you backup-less if anything happens to the current Neon DB in the interim.
- Don't store `BACKUP_PASSPHRASE_OLD` in CI for the re-encryption step. The whole point is to assume the old key is compromised; putting it back into CI undoes the rotation.
- Don't rotate `BACKUP_PASSPHRASE` and `JWT_SECRET` in the same operator session — both touch user-visible state (logged-out users on JWT, key-mismatch alerts on backup) and you want to be able to attribute any post-rotation breakage cleanly.

### What replaced the manual quarterly drill

The original plan called for an operator-run quarterly drill. It was demonstrably skipped in practice — the publish workflow ran red 9 nights in a row (2026-04-22 → 2026-05-01) before anyone noticed, and there was no "is this dump even restorable" check beyond byte-count > 1KB. The weekly automated drill (PR #138) replaces the manual one. Keep an eye on it — if the drill itself stops running, all the publish-side safety nets become "the file exists" theatre again.

## Anti-patterns to avoid

- **Don't write user data to disk on Fly.** The fly.toml has no `[mounts]` block and no volume — that's by design. Any feature that needs to persist a file should go to Neon as a `bytea` column or to a dedicated object store (S3 / R2), not `/app/data`.
- **Don't reuse the app's `DATABASE_URL` role for the backup workflow.** The backup role should be read-only — blast radius of a leaked GitHub Actions secret then stays at "read a nightly dump" rather than "drop the DB."
- **Don't delete old GitHub Releases by hand.** The workflow has a retention step. If you need to clear space, update the retention count in the workflow, not the UI.
- **Don't ignore the `[backup]` alert issue thread.** It is the operator's only push-style notification that the pipeline is failing. The 9-night silent failure happened *because* the only signal was the red badge on the Actions tab.
- **Don't bump only one PG client pin.** The pin lives in both `.github/workflows/backup-neon.yml` and `.github/workflows/backup-restore-drill.yml`. They must move together; a workflow lint to enforce this is a deferred follow-up.

## See also

- `docs/ROADMAP.md` — living log of PRs merged + open items.
- `backend/DEPLOY.md` — initial Fly + Vercel deployment (green-field, not recovery).
- `CLAUDE.md` — project conventions, schema-sync rules, known gaps.
