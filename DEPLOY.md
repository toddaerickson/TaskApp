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
# Your Neon connection string from step 1:
fly secrets set DATABASE_URL='postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require'

# A random 64+ char string. Rotate to invalidate all existing tokens.
fly secrets set JWT_SECRET="$(openssl rand -hex 48)"

# After your Vercel URL is known (step 3), come back and set:
# fly secrets set CORS_ORIGINS='https://taskapp-teric.vercel.app'
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
Global exercises are seeded **automatically on every deploy** via Fly's
`release_command` (see `backend/fly.toml`). The script reads
`backend/seed_data/exercise_snapshot.json` if present, and falls back to
the hardcoded defaults in `seed_workouts.py` when the snapshot file is
missing.

After you've registered a user through the frontend (next step), come back
and seed their routines (one-time, per user):
```bash
fly ssh console -a taskapp-workout
cd /app
python seed_workouts.py your@real-email.com all
exit
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
6. Environment variables: `EXPO_PUBLIC_API_URL=https://YOUR-APP-NAME.fly.dev`
   — tick both **Production** and **Preview**.

From then on, every `git push origin master` triggers a new Vercel deploy.

### Lock down CORS
Once you have the Vercel URL, tighten CORS on the backend:
```bash
cd /home/teric/TaskApp/backend
fly secrets set CORS_ORIGINS='https://taskapp-teric.vercel.app'
```

`CORS_ORIGINS` is a plain comma-separated list of exact origins — **no
glob/wildcard support**. If you want Vercel preview deploys (which get
URLs like `https://taskapp-teric-git-feature-foo.vercel.app`) to work
too, add each preview URL you care about, or for development just leave
`CORS_ORIGINS` unset to fall back to allow-all.

---

## 4. Use it from your phone

1. Open `https://taskapp-teric.vercel.app` in Safari on iOS.
2. Share → **Add to Home Screen**. The icon now looks like an app.
3. Tap it anywhere, anytime — PIN gate, login, your routines.

Caveats:
- Face ID doesn't work through Safari (the Web Authentication API doesn't expose it for site-specific auth). You'll use the PIN.
- Push notifications for routine reminders don't fire on iOS Safari (Apple restricts web push). Reminders are scheduled only when you use a real iOS app — see TestFlight path below.

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

## Troubleshooting

**Fly deploy fails during build**
- Check `fly logs`. The most common cause is a missing Python dep — add
  it to `backend/requirements.txt` and redeploy.

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

---

## Future maintenance: align Expo SDK versions

`mobile/package.json` currently has a few packages pinned to SDK-55
versions on an SDK-52 project (expo-crypto, expo-local-authentication,
expo-notifications). The web bundle works because `lib/` lazy-requires
these behind `Platform.OS !== 'web'` guards — but the mismatch is a
latent trap.

When you have a dedicated session to do it (not during a deploy fire):

```bash
cd mobile
npx expo install --check    # see what's skewed
npx expo install --fix      # align everything to SDK 52
npm test                    # confirm jest still passes
npx tsc --noEmit            # confirm types still OK
npx expo export --platform web   # confirm the web bundle still builds
```

After the alignment lands, you can optionally revert the lazy-require
workarounds in `lib/biometric.ts`, `lib/routineReminders.ts`, `lib/pin.ts`,
`lib/stores.ts` back to top-level imports — or keep them as
defense-in-depth. The bundle size difference is negligible.
