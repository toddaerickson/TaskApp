"""Shared slowapi Limiter so routers and main.py see the same instance.

Keyed on `Fly-Client-IP` when present (Fly's edge sets this from its own
TCP-level observation, so it isn't spoofable by the client), falling back
to the socket peer for local dev and non-Fly deploys. We deliberately do
NOT trust `X-Forwarded-For`'s first entry — the client can prepend
arbitrary IPs to that header, which would defeat the limit. In tests the
conftest disables the limiter entirely; a handful of tests re-enable it
to assert the cap fires.
"""
from starlette.requests import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def _client_ip_key(request: Request) -> str:
    fly_ip = request.headers.get("fly-client-ip")
    if fly_ip:
        return fly_ip
    return get_remote_address(request)


limiter = Limiter(key_func=_client_ip_key)
