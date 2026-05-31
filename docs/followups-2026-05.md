# Follow-ups — May 2026

Punch list captured at the end of the May 2026 login-simplification + drag-fix
session (PRs #168–#176). Items are everything *surfaced* during that work
that did not ship — including audit findings explicitly deferred, agent
recommendations not picked up, and known gaps from CLAUDE.md.

Prioritised: **problems before features.**

## What shipped (for context)

| PR | Title |
|---|---|
| #168 | docs: refresh CLAUDE.md after skills removal |
| #169 | feat(auth): bio-first PinGate — auto-prompt Face ID, never flash the keypad |
| #170 | feat(auth): extend JWT lifetime 72h → 30d |
| #171 | feat(auth): stretch PinGate timeout 15min → 4h |
| #172 | fix(auth): audit cleanups — Sentry leak, contrast, error announcements |
| #173 | fix(tasks): drag handle for move-to-folder |
| #174 | refactor(pingate): extract state machine to a pure reducer + 32 unit tests |
| #176 | feat(auth): gate Reset PIN behind backend password verification |

All Audit SEVERE items from the original 4-agent review (UI, a11y+security,
architect, PM) are closed *except* JWT revocation hooks and web-storage
`pin.hash` exposure — both listed below.

> **Update 2026-05-25:** PinGate was ripped out entirely in commit
> `aefcea8` (`feat(auth): rip out PinGate; rely on email login alone`).
> Items **#5** (web `pin.hash`) and **#6** (Android TalkBack focusable
> spacer in `PinGate.tsx`) are now obsolete — the device's own lock
> screen covers the threat model and the file no longer exists. Items
> are kept below for traceability but should not be worked.

---

## URGENT — security / attack surface

### 1. `/auth/register` has no rate limit
**Source:** Audit IMPORTANT (4-agent review, May 2026).
**Status:** Not addressed.
**Risk:** `/auth/login` is `10/min`; register is wide open — credential-stuffing
pivot + account-flood DOS. Same concern applies to `/auth/change-password`,
which accepts a password in the body with no throttle even though it's
authenticated.
**Fix:** Add `@limiter.limit("10/minute")` to both routes in
`backend/app/routes/auth_routes.py`. Single-line change per route.
**Estimated:** XS.

### 2. `X-Forwarded-For` trust posture behind Fly's proxy
**Source:** Audit IMPORTANT (4-agent review, May 2026).
**Status:** Not verified.
**Risk:** slowapi's default keys on the raw remote address. Behind Fly's
proxy that's the proxy IP, so every login attempt globally shares one
`10/min` bucket — a single attacker can also lock out the legit user.
**Fix:** Verify `app/rate_limit.py` config + Fly proxy headers. If
unconfigured, set `X-Forwarded-For` trust and key the limiter on the
first hop.
**Estimated:** S.

### 3. Forgotten-credentials lockout has no escape hatch
**Source:** Acknowledged limitation in PR #176 description.
**Status:** V1 doc-only workaround shipped (`docs/DISASTER_RECOVERY.md`
§ "Scenario 4 — Forgotten account password (lockout escape hatch)").
Real recovery flow (magic link or recovery code) still open.
**Risk:** If the owner forgets the account password, the V1 path is
`fly ssh console` → run a small Python snippet that resets the bcrypt
hash and bumps `token_version`. ~5-minute recovery. The fallback if
flyctl itself is also lost: provision a new Fly app + restore from
backup (Scenario 3). No password-reset flow, no recovery email, no
in-app escape — mostly theoretical for a single-user deploy.
**Fix options (V2):**
- Magic-link / email-based password reset (requires an SMTP provider —
  adds a dependency).
- Recovery code printed during account setup, stored offline
  (lower-friction, fits the self-hosted model).
**Estimated:** M for either V2 path.

### 4. JWT has no revocation / `token_version` claim
**Source:** Audit SEVERE (4-agent review, May 2026).
**Status:** Partially addressed — PR-2 extended lifetime to 30d but did
not add a revocation mechanism.
**Risk:** A leaked 30-day token can't be invalidated without rotating
`JWT_SECRET` (which logs out the legit user too). The 30-day window
amplifies the cost of a leak.
**Fix:** Add `users.token_version INT NOT NULL DEFAULT 0`. Bump on
`/auth/change-password` success and on a new `/auth/sign-out-everywhere`
endpoint. Encode the version into the JWT and validate in
`get_current_user_id`. Mismatch → 401.
**Estimated:** M (schema migration + auth flow + tests).

### 5. ~~Web `pin.hash` stored in plain `localStorage`~~ — OBSOLETE
**Source:** Audit SEVERE (4-agent review, May 2026).
**Status:** Obsolete as of commit `aefcea8` (2026-05-25) — PinGate
removed; no PIN hash is persisted anywhere anymore. Skip.
**Risk:** 4-digit PIN space = 10k SHA-256 attempts = milliseconds offline
once the hash is read from `localStorage`. Threat model: someone with
physical access to your phone + Safari devtools. Low realistic risk for
single-tenant but flagged.
**Fix options:**
- Don't persist `pin.hash` on web; require fresh login on every page
  reload (worst UX but eliminates the risk).
- Move PIN verification server-side (real fix but bigger change — needs
  a `pin_hash` column on `users` + a `/auth/verify-pin` endpoint).
- Accept the risk and document the threat model.
**Estimated:** S for "don't persist", L for server-side.

---

## HIGH — functional / a11y gaps

### 6. ~~Android TalkBack: keypad bottom-left spacer is focusable~~ — OBSOLETE
**Source:** Audit IMPORTANT (4-agent review, May 2026).
**Status:** Obsolete as of commit `aefcea8` (2026-05-25) — PinGate
keypad removed entirely. Skip.
**Risk:** `PinGate.tsx` renders `<View style={styles.key} />` with
`accessibilityElementsHidden + importantForAccessibility="no"`, but per
the audit Android TalkBack doesn't honor these on a raw `View`. The 72×72
empty region focuses as an unlabeled control.
**Fix:** Add `accessible={false}` + `pointerEvents="none"`. Spot-check
with TalkBack on a real device.
**Estimated:** XS.

### 7. Login lacks password-visibility toggle, `autoComplete`, and a "Forgot password?" link
**Source:** UI SEVERE (4-agent review, May 2026).
**Status:** Not addressed.
**Risk:** Even at the new 30-day JWT lifetime the owner types the password
monthly. Typos with `secureTextEntry` are painful and unrecoverable
without an eye-toggle. iOS Keychain autofill needs
`autoComplete="current-password"` + `textContentType="password"` to fire.
"Forgot password?" link is a placeholder until #3 ships.
**Fix:** Add the eye toggle (own state, toggles `secureTextEntry`) and
the autocomplete attributes to both `login.tsx` and `register.tsx`.
**Estimated:** S.

### 8. Register screen has no `KeyboardAvoidingView` or `returnKeyType` chain
**Source:** Audit NICE-TO-HAVE (4-agent review, May 2026).
**Status:** Not addressed.
**Risk:** On a small phone the keyboard hides the submit button; no Tab
progression between Name → Email → Password → Submit.
**Fix:** Mirror `login.tsx`'s `KeyboardAvoidingView` wrapper; add
`ref`-chained `focus()` calls + `returnKeyType="next" | "go"`.
**Estimated:** XS.

### 9. 2 exercises still need images
**Source:** CLAUDE.md known gap.
**Status:** Carried since at least the April 2026 audit.
**Items:** `seated_soleus_stretch`, `banded_fire_hydrant`.
**Fix:** Use the admin screen's Find button to source. Bump
`MAX_IMAGELESS` ratchet in `backend/tests/test_seed_snapshot.py` to 0
when both land.
**Estimated:** XS.

---

## MEDIUM — architectural debt

### 10. `useUnlockCoordinator` + `useWebKeypad` hook extractions
**Source:** Architect SEVERE (4-agent review, May 2026); deferred from PR-5.
**Status:** Partially addressed — PR-5 extracted the pure state reducer.
The biometric coordinator + web keyboard listener are still in the
component.
**Why it matters:** PinGate is ~491 LOC after the Reset PIN overlay landed
in PR-6. Extracting these two hooks would shrink it another ~80 LOC and
remove the remaining side-effect tangle.
**Fix:** Move the bio-unlocking + offer-bio prompt orchestration into
`mobile/lib/pinGate/useUnlockCoordinator.ts`; move the web-keyboard
listener into `mobile/lib/pinGate/useWebKeypad.ts`. Component then becomes
~250 LOC of presentation + `useReducer` + 3 small hook calls.
**Estimated:** M. No behavior change.

### 11. `maybeTouchUnlock` does `require('./pin')` from `api.ts`
**Source:** Architect IMPORTANT (4-agent review, May 2026).
**Status:** Not addressed.
**Risk:** API layer reaches into PIN — circular-ish dependency that
silently couples the request interceptor to device-side state. Hard to
test the API client in isolation.
**Fix:** Invert. `pin.ts` exports an axios interceptor factory; register
it from `_layout.tsx` after the API client is constructed. `api.ts` then
doesn't know PIN exists.
**Estimated:** S.

### 12. GTD folder seed hardcoded in `auth_routes.py:30-40`
**Source:** Architect IMPORTANT (4-agent review, May 2026).
**Status:** Not addressed.
**Risk:** Inline `defaults` list inside the register handler. Mixes
business logic with route plumbing; can't be reused (e.g. by a future
admin "reset folders to defaults" tool).
**Fix:** Move to `backend/app/seed_user.py::seed_default_folders(cur, user_id)`
to match the existing `seed_workouts.seed_global_routines_for_all_users`
shape.
**Estimated:** S.

---

## LOW — features / nice-to-haves (deferred this session)

These were explicitly chosen against or punted in May 2026. Listed for
visibility only; revisit if the cost/benefit changes.

### 13. Web token in httpOnly cookie + CSRF mitigation
Chosen against in **D1** during the synthesis ("Just bump JWT, keep
localStorage, accept the XSS risk for this app"). Revisit only if the
XSS threat model changes (e.g. someone introduces a rich-text editor that
renders untrusted HTML).

### 14. Passkeys / WebAuthn
Chosen against in **D2** as vanity for a single user. Architect noted
they're cheap to add orthogonally if the audience ever grows.

### 15. "Trust this device" refresh tokens
Chosen against in **D2**. Refresh-token rotation, replay detection, and
two-secret rotation don't earn their keep at one user. The 30-day JWT +
PinGate combo collapses the same daily friction.

### 16. Inline error styling as a filled banner
UI NICE-TO-HAVE — current thin red string works but a filled rose-50
banner with a warning glyph would read as "this is the problem" much
faster.

### 17. Web keypad layout: 4-digit input field vs 9-circle pad on desktop
UI NICE-TO-HAVE — keypad-on-web feels phone-emulator-ish. Single
`inputMode="numeric"` field with `autoComplete="one-time-code"` would
look native on a desktop browser.

---

## Recommended next batch

If shipping in priority order, the cheapest urgent wins are **#1 + #2 + #4 +
#6 + #8** — five PRs, all S/XS, that close half the deferred SEVERE list and
the lingering a11y gaps. **#3** needs design first (which recovery model fits
the self-hosted single-user posture). **#10, #11, #12** are pure tidying and
can wait until a future architecture sweep.

**Update 2026-05-26:** #1, #2, #4 shipped in PRs #207–#209. #5 + #6 are
obsolete after the PinGate rip-out (commit `aefcea8`). Remaining cheap
wins are **#7 + #8 + #9**; #3 still needs the recovery-model design call.
