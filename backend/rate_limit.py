
"""In-process sliding-window rate limiting for authentication and upload routes.

Only sensitive routes are throttled, and the limits are per client address so a
single caller cannot exhaust the API for everybody else. The counters live in
process memory: on multi-instance deployments each instance enforces its own
share of the budget, which is enough to stop brute force and runaway uploads
without adding a shared dependency.
"""

from __future__ import annotations

import os
import time
from collections import defaultdict, deque
from threading import Lock

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse


def _int_setting(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, "") or default)
    except ValueError:
        return default
    return value if value > 0 else default


class SlidingWindowLimiter:
    """Thread-safe per-key request counter limited to `limit` hits per `window`."""

    def __init__(self, limit: int, window_seconds: float, max_keys: int = 5000):
        self.limit = limit
        self.window_seconds = window_seconds
        self.max_keys = max_keys
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str, now: float | None = None) -> bool:
        moment = time.monotonic() if now is None else now
        cutoff = moment - self.window_seconds
        with self._lock:
            bucket = self._hits[key]
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= self.limit:
                return False
            bucket.append(moment)
            if len(self._hits) > self.max_keys:
                self._purge(cutoff)
            return True

    def _purge(self, cutoff: float) -> None:
        """Drop idle keys so a spray of client addresses cannot grow memory."""
        expired = [key for key, bucket in self._hits.items() if not bucket or bucket[-1] <= cutoff]
        for key in expired:
            self._hits.pop(key, None)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


class RouteRule:
    """Match the request paths that need a given limit."""

    def __init__(self, name: str, limit: int, window_seconds: float, prefixes=(), suffixes=()):
        self.name = name
        self.limiter = SlidingWindowLimiter(limit, window_seconds)
        self.prefixes = tuple(prefixes)
        self.suffixes = tuple(suffixes)

    def matches(self, path: str) -> bool:
        return path.startswith(self.prefixes) or path.endswith(self.suffixes)


def client_key(request: Request) -> str:
    """Prefer the address a proxy reports, falling back to the socket peer."""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip() or "unknown"
    return request.client.host if request.client else "unknown"


def default_rules() -> tuple[RouteRule, ...]:
    window_seconds = 60.0
    return (
        RouteRule(
            "auth",
            _int_setting("RATE_LIMIT_AUTH_PER_MINUTE", 20),
            window_seconds,
            prefixes=("/api/auth", "/auth/callback"),
        ),
        RouteRule(
            "upload",
            _int_setting("RATE_LIMIT_UPLOAD_PER_MINUTE", 30),
            window_seconds,
            suffixes=("/verification-image", "/bulk/upload"),
        ),
    )


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Reject over-budget requests on the protected routes with HTTP 429."""

    def __init__(self, app, rules: tuple[RouteRule, ...] | None = None):
        super().__init__(app)
        self.rules = rules if rules is not None else default_rules()

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        for rule in self.rules:
            if not rule.matches(path):
                continue
            if not rule.limiter.allow(client_key(request)):
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Too many requests. Please wait a moment and try again."},
                    headers={"Retry-After": str(int(rule.limiter.window_seconds))},
                )
            break
        return await call_next(request)
