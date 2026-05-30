# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""GitLab OAuth sign-in provider implementation for Plane authentication.

Concrete :class:`OauthAdapter` subclass that wires Plane's standard
authorization-code OAuth flow into GitLab's OAuth API. Supports both
GitLab.com (default ``GITLAB_HOST=https://gitlab.com``) and self-hosted
GitLab instances — the host is configurable so the same provider class
serves SaaS and on-prem GitLab deployments without code changes.

Provider lifecycle is driven by :class:`OauthAdapter`; this file supplies
the GitLab-specific endpoints (derived from ``GITLAB_HOST`` at runtime
rather than fixed at the class level), the ``read_user`` scope, the
GitLab-specific token-expiration computation
(``created_at + expires_in`` rather than just ``expires_in``), and the
profile-to-user field mappings.

Provider instances are stateless adapters instantiated per request;
token persistence into the :class:`~plane.db.models.Account` row is
handled by :meth:`OauthAdapter.set_user_data` (base class).
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
    AuthenticationException,
    AUTHENTICATION_ERROR_CODES,
)


class GitLabOAuthProvider(OauthAdapter):
    """GitLab OAuth authorization-code provider (SaaS or self-hosted).

    Wires Plane's :class:`OauthAdapter` against GitLab's OAuth API. The
    GitLab host is configurable so the same provider class serves both
    GitLab.com (the default) and self-hosted GitLab deployments. As a
    consequence, the token and userinfo URLs are instance attributes
    derived from ``GITLAB_HOST`` in :meth:`__init__` rather than class
    attributes (which is why this class declares fewer endpoint
    constants than its Google/GitHub siblings).

    Scope:
        * ``read_user`` — GitLab's single scope grants read access to
          the authenticated user profile including the email address,
          so unlike GitHub this provider does NOT need a separate
          ``/user/emails`` fallback.

    Dynamic endpoint construction (set in :meth:`__init__`):
        * ``self.host`` = configured ``GITLAB_HOST`` (default
          ``https://gitlab.com``)
        * ``self.token_url`` = ``f"{self.host}/oauth/token"``
        * ``self.userinfo_url`` = ``f"{self.host}/api/v4/user"``
        * authorization URL = ``f"{self.host}/oauth/authorize?..."``

    Redirect URI pattern:
        ``{scheme}://{host}/auth/gitlab/callback/`` where ``scheme`` is
        ``https`` when ``request.is_secure()`` is true, else ``http``.

    Configuration source:
        Reads ``GITLAB_CLIENT_ID``, ``GITLAB_CLIENT_SECRET``, and
        ``GITLAB_HOST`` via :func:`get_configuration_value`, with
        ``os.environ`` as the fallback. ``GITLAB_HOST`` defaults to
        ``https://gitlab.com`` when neither instance config nor
        environment supplies a value. Raises
        :exc:`AuthenticationException` with error code
        ``GITLAB_NOT_CONFIGURED`` when any of the three is missing or
        empty.

    GitLab-specific token expiration:
        :meth:`set_token_data` computes ``access_token_expired_at`` as
        ``datetime.fromtimestamp(created_at + expires_in, tz=pytz.utc)``
        because GitLab's token response carries an absolute
        ``created_at`` Unix timestamp AND a relative ``expires_in``
        offset — unlike Google/GitHub which return just ``expires_in``.

    User attributes extracted by :meth:`set_user_data`:
        * ``email`` ← GitLab ``email`` (always present with the
          ``read_user`` scope)
        * ``user.provider_id`` ← ``userinfo.id``
        * ``user.email`` ← same ``email``
        * ``user.avatar`` ← ``userinfo.avatar_url``
        * ``user.first_name`` ← ``userinfo.name`` (GitLab returns the
          full display name; first/last splitting is not done here)
        * ``user.last_name`` ← ``userinfo.family_name`` (same
          pre-existing limitation as GitHub: GitLab also does not
          return ``family_name``, so the value is always ``None``)
        * ``user.is_password_autoset`` ← ``True``

    Stateless per request:
        Instances are created per OAuth callback; persisted state is
        written by :meth:`OauthAdapter.set_user_data` (base class) into
        the :class:`~plane.db.models.Account` model.
    """

    provider = "gitlab"
    scope = "read_user"

    def __init__(self, request, code=None, state=None, callback=None):
        """Validate GitLab OAuth configuration, derive endpoints, and initialize.

        Reads ``GITLAB_CLIENT_ID`` / ``GITLAB_CLIENT_SECRET`` /
        ``GITLAB_HOST`` (with ``https://gitlab.com`` as the env-level
        default), derives the host-scoped token, userinfo, and
        authorization URLs, builds the request-scoped callback redirect
        URI, and hands off to :meth:`OauthAdapter.__init__` for the
        shared OAuth client wiring.

        Args:
            request: The inbound HTTP request; used to derive the
                redirect URI scheme and host.
            code: Authorization code returned by GitLab's consent
                screen during the callback phase (None during the
                initial authorization-URL build).
            state: Opaque CSRF token round-tripped through GitLab's
                consent screen and verified by the calling view.
            callback: Optional post-auth hook invoked from
                :meth:`Adapter.complete_login_or_signup`.

        Raises:
            AuthenticationException: With error code
                ``GITLAB_NOT_CONFIGURED`` when any of
                ``GITLAB_CLIENT_ID``, ``GITLAB_CLIENT_SECRET``, or
                ``GITLAB_HOST`` is missing or empty.
        """
        GITLAB_CLIENT_ID, GITLAB_CLIENT_SECRET, GITLAB_HOST = get_configuration_value(
            [
                {
                    "key": "GITLAB_CLIENT_ID",
                    "default": os.environ.get("GITLAB_CLIENT_ID"),
                },
                {
                    "key": "GITLAB_CLIENT_SECRET",
                    "default": os.environ.get("GITLAB_CLIENT_SECRET"),
                },
                {
                    "key": "GITLAB_HOST",
                    "default": os.environ.get("GITLAB_HOST", "https://gitlab.com"),
                },
            ]
        )

        self.host = GITLAB_HOST
        self.token_url = f"{self.host}/oauth/token"
        self.userinfo_url = f"{self.host}/api/v4/user"

        if not (GITLAB_CLIENT_ID and GITLAB_CLIENT_SECRET and GITLAB_HOST):
            raise AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["GITLAB_NOT_CONFIGURED"],
                error_message="GITLAB_NOT_CONFIGURED",
            )

        client_id = GITLAB_CLIENT_ID
        client_secret = GITLAB_CLIENT_SECRET

        redirect_uri = f"""{"https" if request.is_secure() else "http"}://{request.get_host()}/auth/gitlab/callback/"""
        url_params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": self.scope,
            "state": state,
        }
        auth_url = f"{self.host}/oauth/authorize?{urlencode(url_params)}"
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
        """Exchange the callback authorization code for GitLab OAuth tokens.

        POSTs the authorization code to GitLab's token endpoint with
        the ``Accept: application/json`` header. Computes the
        access-token expiration as
        ``datetime.fromtimestamp(created_at + expires_in, tz=pytz.utc)``
        because GitLab's token response carries an absolute
        ``created_at`` Unix timestamp together with a relative
        ``expires_in`` offset — a GitLab-specific shape that differs
        from Google/GitHub which return only ``expires_in``.

        Normalizes the response into the canonical Plane token shape
        (access/refresh tokens with timezone-aware UTC expiry
        timestamps and the optional ID token) before storing it via
        :meth:`OauthAdapter.set_token_data`.
        """
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": self.code,
            "redirect_uri": self.redirect_uri,
            "grant_type": "authorization_code",
        }
        token_response = self.get_user_token(data=data, headers={"Accept": "application/json"})
        super().set_token_data(
            {
                "access_token": token_response.get("access_token"),
                "refresh_token": token_response.get("refresh_token", None),
                "access_token_expired_at": (
                    datetime.fromtimestamp(
                        token_response.get("created_at") + token_response.get("expires_in"),
                        tz=pytz.utc,
                    )
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
        """Fetch the GitLab user profile and map it into Plane's user shape.

        Calls :meth:`OauthAdapter.get_user_response` to GET GitLab's
        ``/api/v4/user`` endpoint with the stored access token; the
        ``read_user`` scope guarantees the response includes the email
        address so no separate ``/emails`` fallback is needed (in
        contrast to GitHub and Gitea). Maps the GitLab profile fields
        into Plane's normalized payload and stores it via
        :meth:`OauthAdapter.set_user_data` for downstream consumption
        by :meth:`Adapter.complete_login_or_signup`.

        Field mapping:
            * ``email`` ← GitLab ``email``
            * ``provider_id`` ← GitLab ``id``
            * ``avatar`` ← GitLab ``avatar_url``
            * ``first_name`` ← GitLab ``name`` (full display name; no
              first/last split is performed)
            * ``last_name`` ← GitLab ``family_name`` (absent from
              GitLab's payload — always ``None``; pre-existing
              behavior, intentionally unchanged)
        """
        user_info_response = self.get_user_response()
        email = user_info_response.get("email")
        super().set_user_data(
            {
                "email": email,
                "user": {
                    "provider_id": user_info_response.get("id"),
                    "email": email,
                    "avatar": user_info_response.get("avatar_url"),
                    "first_name": user_info_response.get("name"),
                    "last_name": user_info_response.get("family_name"),
                    "is_password_autoset": True,
                },
            }
        )
