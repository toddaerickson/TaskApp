-- Per-user JWT version counter for revocation. Bumped on change-password
-- success and on /auth/sign-out-everywhere. JWTs encode the version at
-- issue time; get_current_user_id rejects on mismatch so a leaked token
-- can be invalidated without rotating JWT_SECRET (which would log out
-- the legit user too).
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
