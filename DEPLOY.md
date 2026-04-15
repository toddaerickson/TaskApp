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
After you've registered a user through the frontend (next step), come back
and seed their routines:
```bash
fly ssh console
cd /app
python seed_workouts.py your@real-email.com all
exit
```

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
5. Build command: `npx expo export --platform web`.
6. Output directory: `dist`.
7. Environment variables: `EXPO_PUBLIC_API_URL=https://YOUR-APP-NAME.fly.dev`.

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
