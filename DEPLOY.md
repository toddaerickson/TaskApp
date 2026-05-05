# Deploying TaskApp

Everything below is one-time setup. Afterwards, `git push origin master`
builds and deploys automatically.

**Stack**:
- **Backend** on Fly.io (free tier, Dockerized FastAPI)
- **Database** on Neon (free tier, Postgres)
- **Frontend** on Vercel (free, Expo web export)

Total ongoing cost: **$0** until you outgrow the free tiers.

---

## 1. Database — Neon (5 min)

1. Sign up at <https://neon.tech> (GitHub login).
2. Create a project → pick a region close to Fly's region (default is US-East).
3. Copy the **connection string** — looks like `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`.
4. Keep this tab open; we'll paste it into Fly shortly.

---

## 2. Backend — Fly.io (15 min)

### Install flyctl
```bash
curl -L https://fly.io/install.sh | sh
```

Add `~/.fly/bin` to your PATH if the installer didn't. Then:
```bash
fly auth signup      # or `fly auth login` if you have an account
```

### Launch the app
```bash
cd /home/teric/TaskApp/backend
fly launch --no-deploy
```

When prompted:
- **App name**: `taskapp-teric-api` (or anything unique — this becomes `<name>.fly.dev`).
- **Region**: pick one near you; `iad` (Virginia) is a safe default.
- **Launch now?**: no (we need to set secrets first).

This creates/updates `fly.toml` and a machine config.

### Set secrets
```bash
# Required: Neon connection string from step 1.
fly secrets set DATABASE_URL='postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require'

# Required: 64+ random chars. Rotate to invalidate all existing tokens.
fly secrets set JWT_SECRET="$(openssl rand -hex 48)"

# Required for `/health/detailed` + `/admin/snapshot` bearer-token gate.
# Without this, /health/detailed returns 503 (fail closed).
fly secrets set SNAPSHOT_AUTH_TOKEN="$(openssl rand -hex 32)"

# Required for self-hosted exercise images. RN native rejects relative
# URIs, so the resolver in app/image_urls.py needs the public origin.
fly secrets set BACKEND_PUBLIC_URL='https://YOUR-APP-NAME.fly.dev'

# Required for the missed-reminder inbox. Single-tenant TZ source —
# server uses this to decide what's "missed today" for the operator.
# IANA name (e.g. America/New_York, Europe/London, Asia/Tokyo).
fly secrets set TASKAPP_TZ='America/New_York'

# Optional: Sentry error monitoring. See section 6 for full setup.
# fly secrets set SENTRY_DSN='https://xxx@oXXX.ingest.sentry.io/YYY'

# After your Vercel URL is known (step 3), come back and set:
# fly secrets set CORS_ORIGINS='https://taskapp-workout.vercel.app'
```

### Deploy
```bash
fly deploy
```

First deploy takes ~3 min (pulls the Python image, pip installs, builds).
Subsequent deploys are ~30s.

### Verify
```bash
curl https://<your-app-name>.fly.dev/health
# → {"status":"ok"}
```

Check the app is up at:
<https://YOUR-APP-NAME.fly.dev/docs> — Swagger UI.

### Seed
The deploy `release_command` runs **two scripts** before each new
machine takes traffic (see `backend/fly.toml`):

1. **`python scripts/migrate.py`** — applies any pending numbered SQL
   migrations from `backend/migrations/` and stamps `schema_migrations`.
   Idempotent. The app's `init_db` requires this table to be populated
   in PG mode; if migration fails, the next-version machine refuses
   to start and traffic continues to flow to the prior version.
2. **`python seed_workouts.py`** — re-seeds globals from
   `seed_data/exercise_snapshot.json` (or the hardcoded `EXERCISES`
   list if the snapshot is missing). Idempotent.

Non-zero exit at any step aborts the deploy.

After you've registered a user through the frontend (next step), come back
and seed their routines (one-time, per user):
```bash
fly ssh console -a taskapp-workout
cd /app
python seed_workouts.py your@real-email.com all
exit
```

To verify migrations are applied:
```bash
fly ssh console -a taskapp-workout -C "cd /app && python scripts/migrate.py --status"
# → Applied (N): ✓ 001_schema.sql ✓ 002_*.sql …
#   Pending (0):
```

### Refresh the exercise library (manual path)

**You usually won't need this** — see the automated path in the next
section. But if you want an out-of-band refresh, e.g. after a raw SQL
edit or when the Action is broken:
```bash
fly ssh console -a taskapp-workout -C \
  "cd /app && python scripts/snapshot_exercises.py --user your@real-email.com --out /tmp/snapshot.json"
fly sftp get /tmp/snapshot.json backend/seed_data/exercise_snapshot.json
git add backend/seed_data/exercise_snapshot.json
git commit -m "Refresh exercise snapshot"
git push
```

### Automatic exercise-snapshot backup (every image save)

Once configured, every time you POST an image via the admin UI (or the
bulk-images endpoint), the backend fires a GitHub `repository_dispatch`
event. The `snapshot` workflow wakes up, calls `GET /admin/snapshot` on
the live backend, and commits the JSON to `backend/seed_data/exercise_snapshot.json`
on master. Rapid saves are debounced via the workflow's concurrency
group (last save wins). If the committed content is identical to the
previous snapshot (only `captured_at` changed), the workflow skips the
commit to keep `git log` quiet.

**One-time setup:**

1. Create a **fine-grained GitHub PAT**. On https://github.com/settings/tokens?type=beta,
   click **Generate new token**:
   - Token name: `taskapp-library-dispatch`
   - Resource owner: your user
   - Repository access: *Only select repositories* → `toddaerickson/TaskApp`
   - Repository permissions: **Contents: read and write**, **Actions: write**
   - Save the token string.

2. Pick a **shared snapshot token** — any random secret. Use:
   ```bash
   openssl rand -hex 32
   ```

3. Tell the Fly backend about both secrets:
   ```bash
   fly secrets set -a taskapp-workout \
     GITHUB_DISPATCH_TOKEN='<the PAT from step 1>' \
     SNAPSHOT_AUTH_TOKEN='<the shared token from step 2>'
   ```

4. Tell GitHub Actions about the shared token + the backend URL + your email:
   - Go to https://github.com/toddaerickson/TaskApp/settings/secrets/actions
   - Add three repository secrets:
     - `SNAPSHOT_AUTH_TOKEN` = the same shared token from step 2
     - `SNAPSHOT_BACKEND_URL` = `https://taskapp-workout.fly.dev`
     - `SNAPSHOT_USER_EMAIL` = the email whose personal exercises should be included

5. Trigger the workflow once manually to verify the wiring:
   - https://github.com/toddaerickson/TaskApp/actions/workflows/snapshot.yml → **Run workflow**
   - Should produce a commit `snapshot: auto-sync @ <timestamp>` on master, or a "No change / Only captured_at changed" log line if the DB matches the committed snapshot already.

After that, every image save on prod triggers an auto-backup within ~30 seconds.

**To turn it off temporarily**, either:
- Remove the `GITHUB_DISPATCH_TOKEN` Fly secret (`fly secrets unset GITHUB_DISPATCH_TOKEN -a taskapp-workout`) — saves image but skips the dispatch. The backend no-ops cleanly when the token is missing.
- Or disable the workflow from the Actions tab.

---

## 3. Frontend — Vercel (10 min)

### Install the Vercel CLI (optional but nice)
```bash
npm i -g vercel
```

### Build the web bundle
```bash
cd /home/teric/TaskApp/mobile
EXPO_PUBLIC_API_URL="https://YOUR-APP-NAME.fly.dev" npx expo export --platform web
# Produces mobile/dist/ with static files.
```

### Deploy to Vercel

**Option A — Drag & drop (dead simple)**:
1. Sign up at <https://vercel.com> (GitHub login).
2. Drag the `mobile/dist/` folder onto the "Add new project" page.
3. Done. Vercel gives you a URL like `https://taskapp-xyz.vercel.app`.

**Option B — Vercel CLI**:
```bash
cd /home/teric/TaskApp/mobile
vercel                  # first time: answers a few setup questions
vercel --prod           # deploy to production
```

**Option C — GitHub auto-deploy** (recommended long-term):
1. Push the code (already done).
2. On Vercel, "Add New Project" → import the GitHub repo.
3. Framework preset: **Other**.
4. Root directory: `mobile`.
5. Leave **Build Command** and **Output Directory** blank — `mobile/vercel.json`
   already pins them to `npx expo export --platform web` and `dist`.
6. Environment variables (tick **Production + Preview** for each):
   - `EXPO_PUBLIC_API_URL=https://YOUR-APP-NAME.fly.dev` (required)
   - `EXPO_PUBLIC_SENTRY_DSN=https://xxx@oXXX.ingest.sentry.io/YYY` (optional, see section 6)

From then on, every `git push origin master` triggers a new Vercel deploy.

### Lock down CORS
Once you have the Vercel URL, tighten CORS on the backend:
```bash
cd /home/teric/TaskApp/backend
fly secrets set CORS_ORIGINS='https://taskapp-workout.vercel.app'
```

`CORS_ORIGINS` is a plain comma-separated list of exact origins — **no
glob/wildcard support**. If you want Vercel preview deploys (which get
URLs like `https://taskapp-teric-git-feature-foo.vercel.app`) to work
too, add each preview URL you care about, or for development just leave
`CORS_ORIGINS` unset to fall back to allow-all.

### Service-worker cache stamping (auto)

`mobile/vercel.json` invokes `bash scripts/build-web.sh` which runs
`npx expo export --platform web` and then sed-replaces the `taskapp-v1`
sentinel in `dist/sw.js` with `taskapp-${VERCEL_GIT_COMMIT_SHA}`.
Each deploy gets a fresh service-worker cache identity so iOS Safari
PWA users don't get stuck on a stale shell. Verify with:
```bash
curl -s https://taskapp-workout.vercel.app/sw.js | grep CACHE_VERSION
# → const CACHE_VERSION = 'taskapp-9a8f7c2b';
```
If it still says `taskapp-v1` the build script didn't run; check the
Vercel build log for "Service worker cache version: …".

---

## 4. Use it from your phone

1. Open `https://taskapp-workout.vercel.app` in Safari on iOS.
2. Share → **Add to Home Screen**. The icon now looks like an app.
3. Tap it anywhere, anytime — PIN gate, login, your routines.

Caveats:
- Face ID doesn't work through Safari (the Web Authentication API doesn't expose it for site-specific auth). You'll use the PIN. The PinGate "locked" state shows a Reset PIN button after 5 wrong attempts (clearPin → re-setup) so you're not bricked.
- Live push notifications for routine reminders are deliberately deferred. Instead, the **missed-reminder banner** at the top of the Workouts tab surfaces any routine whose `reminder_time` already passed today (in `TASKAPP_TZ`) and you haven't started yet — open the app and you'll see what you missed, with [Start] / [Dismiss for today]. The TestFlight build below adds true push if you ever need it.

---

## 5. Optional: TestFlight for native iOS

When the web version feels good enough to upgrade:

```bash
# One-time:
npm i -g eas-cli
eas login
eas build:configure

# Requires an Apple Developer account ($99/year) linked to eas.
cd /home/teric/TaskApp/mobile
EXPO_PUBLIC_API_URL="https://YOUR-APP-NAME.fly.dev" eas build --platform ios --profile preview

# Follow the prompts; EAS uploads the .ipa to App Store Connect.
# Open App Store Connect → TestFlight → invite yourself by email.
# Install TestFlight on iPhone → accept invite → install the app.
```

Face ID, push notifications, and offline cache all work in this build.

---

## 6. Optional: error monitoring with Sentry (15 min, free hobby tier)

Both `app/sentry_setup.py` and `mobile/lib/sentry.ts` are no-ops until
you set the DSN env vars. Once set, backend 5xx + mobile axios 5xx +
ErrorBoundary catches + ambient `reportError` calls (e.g. the
missed-reminders banner that fails silently in the UI) all flow to
Sentry.

1. Sign up at <https://sentry.io> (GitHub login). Free **Developer plan**: 5,000 errors/month, 1 user, 14-day retention. (Verified Apr 2026; Sentry stops accepting new events when you hit the cap, no overage charges.)
2. Create **two projects** in Sentry's dashboard. Platform pickers are searchable:
   - `taskapp-backend` — pick **Python** (FastAPI specifically, if offered). Matches what `app/sentry_setup.py` already uses.
   - `taskapp-mobile` — pick **React Native**. The codebase uses `@sentry/react-native` (the canonical package; `sentry-expo` was deprecated with Expo SDK 50, and we're on SDK 52).

   Copy each project's DSN from its Settings → Client Keys (DSN) page. Looks like `https://xxx@oXXX.ingest.sentry.io/YYY`.
3. Backend secret on Fly:
   ```bash
   fly secrets set SENTRY_DSN='https://xxx@oXXX.ingest.sentry.io/YYY' -a taskapp-workout
   ```
4. Mobile env on Vercel: project → Settings → Environment Variables → add `EXPO_PUBLIC_SENTRY_DSN` (the React-Native DSN from step 2) for **Production + Preview + Development**. The `EXPO_PUBLIC_` prefix is what makes the value reach the browser bundle at build time. Save, then trigger a redeploy — Vercel doesn't auto-rebuild on env-var changes alone.
5. **Verify the wire-up.** Three options, in order of cleanness:

   **Option A — non-destructive backend probe (recommended):**
   The backend exposes no dedicated `/sentry-test` route by design (anything
   reachable + idempotent is also reachable by an attacker who finds the URL).
   Instead, use the `app/sentry_setup.py` API directly via `fly ssh`:
   ```bash
   fly ssh console -a taskapp-workout -C "cd /app && python -c \"
   import sentry_sdk
   from app.sentry_setup import init_sentry
   init_sentry()
   sentry_sdk.capture_message('preflight: deploy verification', level='info')
   sentry_sdk.flush(timeout=5)
   print('flushed')
   \""
   ```
   Should print `flushed`. Within ~30s a `preflight: deploy verification`
   info-level event appears under the `taskapp-backend` Sentry project.
   No code change, no deploy, no production user impact.

   **Option B — mobile probe (browser console):**
   Open the deployed Vercel URL in an incognito window with the **dev
   console open**, log in, then run:
   ```js
   import('@sentry/react-native').then(s => s.captureMessage('mobile preflight'))
   ```
   The dynamic import works because the bundler already pulled the SDK in.
   Within ~30s a `mobile preflight` event appears under the `taskapp-mobile`
   Sentry project. Reload the page once you've confirmed.

   **Option C — wait for the real thing:**
   Skip both — `app/sentry_setup.py` forwards the next genuine 5xx
   automatically; the missed-reminders banner's `reportError(e, ...)`
   path will fire on any backend hiccup. If your event volume is
   non-zero, you'll see something within a few hours of normal use.

After Option A or B fires successfully, `/health/detailed` will
report `sentry_configured: true` AND you'll have a real timestamped
event in the dashboard proving end-to-end delivery (DNS, TLS,
auth-token, project-routing). The flag-only check on
`/health/detailed` only proves the env var is set; it doesn't prove
events actually land.

**GitHub email notifications for failed CI runs** (corrected Apr 2026):

The notification hierarchy is: **Watch status → Account-level Actions setting → repo subscription**. Watching a repo overrides everything else, so the cleanest setup is:

1. Account-level: <https://github.com/settings/notifications> → **System** → **Actions** → set to **"Only notify for failed workflows"** → Save.
2. **Don't "Watch" the repo** — watching overrides the per-system Actions setting and you get notified for *every* run, not just failures. If you've already watched, change to "Custom" and uncheck Actions, OR unwatch entirely.
3. The default email is the address on your GitHub account; tune destinations under **Notification preferences → Email** on the same page.

**Fly deploy failure notifications** (corrected Apr 2026):

Two-layer setup; both must be on:

1. **Org-level**: <https://fly.io/dashboard> → your organization → **Members** → confirm your membership row has **"Receive notifications"** enabled.
2. **Per-app**: <https://fly.io/dashboard/{org}/apps/taskapp-workout/settings> → toggle **"Receive deploy failure notifications"** on. Failure emails include the failure reason + a link to the release inline (added 2024-25).

That triplet — **Sentry for app errors, GitHub email for failed CI runs, Fly email for failed deploys** — is the realistic-for-solo monitoring stack. Anything more (PagerDuty, Datadog, BetterStack uptime) is overkill for a single user.

---

## Troubleshooting

**Fly deploy fails during build**
- Check `fly logs`. The most common cause is a missing Python dep — add
  it to `backend/requirements.txt` and redeploy.

**Fly machine refuses to start: "schema_migrations table missing"**
- The `release_command` migrator failed (or never ran). Run it manually:
  `fly ssh console -a taskapp-workout -C "cd /app && python scripts/migrate.py --status"`
  to see what's pending, then `python scripts/migrate.py` to apply.

**Frontend can't reach backend (CORS error in browser devtools)**
- Make sure `CORS_ORIGINS` on Fly matches your Vercel URL exactly,
  including `https://` and no trailing slash.

**Frontend hits the wrong URL**
- Check the build-time env: `EXPO_PUBLIC_API_URL` must be set *when*
  `expo export` runs. Vercel auto-deploys: set it in the project's
  Environment Variables → Production.

**`fly launch` asks about Postgres**
- Decline. We're using external Neon, not Fly Postgres (Neon's free tier is
  more generous).

**First login says 500 / Internal Server Error**
- Almost always a missing `DATABASE_URL` secret. Verify with:
  `fly secrets list` — should show DATABASE_URL and JWT_SECRET.

**Backend refuses to boot: "JWT_SECRET is unset in a non-SQLite environment"**
- Intentional guard in `backend/app/config.py`. Set a real secret:
  `fly secrets set JWT_SECRET="$(openssl rand -hex 48)"`.

**`/health/detailed` returns 503**
- `SNAPSHOT_AUTH_TOKEN` is unset (fail-closed by design). Set it:
  `fly secrets set SNAPSHOT_AUTH_TOKEN="$(openssl rand -hex 32)"`. Curl
  with `-H "Authorization: Bearer <token>"` to read the diagnostic.

**Self-hosted exercise images render as "Image unavailable"**
- `BACKEND_PUBLIC_URL` is unset. Without it the resolver emits relative
  paths that RN native rejects. Set:
  `fly secrets set BACKEND_PUBLIC_URL='https://taskapp-workout.fly.dev'`.

**Missed-reminder banner doesn't show even though a routine's time has passed**
- `TASKAPP_TZ` is unset (defaults to UTC). Set the operator's IANA TZ:
  `fly secrets set TASKAPP_TZ='America/New_York'`. The banner compares
  `now()` in this zone against `reminder_time` HH:MM stored on the routine.

**iOS Safari PWA still serves the old JS bundle after a deploy**
- The service-worker `CACHE_VERSION` should change per deploy. Verify
  `curl -s <vercel-url>/sw.js | grep CACHE_VERSION` doesn't say
  `taskapp-v1` — if it does, `mobile/scripts/build-web.sh` didn't run
  (Vercel build log will show the cause). Manual workaround for the
  user: visit `<vercel-url>/?sw=off` once to bypass the SW.

---

## npm `overrides` for transitive CVEs (PR-Node-1)

`mobile/package.json` carries an `overrides` block that pins two
transitive deps to non-vulnerable versions:

```json
"overrides": {
  "@xmldom/xmldom": "0.8.13",
  "tar": "7.5.13"
}
```

These collapse all 17 high-severity CVEs that `npm audit
--audit-level=high` flagged on Expo SDK 52's transitive tree:

- **@xmldom/xmldom** — Expo CLI's older `@expo/plist` resolved
  0.7.13 (CVE: uncontrolled recursion → DoS during XML serialization).
  0.8.13 is the cutoff version — used by the newer `plist` already
  hoisted elsewhere in the tree, so the override only forces the one
  laggard up.
- **tar** — `cacache` (npm cache, dev-only) pulled tar 6.2.1, which
  has multiple high-severity hardlink path-traversal advisories
  (GHSA-34x7-hfp2-rc4v, GHSA-83g3-92jg-28cx, etc.). 7.x is the only
  major with security backports.

**Don't remove these without re-running** `npm audit --audit-level=high`
locally — they're load-bearing for the dependency-audit CI gate.
Revisit when bumping Expo to a major that already pins safe versions
upstream (likely SDK 56+).

## Future maintenance: Expo SDK upgrade (deferred)

We're on SDK 52 + RN 0.76. The mobile package versions are correctly
aligned to SDK 52 today (`expo-crypto ~14.0.2`, `expo-local-authentication
~15.0.2`, `expo-notifications ~0.29.14`). Earlier drift to SDK-55
versions of these has been resolved.

A real SDK upgrade (52 → 56) is its own multi-day project, not a
maintenance PR — expo-router has API changes, RN 0.76 → 0.77+ has
deprecations, and the `lib/biometric.ts` / `lib/routineReminders.ts`
/ `lib/pin.ts` / `lib/stores.ts` lazy-requires for native-only
modules need re-verification under the new SDK. Run the multi-agent
plan-review convention from CLAUDE.md before starting.
