"""Sentry PII scrubbing + init gating.

We don't actually ship events to Sentry from the test suite; we test the
pure `_before_send` scrubber and the init-gate behavior. The scrubber is
what prevents passwords / tokens / Authorization headers from leaving
the process if a handler throws, so it's worth direct coverage.
"""
from app import sentry_setup


def test_before_send_scrubs_password_in_request_body():
    event = {
        "request": {
            "data": {"email": "user@x.com", "password": "hunter2"},
        },
    }
    out = sentry_setup._before_send(event, {})
    assert out is not None
    assert out["request"]["data"]["email"] == "user@x.com"
    assert out["request"]["data"]["password"] == "[scrubbed]"


def test_before_send_scrubs_authorization_header_case_insensitively():
    event = {
        "request": {
            "headers": {
                "Authorization": "Bearer abc.def.ghi",
                "authorization": "Bearer xyz",
                "X-Request-Id": "abc123",
                "Content-Type": "application/json",
            },
        },
    }
    out = sentry_setup._before_send(event, {})
    h = out["request"]["headers"]
    assert h["Authorization"] == "[scrubbed]"
    assert h["authorization"] == "[scrubbed]"
    # Non-sensitive headers are preserved unchanged.
    assert h["X-Request-Id"] == "abc123"
    assert h["Content-Type"] == "application/json"


def test_before_send_scrubs_tokens_and_api_keys():
    event = {
        "request": {
            "data": {
                "access_token": "eyJ...",
                "refresh_token": "r123",
                "token": "t456",
                "api_key": "secret",
                "regular_field": "keep me",
            },
        },
    }
    out = sentry_setup._before_send(event, {})
    d = out["request"]["data"]
    assert d["access_token"] == "[scrubbed]"
    assert d["refresh_token"] == "[scrubbed]"
    assert d["token"] == "[scrubbed]"
    assert d["api_key"] == "[scrubbed]"
    assert d["regular_field"] == "keep me"


def test_before_send_scrubs_nested_body():
    """Sensitive fields can live inside nested objects/arrays — e.g.
    a validation error payload that echoes the original request."""
    event = {
        "request": {
            "data": {
                "user": {"email": "x@y.com", "password": "p"},
                "tokens": [{"access_token": "a"}, {"refresh_token": "r"}],
            },
        },
    }
    out = sentry_setup._before_send(event, {})
    assert out["request"]["data"]["user"]["password"] == "[scrubbed]"
    assert out["request"]["data"]["tokens"][0]["access_token"] == "[scrubbed]"
    assert out["request"]["data"]["tokens"][1]["refresh_token"] == "[scrubbed]"


def test_before_send_scrubs_extra_context():
    event = {"extra": {"debug_token": "x", "password": "p", "path": "/a"}}
    out = sentry_setup._before_send(event, {})
    assert out["extra"]["password"] == "[scrubbed]"
    # Fields not on the sensitive list are preserved.
    assert out["extra"]["path"] == "/a"


def test_before_send_preserves_non_sensitive_event_shape():
    """A normal traceback event with no sensitive fields should pass
    through unchanged (minus our no-ops on optional keys)."""
    event = {
        "message": "Oops",
        "level": "error",
        "request": {"url": "/tasks/1", "method": "GET"},
    }
    out = sentry_setup._before_send(event, {})
    assert out["message"] == "Oops"
    assert out["request"]["url"] == "/tasks/1"


def test_before_send_drops_cookies():
    event = {"request": {"cookies": {"session": "x"}}}
    out = sentry_setup._before_send(event, {})
    assert out["request"]["cookies"] == "[scrubbed]"


def test_init_sentry_noop_without_dsn(monkeypatch):
    """The gate: no DSN means no init, no network, no side effects."""
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    assert sentry_setup.init_sentry() is False


def test_init_sentry_initializes_with_dsn(monkeypatch):
    """Real init path. Uses a fake DSN so sentry-sdk doesn't try to POST."""
    monkeypatch.setenv("SENTRY_DSN", "https://public@o0.ingest.sentry.io/0")
    monkeypatch.setenv("SENTRY_ENV", "test")
    try:
        assert sentry_setup.init_sentry() is True
    finally:
        # Tear down so later tests don't inherit a live hub.
        import sentry_sdk
        sentry_sdk.init(dsn=None)


def test_tag_request_id_is_safe_when_sentry_not_initialized():
    """Without an active hub, set_tag is a no-op — we still call it and
    must not raise."""
    import sentry_sdk
    sentry_sdk.init(dsn=None)
    # Should not raise.
    sentry_setup.tag_request_id("abc123def456")
