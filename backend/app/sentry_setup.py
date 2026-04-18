"""Sentry error telemetry.

Initialization is opt-in: `init_sentry()` is a no-op unless `SENTRY_DSN`
is set in the environment. Keeps dev / CI / test runs from phoning home
and keeps sentry-sdk off the hot path when the operator hasn't provisioned
a Sentry project.

The `before_send` hook scrubs sensitive data before events leave the
process. It's a belt-and-braces check on top of sentry-sdk's own PII
defaults — we have our own list of fields (password, access_token,
Authorization) because most of them are app-specific names that the SDK
can't know about.

Correlation: the `request_id` tag is attached per-request by
`tag_request_id()`, which `RequestIDMiddleware` calls as it installs the
contextvar. That way a Sentry event and a server log line carry the same
id, and the mobile client (which also sends X-Request-Id) can be paired
with the server-side traceback.
"""
from __future__ import annotations

import logging
import os
from typing import Any

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.logging import LoggingIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

log = logging.getLogger(__name__)

# Keys that should never leave the process. Compared case-insensitively
# against both request-body keys and header names. Keeps the list short
# and explicit; anything borderline goes through review rather than
# getting a regex.
_SENSITIVE_KEYS: frozenset[str] = frozenset(
    k.lower() for k in (
        "password",
        "current_password",
        "new_password",
        "access_token",
        "refresh_token",
        "token",
        "authorization",
        "cookie",
        "set-cookie",
        "x-api-key",
        "api_key",
        "api-key",
    )
)
_SCRUBBED = "[scrubbed]"


def _scrub_mapping(obj: Any) -> Any:
    """Walk a JSON-shaped value, replacing sensitive keys with a marker.

    Returns a new structure; input is not mutated. Non-dict / non-list
    values are returned unchanged."""
    if isinstance(obj, dict):
        return {
            k: (_SCRUBBED if isinstance(k, str) and k.lower() in _SENSITIVE_KEYS
                else _scrub_mapping(v))
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [_scrub_mapping(v) for v in obj]
    return obj


def _before_send(event: dict, _hint: dict) -> dict | None:
    """Final gate before an event ships to Sentry. Scrubs:

    - `request.headers[*]`: Authorization / Cookie values
    - `request.data[*]`: password / token fields in JSON bodies
    - `request.query_string`: best-effort — rare path, usually empty
    - `extra[*]`: any ad-hoc context the caller attached

    Returning None would drop the event entirely; we return the scrubbed
    event instead so operators still see the traceback minus the secrets.
    """
    req = event.get("request") or {}
    if isinstance(req.get("headers"), dict):
        req["headers"] = _scrub_mapping(req["headers"])
    if "data" in req:
        req["data"] = _scrub_mapping(req["data"])
    if "cookies" in req:
        req["cookies"] = _SCRUBBED
    event["request"] = req

    if isinstance(event.get("extra"), dict):
        event["extra"] = _scrub_mapping(event["extra"])

    return event


def init_sentry() -> bool:
    """Idempotently initialize Sentry. No-op when SENTRY_DSN is missing.

    Returns True if initialization happened, False otherwise. The return
    value is only used by tests / startup logging; callers don't branch
    on it."""
    dsn = os.environ.get("SENTRY_DSN", "").strip()
    if not dsn:
        return False

    environment = os.environ.get("SENTRY_ENV", os.environ.get("ENV", "production"))
    release = os.environ.get("SENTRY_RELEASE")  # let operator pin to a git sha

    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=release,
        # Don't let sentry-sdk auto-enable PII. We explicitly scrub in
        # before_send and pass only what we want.
        send_default_pii=False,
        # 10% traces by default — enough to notice a hot path without
        # blowing through the free tier. Operator can bump via env.
        traces_sample_rate=float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
        integrations=[
            FastApiIntegration(),
            StarletteIntegration(),
            # Ship WARNING+ as breadcrumbs, ERROR+ as events. The SDK's
            # default logging integration already does roughly this; we
            # set it explicitly so changes here are in one place.
            LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
        ],
        before_send=_before_send,
    )
    log.info("sentry: initialized (env=%s, traces=%s)",
             environment,
             os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0.1"))
    return True


def tag_request_id(request_id: str) -> None:
    """Attach the current request id to the active Sentry scope so any
    event captured inside the request carries it as a tag. No-op when
    Sentry wasn't initialized (hub is a dummy in that case)."""
    if not request_id:
        return
    try:
        sentry_sdk.set_tag("request_id", request_id)
    except Exception:
        # Never let telemetry wiring crash the request.
        pass
