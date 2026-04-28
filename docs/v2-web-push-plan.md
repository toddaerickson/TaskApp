# Tier 3-V2: Full web push for routine reminders

**Status:** Deferred (PM-recommended). Lifted out of CLAUDE.md +
ROADMAP into a dedicated doc in PR #120 (post-audit-X5) so the V2
plan has somewhere to live without bloating the on-ramp doc.

## Why V1 (the in-app banner) shipped first

`PR #112` shipped the **missed-reminder inbox**: a banner at the top
of the Workouts tab listing routines whose `reminder_time` already
passed today (in operator TZ) and the user hasn't started yet, with
[Start] / [Dismiss for today] actions. Captures most of the morning-
routine UX with one PR and zero infra. The user sees the banner
*when they next open the app*; if they don't open the app, they
don't get the nudge.

V2 (this doc) covers the case where the user **doesn't think to open
the app** — push notifications on the lock screen / notification
center. Strictly more work; revisit only if dogfooding the V1 inbox
shows the open-app-when-you-remember path is insufficient.

## What V2 actually requires

### 1. VAPID keys + backend signing

- Generate VAPID keypair: `openssl ecparam -genkey -name prime256v1 -out vapid_private.pem`
- Store as Fly secrets: `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` (`mailto:you@you.com`)
- Backend dep: `pywebpush` (or roll own; pywebpush is ~150 lines wrapping `cryptography`)
- New tables:
  ```sql
  CREATE TABLE push_subscriptions (
      id            INTEGER PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id),
      endpoint      TEXT NOT NULL UNIQUE,
      p256dh        TEXT NOT NULL,
      auth          TEXT NOT NULL,
      user_agent    TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at  TIMESTAMPTZ
  );
  CREATE TABLE reminder_dispatches (
      id            INTEGER PRIMARY KEY,
      user_id       INTEGER NOT NULL,
      routine_id    INTEGER NOT NULL,
      reminder_local_date DATE NOT NULL,  -- the local-day key (DST-aware)
      sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, routine_id, reminder_local_date)
  );
  ```
- Numbered migration `005_web_push.sql` + SQLite mirror.
- New routes:
  - `POST /push/subscribe` — accepts `endpoint + p256dh + auth`; upserts.
  - `DELETE /push/subscribe/{id}` — opt-out.
  - `POST /push/test` — admin, fan out a synthetic notification.

### 2. Service worker push handler

- `mobile/sw-push.ts` registered as a separate SW or merged into the
  existing PWA `sw.js`. Note the existing SW already exists for cache
  versioning (`scripts/build-web.sh` stamps `taskapp-${COMMIT_SHA}`).
- Handler:
  ```js
  self.addEventListener('push', (event) => {
    const data = event.data?.json() ?? {};
    event.waitUntil(self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      data: { routineId: data.routineId },
      tag: `reminder-${data.routineId}-${data.localDate}`,  // dedupe
    }));
  });
  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = `/workout/${event.notification.data.routineId}`;
    event.waitUntil(self.clients.openWindow(url));
  });
  ```
- Build pipeline change: `scripts/build-web.sh` has to bundle the
  push handler at a known path Vercel will serve, and version-stamp it.

### 3. Cron + dispatch loop

- Either a `fly machines run --schedule` job (simplest) or
  `fly schedule create --command "python scripts/dispatch_reminders.py"`
  pinned at `*/5 * * * *`.
- Dispatch logic is the existing `compute_missed_reminders()` from
  PR #119 plus a `reminder_dispatches` insert-or-skip:
  ```python
  for user in active_users:
      pending = compute_missed_reminders(user.id)
      for r in pending:
          local_date = r.expected_at.astimezone(operator_tz).date()
          if not _already_dispatched(user.id, r.routine_id, local_date):
              for sub in active_subscriptions(user.id):
                  webpush(sub, json.dumps({
                      "title": "Missed routine",
                      "body": f"{r.name} — was due at {r.reminder_time}",
                      "routineId": r.routine_id,
                      "localDate": str(local_date),
                  }), vapid=vapid_claims)
              _record_dispatch(user.id, r.routine_id, local_date)
  ```
- The existing `_operator_tz()` cache + DST-safe local-datetime
  computation **stays the same** — the dispatch loop is just a
  scheduled wrapper around the same function the route uses.

### 4. iOS Safari PWA install gating

- Push only works in iOS Safari **after the user installs the PWA**
  (Add to Home Screen). Pre-install the API isn't even exposed.
- Detection in JS: `('Notification' in window) && navigator.standalone`
  on iOS, vs Android Chrome where it works pre-install.
- UX: Settings → Notifications row that, on iOS, gates the
  permission prompt behind a "Install this app first → here's how"
  bottom sheet with a 3-step instructions slide. Android skips
  straight to `Notification.requestPermission()`.
- Test matrix that has to pass before shipping:
  - iOS Safari 16.4+ PWA-installed
  - iOS Safari pre-install (graceful degrade — tell the user)
  - Android Chrome (works as documented)
  - Desktop Chrome / Firefox / Safari
  - Disabled-permissions case (revoke + restart loop)

### 5. DST-aware schema concerns

- `reminder_dispatches.reminder_local_date` is the local-day key,
  which already handles DST naturally — there are exactly N+1
  spring-forward days a year where 23h local maps to 24h UTC.
- The cron loop runs every 5 min, so the worst-case latency is the
  reminder fires up to 5 min late. Fine for "did you do your
  morning mobility routine."
- The harder edge case: if a user changes their TZ. `TASKAPP_TZ` is
  single-tenant via env var, so this is "only fires when you fly to
  Tokyo and then change the env var" — explicitly out of scope for
  V2. Multi-user TZ requires the deferred `users.timezone` column.

## Cost estimate

| Phase | Effort | Deferrable? |
|---|---|---|
| Backend: VAPID + tables + 3 routes + tests | 1 PR, 1-2 days | yes — start here |
| Frontend: SW push handler + Settings flow + iOS install gating | 1 PR, 2-3 days | no — gates testing |
| Cron / dispatch loop + idempotency + observability | 1 PR, 1 day | yes |
| iOS PWA test pass + bug-bash + Safari quirks | n/a, ~1 day | the "long tail" |

Total: ~5 days of focused work. Punted in PR #112 in favor of the
1-PR V1 inbox. **Revisit only after dogfooding the V1 inbox for
~2 weeks**; the deferred-tracker convention requires re-evaluating
the rationale every audit.

## Decision rule for un-deferring

Build V2 if **any** of these become true:

1. The V1 inbox banner is consistently empty *not because the user
   already worked out, but because they didn't open the app*. (Track
   via Sentry breadcrumb on `[banner] empty` + cross-reference with
   session-start telemetry.)
2. A second user joins the deployment. Multi-user TZ comes first
   (`users.timezone` column), but push naturally follows.
3. Future iOS PWA push improves dramatically (e.g. Safari ships
   silent-push or background-fetch parity). Removes the "install
   PWA first" gate that makes the iOS UX awkward.

Until then: V1 inbox is the right shape.
