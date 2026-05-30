# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Google OAuth 2.0 sign-in provider implementation for Plane authentication.

Concrete :class:`OauthAdapter` subclass that wires Plane's standard
authorization-code flow into Google's OpenID-Connect-style OAuth endpoints.
The module configures Google's token-exchange and userinfo URLs, assembles
the consent-screen URL, validates that ``GOOGLE_CLIENT_ID`` /
``GOOGLE_CLIENT_SECRET`` are configured, and maps Google's profile payload
into Plane's normalized user shape on completion.

Provider lifecycle is driven by :class:`OauthAdapter` in
:mod:`plane.authentication.adapter.oauth`; this file only supplies the
Google-specific endpoints, scopes, and field mappings. Token persistence
into the :class:`~plane.db.models.Account` row happens in
:meth:`OauthAdapter.create_update_account` (base class), not here -- these
provider instances are **stateless adapters** instantiated per request.
"""

# Python imports
import os
from datetime import datetime
from urllib.parse import urlencode

import pytz

# Module imports
from plane.authentication.adapter.oauth import OauthAdapter
from plane.license.utils.instance_value import get_configuration_value
from plane.authentication.adapter.error import (
    AUTHENTICATION_ERROR_CODES,
    AuthenticationException,
)


class GoogleOAuthProvider(OauthAdapter):
    """Google OAuth 2.0 authorization-code provider.

    Wires Plane's :class:`OauthAdapter` against Google's OAuth endpoints
    and provides the Google-specific authorization-URL assembly, token-
    exchange request shape, and profile-to-user mapping. Tokens are
    exchanged at ``https://oauth2.googleapis.com/token`` and the userinfo
    payload is fetched from
    ``https://www.googleapis.com/oauth2/v2/userinfo``; the requested
    scopes (``userinfo.email`` + ``userinfo.profile``) are the standard
    OpenID-Connect identity + profile pair.

    Authorization URL (assembled in :meth:`__init__`):
        ``https://accounts.google.com/o/oauth2/v2/auth?...`` with query
        parameters ``response_type=code``, ``access_type=offline``,
        ``prompt=consent``. The ``offline`` + ``consent`` pairing
        intentionally forces refresh-token issuance and re-prompts the
        user for scope consent on every sign-in so that Plane reliably
        receives a refresh token even when the user previously granted
        access -- needed because Google only issues a refresh token on
        the initial grant by default.

    Redirect URI pattern:
        ``{scheme}://{host}/auth/google/callback/`` where ``scheme`` is
        ``https`` when ``request.is_secure()`` is true, else ``http``.

    Configuration source (per AAP section 0.2.2):
        Reads ``GOOGLE_CLIENT_ID`` and ``GOOGLE_CLIENT_SECRET`` via
        :func:`get_configuration_value` (Plane's instance-configuration
        system), with ``os.environ`` as the fallback. Raises
        :exc:`AuthenticationException` with error code
        ``GOOGLE_NOT_CONFIGURED`` if either is missing.

    User attributes extracted by :meth:`set_user_data`:
        * ``email`` <- ``userinfo.email``
        * ``user.avatar`` <- ``userinfo.picture``
        * ``user.first_name`` <- ``userinfo.given_name``
        * ``user.last_name`` <- ``userinfo.family_name``
        * ``user.provider_id`` <- ``userinfo.id``
        * ``user.is_password_autoset`` <- ``True`` (OAuth users have no
          Plane-local password)

    Stateless per request:
        Instances are created per OAuth callback; persisted state (OAuth
        tokens, account links) is written by
        :meth:`OauthAdapter.create_update_account` (base class) into the
        :class:`~plane.db.models.Account` model, not by this provider.
    """

    token_url = "https://oauth2.googleapis.com/token"
    userinfo_url = "https://www.googleapis.com/oauth2/v2/userinfo"
    scope = "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile"
    provider = "google"

    def __init__(self, request, code=None, state=None, callback=None):
        """Validate Google OAuth configuration and initialize the adapter.

        Reads ``GOOGLE_CLIENT_ID`` and ``GOOGLE_CLIENT_SECRET`` from
        instance config (falling back to environment), assembles the
        Google authorization URL with ``access_type=offline`` and
        ``prompt=consent`` (forcing refresh-token issuance + scope
        consent re-prompt), derives the request-scoped callback redirect
        URI, and hands off to :meth:`OauthAdapter.__init__` for the
        shared OAuth client wiring.

        Args:
            request: The inbound HTTP request; used to derive the
                redirect URI scheme (``https`` if :meth:`request.is_secure`
                else ``http``) and host.
            code: Authorization code returned by Google's consent screen
                during the callback phase (None during the initial
                authorization-URL build).
            state: Opaque CSRF token round-tripped through Google's
                consent screen and verified by the calling view.
            callback: Optional post-auth hook invoked from
                :meth:`Adapter.complete_login_or_signup`.

        Raises:
            AuthenticationException: With error code
                ``GOOGLE_NOT_CONFIGURED`` when ``GOOGLE_CLIENT_ID`` or
                ``GOOGLE_CLIENT_SECRET`` is missing from both instance
                config and environment.
        """
        (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) = get_configuration_value(
            [
                {
                    "key": "GOOGLE_CLIENT_ID",
                    "default": os.environ.get("GOOGLE_CLIENT_ID"),
                },
                {
                    "key": "GOOGLE_CLIENT_SECRET",
                    "default": os.environ.get("GOOGLE_CLIENT_SECRET"),
                },
            ]
        )

        if not (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET):
            raise AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["GOOGLE_NOT_CONFIGURED"],
                error_message="GOOGLE_NOT_CONFIGURED",
            )

        client_id = GOOGLE_CLIENT_ID
        client_secret = GOOGLE_CLIENT_SECRET

        redirect_uri = f"""{"https" if request.is_secure() else "http"}://{request.get_host()}/auth/google/callback/"""
        url_params = {
            "client_id": client_id,
            "scope": self.scope,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
        }
        auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(url_params)}"

        super().__init__(
            request,
            self.provider,
            client_id,
            self.scope,
            redirect_uri,
            auth_url,
            self.token_url,
            self.userinfo_url,
            client_secret,
            code,
            callback=callback,
        )

    def set_token_data(self):
        """Exchange the callback authorization code for Google OAuth tokens.

        POSTs the authorization code to Google's token endpoint with the
        ``authorization_code`` grant, then normalizes the response into
        the canonical Plane token shape (access/refresh tokens with
        timezone-aware UTC expiry timestamps and the optional ID token)
        before storing it via :meth:`OauthAdapter.set_token_data` (base
        class) so :meth:`OauthAdapter.create_update_account` can later
        upsert the :class:`~plane.db.models.Account` row.

        The ``datetime.fromtimestamp(..., tz=pytz.utc)`` calls
        intentionally produce timezone-aware UTC datetimes because the
        Account model persists these into PostgreSQL ``timestamptz``
        columns; naive datetimes would trigger a Django
        ``RuntimeWarning`` and could serialize incorrectly.
        """
        data = {
            "code": self.code,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "redirect_uri": self.redirect_uri,
            "grant_type": "authorization_code",
        }
        token_response = self.get_user_token(data=data)
        super().set_token_data(
            {
                "access_token": token_response.get("access_token"),
                "refresh_token": token_response.get("refresh_token", None),
                "access_token_expired_at": (
                    datetime.fromtimestamp(token_response.get("expires_in"), tz=pytz.utc)
                    if token_response.get("expires_in")
                    else None
                ),
                "refresh_token_expired_at": (
                    datetime.fromtimestamp(token_response.get("refresh_token_expired_at"), tz=pytz.utc)
                    if token_response.get("refresh_token_expired_at")
                    else None
                ),
                "id_token": token_response.get("id_token", ""),
            }
        )

    def set_user_data(self):
        """Fetch the Google userinfo profile and map it into Plane's user shape.

        Calls :meth:`OauthAdapter.get_user_response` (base class) to GET
        Google's userinfo endpoint with the stored access token, then
        maps the Google profile fields into Plane's normalized payload
        (``email``, ``user.avatar``, ``user.first_name``,
        ``user.last_name``, ``user.provider_id``,
        ``user.is_password_autoset=True``) and stores it via
        :meth:`OauthAdapter.set_user_data` for downstream consumption by
        :meth:`Adapter.complete_login_or_signup`.

        Field mapping:
            * ``email`` <- Google ``email``
            * ``avatar`` <- Google ``picture``
            * ``first_name`` <- Google ``given_name``
            * ``last_name`` <- Google ``family_name``
            * ``provider_id`` <- Google ``id``
        """
        user_info_response = self.get_user_response()
        user_data = {
            "email": user_info_response.get("email"),
            "user": {
                "avatar": user_info_response.get("picture"),
                "first_name": user_info_response.get("given_name"),
                "last_name": user_info_response.get("family_name"),
                "provider_id": user_info_response.get("id"),
                "is_password_autoset": True,
            },
        }
        super().set_user_data(user_data)
