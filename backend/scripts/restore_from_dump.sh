#!/usr/bin/env bash
# Restore a nightly GPG-encrypted pg_dump into a target Postgres URL.
#
# Wraps the two-step `gpg --decrypt | pg_restore` dance into a single
# command so the disaster-recovery runbook has a one-liner to point at.
# Keeps the restore procedure visible in-repo rather than buried in
# CI secrets or operator memory.
#
# Usage:
#   BACKUP_PASSPHRASE=... TARGET_DATABASE_URL=postgresql://... \
#     backend/scripts/restore_from_dump.sh [release-tag]
#
# If release-tag is omitted, uses the most recent `backup-*` release
# from the toddaerickson/TaskApp repo (requires `gh` authenticated).
#
# ALWAYS test-restore into a Neon BRANCH, never directly over primary.
# The primary restore step is deliberately manual — see
# docs/DISASTER_RECOVERY.md Scenario 2 for the Fly secrets swap.
set -euo pipefail

REPO="${REPO:-toddaerickson/TaskApp}"

if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  echo "Error: BACKUP_PASSPHRASE env var not set." >&2
  echo "Retrieve from the operator's password manager." >&2
  exit 2
fi
if [ -z "${TARGET_DATABASE_URL:-}" ]; then
  echo "Error: TARGET_DATABASE_URL env var not set." >&2
  echo "This should be a Neon BRANCH for drills, or a fresh DB for real recovery." >&2
  echo "Never aim this at production without first verifying on a branch." >&2
  exit 2
fi

TAG="${1:-}"
if [ -z "$TAG" ]; then
  # Default: latest backup-* release. gh sorts desc by created at.
  TAG=$(gh release list -R "$REPO" --limit 50 --json tagName \
        | jq -r '.[] | select(.tagName | startswith("backup-")) | .tagName' \
        | head -n 1)
  if [ -z "$TAG" ]; then
    echo "Error: no backup-* releases found on $REPO." >&2
    exit 3
  fi
  echo "Using most recent backup tag: $TAG"
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "==> Downloading $TAG from $REPO ..."
gh release download "$TAG" -R "$REPO" -p 'backup.dump.gpg' -D "$WORK"

echo "==> Decrypting ..."
gpg --decrypt --batch --passphrase "$BACKUP_PASSPHRASE" \
    --output "$WORK/backup.dump" "$WORK/backup.dump.gpg"

SIZE=$(stat -c%s "$WORK/backup.dump")
echo "    Dump size: $SIZE bytes"
if [ "$SIZE" -lt 1024 ]; then
  echo "Error: decrypted dump is suspiciously small. Aborting." >&2
  exit 4
fi

# Pre-flight: warn if pg_restore looks older than the dump. The
# nightly backup workflow pins pg_dump to PG 17 (see PR #136). An
# operator running this from a fresh laptop with the OS-default
# postgresql-client may be on PG 14/15/16; pg_restore is forgiving
# across one or two majors but the failure mode when it isn't is
# obscure ("unsupported version (1.16-0) in file header" or worse,
# silent partial restore). Catch the foot-gun early.
#
# Heuristic only — pg_restore custom-format dump headers don't
# carry the producer's pg_dump major as a structured field, so
# we read it from the TOC dump-version line instead. If that line
# format ever changes, the script falls through to "unknown" and
# warns rather than blocking the restore.
DUMP_VERSION_LINE=$(pg_restore --list "$WORK/backup.dump" 2>/dev/null | grep -E '^;[[:space:]]+Dump Version:' | head -n 1 || true)
if [ -n "$DUMP_VERSION_LINE" ]; then
  DUMP_FMT=$(printf '%s\n' "$DUMP_VERSION_LINE" | sed -E 's/.*Dump Version:[[:space:]]+([0-9]+\.[0-9]+)-.*/\1/')
  CLIENT_MAJOR=$(pg_restore --version | grep -oE '[0-9]+\.[0-9]+' | head -n 1 | cut -d. -f1)
  echo "    Dump TOC format:  $DUMP_FMT"
  echo "    pg_restore major: $CLIENT_MAJOR"
  # Custom-format dump version 1.15 = PG 16 producer; 1.16 = PG 17;
  # higher = newer. pg_restore accepts dumps from its own major and
  # earlier. If the dump format integer-part is 1 and the fractional
  # part is high, the producer was newer than us — warn loudly.
  if [ "$CLIENT_MAJOR" -lt 17 ]; then
    cat >&2 <<EOF
Warning: pg_restore is on major $CLIENT_MAJOR. The nightly backup
workflow uses pg_dump 17 (see .github/workflows/backup-neon.yml).
pg_restore from a major older than the dump producer can fail
with 'unsupported version' or, worse, partially restore. Strongly
recommend installing postgresql-client-17 from apt.postgresql.org
before continuing. Press Ctrl-C now if you want to abort.
EOF
    sleep 5
  fi
fi

echo "==> Restoring into TARGET_DATABASE_URL ..."
# --clean + --if-exists makes the restore idempotent: existing tables
# get dropped and recreated. Safe on a fresh DB, safe on a branch,
# DANGEROUS on production (which is why the caller must opt in via
# TARGET_DATABASE_URL — we deliberately don't read DATABASE_URL here).
pg_restore --dbname="$TARGET_DATABASE_URL" \
           --clean --if-exists --no-owner --no-privileges \
           "$WORK/backup.dump"

echo "==> Restore complete."
echo "    Verify with: psql \"\$TARGET_DATABASE_URL\" -c 'SELECT COUNT(*) FROM users;'"
echo "    See docs/DISASTER_RECOVERY.md § Verification for the full checklist."
