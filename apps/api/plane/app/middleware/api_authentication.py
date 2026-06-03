# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Custom DRF authentication backend for ``X-Api-Key`` header-based API access.

This backend is non-intrusive: when the ``X-Api-Key`` header is absent it
returns ``None`` so other configured DRF authentication backends still run.
On a successful match it updates ``APIToken.last_used`` to the current
``timezone.now()`` and returns the standard DRF ``(user, token)`` tuple.

A token is considered valid only when ``is_active=True`` AND
(``expired_at`` IS NULL OR ``expired_at > now()``); otherwise the lookup
raises :class:`rest_framework.exceptions.AuthenticationFailed`.

This module is the API-key authentication boundary for the web-client API
served by ``apps/api/plane/app/``. Session-cookie authentication is handled
separately in :mod:`plane.authentication` and is NOT part of this module.
The ``APIToken`` lookup uses the read-write database (no read-replica
routing), so consumers must not assume replica safety on auth resolution.
"""

# Django imports
from django.utils import timezone
from django.db.models import Q

# Third party imports
from rest_framework import authentication
from rest_framework.exceptions import AuthenticationFailed

# Module imports
from plane.db.models import APIToken


class APIKeyAuthentication(authentication.BaseAuthentication):
    """DRF authentication backend that resolves the ``X-Api-Key`` header.

    The class drives a four-step authentication flow:

    1. Header extraction via :meth:`get_api_token` (reads
       ``request.headers["X-Api-Key"]``).
    2. ORM lookup against active, non-expired ``APIToken`` records
       (``is_active=True`` AND (``expired_at`` IS NULL OR
       ``expired_at > now()``)).
    3. ``last_used`` bookkeeping write
       (``api_token.save(update_fields=["last_used"])``).
    4. Return of the DRF-conventional ``(user, token)`` tuple.

    Class attributes:
        www_authenticate_realm: DRF realm name (``"api"``) returned in
            ``WWW-Authenticate`` challenge headers when authentication fails.
        media_type: Content type (``"application/json"``) advertised by this
            backend for response negotiation.
        auth_header_name: Exact HTTP request header (``"X-Api-Key"``) the
            backend reads from. Any deviation is a breaking change for
            API consumers.

    On failure, :class:`rest_framework.exceptions.AuthenticationFailed` is
    raised with the message ``"Given API token is not valid"``.
    """

    www_authenticate_realm = "api"
    media_type = "application/json"
    auth_header_name = "X-Api-Key"

    def get_api_token(self, request):
        """Return the raw API token from the ``X-Api-Key`` header, or ``None`` if absent."""
        return request.headers.get(self.auth_header_name)

    def validate_api_token(self, token):
        """Validate the API token against active, non-expired ``APIToken`` records.

        Raises :class:`AuthenticationFailed` when no matching active token
        is found. On success, updates ``api_token.last_used`` to
        ``timezone.now()`` and returns the ``(user, token)`` tuple.
        """
        try:
            api_token = APIToken.objects.get(
                Q(Q(expired_at__gt=timezone.now()) | Q(expired_at__isnull=True)),
                token=token,
                is_active=True,
            )
        except APIToken.DoesNotExist:
            raise AuthenticationFailed("Given API token is not valid")

        # save api token last used
        api_token.last_used = timezone.now()
        api_token.save(update_fields=["last_used"])
        return (api_token.user, api_token.token)

    def authenticate(self, request):
        """Authenticate the request via the ``X-Api-Key`` header if present.

        Returns ``None`` (allowing other DRF auth backends to run) when no
        token is sent; otherwise delegates to :meth:`validate_api_token`
        and returns its ``(user, token)`` tuple.
        """
        token = self.get_api_token(request=request)
        if not token:
            return None

        # Validate the API token
        user, token = self.validate_api_token(token)
        return user, token
