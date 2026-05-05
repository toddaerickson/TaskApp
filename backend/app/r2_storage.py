"""Cloudflare R2 storage wrapper.

R2 is S3-compatible — boto3 talks to it as a custom-endpoint S3 client.
This wrapper is the seam between FastAPI route handlers and the byte
store, so nothing else in the codebase needs to know boto3 exists.

**This module is wired but not yet called.** PR-A2a (foundation) ships
the wrapper; PR-A2b switches admin uploads to use it; PR-A2c migrates
existing `https:` rows.

Threading model: boto3 clients are thread-safe but not asyncio-aware.
Routes that call `put_object` should wrap in `asyncio.to_thread` so the
event loop isn't blocked during the upload.

Failure semantics: every method raises `RuntimeError` (with a clear
message) rather than letting boto3's `ClientError` / `EndpointConnection-
Error` leak. Routes catch this once at the top and return 502 / 503.
"""
from __future__ import annotations

import logging

from app import config

log = logging.getLogger(__name__)


class R2Storage:
    """Minimal R2 client. Lazy-imports boto3 so a backend that never
    touches R2 (dev, tests without R2 secrets) doesn't pay the import
    cost or require boto3 to be installed during a partial deploy.

    Construct once per app boot. The boto3 session is cached on the
    instance; reusing it across calls reuses the underlying urllib3
    connection pool. Don't construct per-request.
    """

    def __init__(self) -> None:
        if not config.r2_configured():
            # Fail loudly at construction so a misconfigured environment
            # doesn't silently fall through to "uploads succeed locally
            # but never make it to R2." Caller should gate construction
            # behind `config.r2_configured()`.
            raise RuntimeError(
                "R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, "
                "R2_SECRET_ACCESS_KEY, R2_BUCKET, and R2_PUBLIC_URL."
            )
        # Lazy import — keeps `import app.r2_storage` cheap when R2 isn't
        # actually used. boto3 has a ~600ms cold-start cost.
        try:
            import boto3  # type: ignore[import-not-found]
        except ImportError as e:
            raise RuntimeError(
                "boto3 is not installed. Add `boto3` to requirements.txt."
            ) from e

        self._bucket = config.R2_BUCKET
        self._public_url = config.R2_PUBLIC_URL
        # R2 endpoint format: https://<account-id>.r2.cloudflarestorage.com
        # The signing region is canonical "auto" for R2; boto3 requires
        # _some_ region to construct the signer.
        endpoint = f"https://{config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=config.R2_ACCESS_KEY_ID,
            aws_secret_access_key=config.R2_SECRET_ACCESS_KEY,
            region_name="auto",
        )

    def put_object(self, filename: str, content: bytes, content_type: str) -> None:
        """Upload bytes. `filename` is the object key (relative to the
        bucket root — no leading slash). Idempotent: an existing key
        with identical bytes is overwritten silently. Content-addressed
        callers (sha256-named uploads) effectively get write-once
        behavior because the key only collides on byte-equal content.

        Raises `RuntimeError` on any boto3 failure. The original
        ClientError is the `__cause__` so the operator can drill down
        via `e.__cause__.response['Error']['Code']`.
        """
        try:
            self._client.put_object(
                Bucket=self._bucket,
                Key=filename,
                Body=content,
                ContentType=content_type,
            )
        except Exception as e:
            raise RuntimeError(f"R2 put_object failed for {filename}") from e

    def delete_object(self, filename: str) -> None:
        """Best-effort delete. R2's S3 API returns success even when the
        key didn't exist, so this is idempotent. Raises only on transport
        failure."""
        try:
            self._client.delete_object(Bucket=self._bucket, Key=filename)
        except Exception as e:
            raise RuntimeError(f"R2 delete_object failed for {filename}") from e

    def head_object(self, filename: str) -> bool:
        """Existence check. Returns True if the key exists, False on
        404. Raises only on transport failure (so a smoke-test workflow
        can distinguish "bucket misconfigured" from "object missing")."""
        try:
            self._client.head_object(Bucket=self._bucket, Key=filename)
            return True
        except Exception as e:
            # boto3 raises ClientError with response['Error']['Code'] ==
            # '404' for missing objects; everything else is a real error.
            err = getattr(e, "response", {}).get("Error", {})
            if err.get("Code") in ("404", "NoSuchKey", "NotFound"):
                return False
            raise RuntimeError(f"R2 head_object failed for {filename}") from e

    def public_url(self, filename: str) -> str:
        """Build the public URL for a stored object. Used by the
        resolver in image_urls.py once `r2:<filename>` sentinels start
        appearing (PR-A2b).
        """
        return f"{self._public_url}/{filename}"
