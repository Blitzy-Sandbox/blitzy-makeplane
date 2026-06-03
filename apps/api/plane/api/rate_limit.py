# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""DRF throttle classes for API-key-authenticated traffic on ``/api/v1/``.

Both exported throttles key the rate-limit bucket off the ``X-Api-Key``
request header and stamp ``X-RateLimit-Remaining`` and ``X-RateLimit-Reset``
metadata onto ``request.META`` when a request is allowed. The underlying
``SimpleRateThrottle`` uses Django's cache backend (Redis in production --
caching only; task queueing is handled separately via Celery on RabbitMQ)
to maintain the per-token rolling-window request history. Unauthenticated
traffic short-circuits past these throttles because ``get_cache_key``
returns ``None`` when no ``X-Api-Key`` header is present -- the
``APIKeyAuthentication`` layer rejects anonymous requests earlier.
"""

# python imports
import os

# Third party imports
from rest_framework.throttling import SimpleRateThrottle


class ApiKeyRateThrottle(SimpleRateThrottle):
    """Per-API-key throttle for standard ``/api/v1/`` user API tokens.

    The rate defaults to ``60/minute`` and is overridable at process startup
    via the ``API_KEY_RATE_LIMIT`` environment variable; the value is read
    once at class-definition time, not per request, so changes require a
    process restart. Bound to ``BaseAPIView`` in
    ``plane.api.views.base.BaseAPIView.get_throttles`` so it applies to
    every ``/api/v1/`` endpoint whose ``X-Api-Key`` resolves to a
    non-service ``APIToken``. A missing ``X-Api-Key`` header causes
    ``get_cache_key`` to return ``None``, which makes
    ``SimpleRateThrottle`` allow the request unconditionally -- the
    ``APIKeyAuthentication`` middleware is responsible for rejecting
    anonymous requests before this layer is reached.
    """

    scope = "api_key"
    rate = os.environ.get("API_KEY_RATE_LIMIT", "60/minute")

    def get_cache_key(self, request, view):
        """Return the per-API-key cache key, or ``None`` to skip throttling.

        Yields ``"api_key:<token>"`` so this throttle's bucket lives in its
        own cache namespace and cannot collide with
        ``ServiceTokenRateThrottle``'s bucket for the same token. ``view``
        is part of the DRF throttle contract but is intentionally unused
        by this override.
        """
        # Retrieve the API key from the request header
        api_key = request.headers.get("X-Api-Key")
        if not api_key:
            return None  # Allow the request if there's no API key

        # Use the API key as part of the cache key
        return f"{self.scope}:{api_key}"

    def allow_request(self, request, view):
        """Run the rolling-window check and stamp rate-limit headers on success.

        Delegates the allow/deny decision to ``SimpleRateThrottle.allow_request``
        -- which mutates ``self.cache`` by appending the current timestamp to
        the history list -- and on an allowed request derives the remaining
        budget and the Unix reset timestamp from that history, writing them
        into ``request.META`` as ``X-RateLimit-Remaining`` and
        ``X-RateLimit-Reset`` so downstream view code or response middleware
        can surface them as response headers. Returns the boolean ``allowed``
        decision per the DRF throttle contract.
        """
        allowed = super().allow_request(request, view)

        if allowed:
            now = self.timer()
            # Calculate the remaining limit and reset time
            history = self.cache.get(self.key, [])

            # Remove old histories
            while history and history[-1] <= now - self.duration:
                history.pop()

            # Calculate the requests
            num_requests = len(history)

            # Check available requests
            available = self.num_requests - num_requests

            # Unix timestamp for when the rate limit will reset
            reset_time = int(now + self.duration)

            # Add headers
            request.META["X-RateLimit-Remaining"] = max(0, available)
            request.META["X-RateLimit-Reset"] = reset_time

        return allowed


class ServiceTokenRateThrottle(SimpleRateThrottle):
    """Per-API-key throttle for elevated service-token ``/api/v1/`` traffic.

    Mirrors ``ApiKeyRateThrottle`` but fixes the rate at ``300/minute`` (NOT
    env-var overridable) and uses the cache scope ``"service_token"`` so its
    rolling-window bucket is isolated from the standard ``api_key`` bucket
    for the same token. ``BaseAPIView.get_throttles`` activates this class
    when the ``X-Api-Key`` header resolves to an ``APIToken`` with
    ``is_service=True``, granting higher throughput to trusted
    service-to-service callers. The duplicated ``get_cache_key`` and
    ``allow_request`` bodies are kept verbatim rather than refactored into a
    shared base because each throttle is keyed on its scope name at the
    class level, and parallel concrete classes let operators tune rates and
    bucket isolation independently without touching shared code.
    """

    scope = "service_token"
    rate = "300/minute"

    def get_cache_key(self, request, view):
        """Return the per-service-token cache key, or ``None`` when no API key.

        Yields ``"service_token:<token>"`` so service-token traffic is metered
        in its own cache namespace, distinct from the ``"api_key"`` bucket
        used by ``ApiKeyRateThrottle`` even when both target the same
        underlying API token.
        """
        # Retrieve the API key from the request header
        api_key = request.headers.get("X-Api-Key")
        if not api_key:
            return None  # Allow the request if there's no API key

        # Use the API key as part of the cache key
        return f"{self.scope}:{api_key}"

    def allow_request(self, request, view):
        """Run the rolling-window check and stamp rate-limit headers on success.

        Behaves identically to ``ApiKeyRateThrottle.allow_request`` but
        operates against the ``"service_token"`` cache scope and the
        ``300/minute`` rate; on an allowed request, writes the remaining
        budget and Unix reset timestamp into ``request.META`` as
        ``X-RateLimit-Remaining`` and ``X-RateLimit-Reset`` for downstream
        response middleware.
        """
        allowed = super().allow_request(request, view)

        if allowed:
            now = self.timer()
            # Calculate the remaining limit and reset time
            history = self.cache.get(self.key, [])

            # Remove old histories
            while history and history[-1] <= now - self.duration:
                history.pop()

            # Calculate the requests
            num_requests = len(history)

            # Check available requests
            available = self.num_requests - num_requests

            # Unix timestamp for when the rate limit will reset
            reset_time = int(now + self.duration)

            # Add headers
            request.META["X-RateLimit-Remaining"] = max(0, available)
            request.META["X-RateLimit-Reset"] = reset_time

        return allowed
