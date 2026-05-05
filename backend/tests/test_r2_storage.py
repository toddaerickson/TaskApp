"""Tests for the R2 storage wrapper.

The wrapper is wired but not yet called from any route — PR-A2a foundation
work. These tests use a pure-mock boto3 client so the suite still runs in
environments without R2 credentials (CI, dev, the SQLite leg).

Tests cover: misconfigured construction (refuses to construct), happy
paths for put/delete/head, the head_object 404 / non-404 distinction,
and public URL formatting.
"""
from unittest.mock import MagicMock, patch

import pytest

from app import config


@pytest.fixture
def configured_r2(monkeypatch):
    """Set the five required R2 env vars + reload config. Yields a teardown
    that restores the prior values so other tests see the unconfigured
    state (the default for the suite)."""
    monkeypatch.setattr(config, "R2_ACCOUNT_ID", "acc-123")
    monkeypatch.setattr(config, "R2_ACCESS_KEY_ID", "key-id")
    monkeypatch.setattr(config, "R2_SECRET_ACCESS_KEY", "key-secret")
    monkeypatch.setattr(config, "R2_BUCKET", "taskapp-test")
    monkeypatch.setattr(config, "R2_PUBLIC_URL", "https://cdn.example.com")
    yield


def test_r2_configured_helper_requires_all_five():
    # Suite default: no env → not configured.
    assert config.r2_configured() is False


def test_r2_configured_when_all_five_set(configured_r2):
    assert config.r2_configured() is True


def test_r2_configured_returns_false_when_any_missing(monkeypatch, configured_r2):
    """Drop any one of the five → still falsy. Catches the partial-
    configuration case (e.g. operator forgot to set R2_PUBLIC_URL after
    setting the credentials)."""
    monkeypatch.setattr(config, "R2_PUBLIC_URL", "")
    assert config.r2_configured() is False


def test_r2_storage_refuses_to_construct_without_config():
    from app.r2_storage import R2Storage
    with pytest.raises(RuntimeError, match="R2 not configured"):
        R2Storage()


def test_r2_storage_constructs_when_configured(configured_r2):
    """boto3 import is lazy + we mock it so the test doesn't actually
    install boto3 to pass. The mocked client is captured for downstream
    tests via the patcher fixture below."""
    with patch("boto3.client") as mock_client:
        from app.r2_storage import R2Storage
        s = R2Storage()
        mock_client.assert_called_once()
        # endpoint_url should be the R2 cloudflarestorage.com pattern
        kwargs = mock_client.call_args.kwargs
        assert kwargs["endpoint_url"] == "https://acc-123.r2.cloudflarestorage.com"
        assert kwargs["region_name"] == "auto"
        assert s._bucket == "taskapp-test"


def test_r2_storage_put_object_calls_boto3(configured_r2):
    fake_client = MagicMock()
    with patch("boto3.client", return_value=fake_client):
        from app.r2_storage import R2Storage
        s = R2Storage()
        s.put_object("abc.jpg", b"fakebytes", "image/jpeg")
        fake_client.put_object.assert_called_once_with(
            Bucket="taskapp-test",
            Key="abc.jpg",
            Body=b"fakebytes",
            ContentType="image/jpeg",
        )


def test_r2_storage_put_object_wraps_errors(configured_r2):
    """boto3 ClientError → RuntimeError with the original chained as
    `__cause__`. Routes catch the RuntimeError; operators can drill via
    the chain when debugging."""
    fake_client = MagicMock()
    fake_client.put_object.side_effect = RuntimeError("boto3 boom")
    with patch("boto3.client", return_value=fake_client):
        from app.r2_storage import R2Storage
        s = R2Storage()
        with pytest.raises(RuntimeError, match="R2 put_object failed"):
            s.put_object("abc.jpg", b"x", "image/jpeg")


def test_r2_storage_delete_object(configured_r2):
    fake_client = MagicMock()
    with patch("boto3.client", return_value=fake_client):
        from app.r2_storage import R2Storage
        s = R2Storage()
        s.delete_object("abc.jpg")
        fake_client.delete_object.assert_called_once_with(
            Bucket="taskapp-test", Key="abc.jpg",
        )


def test_r2_storage_head_object_returns_true_when_exists(configured_r2):
    fake_client = MagicMock()
    with patch("boto3.client", return_value=fake_client):
        from app.r2_storage import R2Storage
        s = R2Storage()
        assert s.head_object("abc.jpg") is True


def test_r2_storage_head_object_returns_false_on_404(configured_r2):
    fake_client = MagicMock()
    err = Exception("not found")
    err.response = {"Error": {"Code": "404"}}
    fake_client.head_object.side_effect = err
    with patch("boto3.client", return_value=fake_client):
        from app.r2_storage import R2Storage
        s = R2Storage()
        assert s.head_object("abc.jpg") is False


def test_r2_storage_head_object_raises_on_other_errors(configured_r2):
    """Transport / auth failures must NOT silently report False — the
    smoke-test workflow needs to distinguish 'object missing' from
    'bucket misconfigured'."""
    fake_client = MagicMock()
    err = Exception("auth failed")
    err.response = {"Error": {"Code": "403"}}
    fake_client.head_object.side_effect = err
    with patch("boto3.client", return_value=fake_client):
        from app.r2_storage import R2Storage
        s = R2Storage()
        with pytest.raises(RuntimeError, match="R2 head_object failed"):
            s.head_object("abc.jpg")


def test_r2_storage_public_url_format(configured_r2):
    with patch("boto3.client"):
        from app.r2_storage import R2Storage
        s = R2Storage()
        assert s.public_url("abc.jpg") == "https://cdn.example.com/abc.jpg"
