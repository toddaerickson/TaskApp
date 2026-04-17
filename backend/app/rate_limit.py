"""Shared slowapi Limiter so routers and main.py see the same instance.

Keyed on the client IP (`get_remote_address`). In test we swap in a no-op
key func via conftest so the 10/min limit doesn't leak across test cases.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
