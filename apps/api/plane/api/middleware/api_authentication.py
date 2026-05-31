# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""API-key authentication backend for the external ``/api/v1/`` REST surface.

Defines :class:`APIKeyAuthentication`, the sole DRF authentication backend
wired into :class:`plane.api.views.base.BaseAPIView` and therefore applied
to every endpoint mounted under ``api/v1/`` (see ``apps/api/plane/urls.py``).
Unlike ``plane.app`` (session-cookie authenticated), every request to this
external surface is identified by an ``X-Api-Key`` header validated against
the :class:`~plane.db.models.APIToken` table, which the migrator container
provisions before the API service accepts traffic.
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
    """DRF authentication backend for ``X-Api-Key``-based programmatic access.

    Validates the request's ``X-Api-Key`` header against the
    :class:`plane.db.models.APIToken` table, requiring the token to be active
    and either unexpired or with no expiry configured. On success, the
    matching row's ``last_used`` column is stamped with the current timestamp
    via a partial save and ``(user, token)`` is returned per the DRF
    authentication contract; on failure,
    :exc:`~rest_framework.exceptions.AuthenticationFailed` is raised so DRF
    returns ``401 Unauthorized``. A missing header returns ``None`` so DRF
    treats the request as anonymous and lets downstream
    :class:`~rest_framework.permissions.IsAuthenticated` reject it.

    This is the sole entry in ``BaseAPIView.authentication_classes`` and is
    what makes ``/api/v1/`` a programmatically-callable surface rather than a
    browser session surface. The :class:`~plane.db.models.APIToken` table is
    expected to exist before this class is exercised because the migrator
    container runs Django migrations before the API service starts.

    Class Attributes:
        www_authenticate_realm: Realm string surfaced in the
            ``WWW-Authenticate`` header on ``401`` responses.
        media_type: Content type declared for authentication failure
            responses.
        auth_header_name: HTTP header that carries the API key; overridable
            in subclasses.
    """

    www_authenticate_realm = "api"
    media_type = "application/json"
    auth_header_name = "X-Api-Key"

    def get_api_token(self, request):
        """Return the raw ``X-Api-Key`` header value, or ``None`` if absent.

        No validation or normalization is performed here; extraction is
        separated from :meth:`validate_api_token` so subclasses can override
        either half (different header name, or different lookup strategy)
        independently.
        """
        return request.headers.get(self.auth_header_name)

    def validate_api_token(self, token):
        """Resolve ``token`` to its active, non-expired ``APIToken`` row.

        The lookup gates on ``is_active=True`` and accepts either
        ``expired_at IS NULL`` (no expiry configured) or
        ``expired_at > now()`` (configured but not yet elapsed). On a match,
        the row's ``last_used`` column is stamped with ``timezone.now()`` and
        persisted via ``save(update_fields=["last_used"])``; the partial save
        avoids clobbering concurrent writes to unrelated fields on the same
        row.

        Returns:
            tuple[User, str]: The owning user and the raw token string,
            echoed per DRF's authentication backend contract.

        Raises:
            AuthenticationFailed: If no matching :class:`APIToken` row exists
                (unknown token, revoked via ``is_active=False``, or expired).
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
        """Resolve a request to ``(user, token)`` via the ``X-Api-Key`` header.

        DRF calls this entry point for each incoming request whenever this
        class is listed in ``authentication_classes``. Header extraction is
        delegated to :meth:`get_api_token` and token validation to
        :meth:`validate_api_token`; ``authenticate_header`` is intentionally
        not overridden so DRF falls back to its default ``WWW-Authenticate``
        value derived from :attr:`www_authenticate_realm`.

        Returns:
            tuple[User, str] | None: ``(user, token)`` on success; ``None``
            when no ``X-Api-Key`` header is supplied, so DRF treats the
            request as anonymous and lets downstream
            :class:`~rest_framework.permissions.IsAuthenticated` reject it.

        Raises:
            AuthenticationFailed: Propagated from :meth:`validate_api_token`
                when the supplied token is unknown, inactive, or expired.
        """
        token = self.get_api_token(request=request)
        if not token:
            return None

        # Validate the API token
        user, token = self.validate_api_token(token)
        return user, token
