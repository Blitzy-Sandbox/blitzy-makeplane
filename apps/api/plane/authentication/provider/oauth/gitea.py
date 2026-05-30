# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Gitea OAuth sign-in provider implementation for Plane authentication.

Concrete :class:`OauthAdapter` subclass that integrates Plane's standard
authorization-code OAuth flow with Gitea's OAuth API. Gitea is a
**fully self-hosted Git service** -- unlike GitLab (which defaults
to ``https://gitlab.com``), Gitea has no public default; the host MUST
be configured via ``GITEA_HOST``.

The constructor explicitly **validates the HOST scheme** (must be
``http`` or ``https``) and strips trailing slashes; non-HTTP schemes and
unset hosts are rejected with ``GITEA_NOT_CONFIGURED`` (the same error
code used for missing credentials) to prevent SSRF-style
misconfiguration. The shared error code also avoids leaking
configuration details into the OAuth callback's query string.

Provider lifecycle is driven by :class:`OauthAdapter`; this file
supplies the Gitea-specific host validation, dynamic host-based
endpoint construction, OpenID-Connect-style scopes, 4-tier email
selection heuristic for the ``/emails`` fallback, and profile-to-user
field mappings.

Provider instances are **stateless adapters** instantiated per request;
token persistence into the :class:`~plane.db.models.Account` row is
handled by :meth:`OauthAdapter.set_user_data` (base class).
"""

import os
from datetime import datetime, timedelta
from urllib.parse import urlencode, urlparse
import pytz
import requests

# Module imports
from plane.authentication.adapter.oauth import OauthAdapter
from plane.license.utils.instance_value import get_configuration_value
from plane.authentication.adapter.error import (
    AUTHENTICATION_ERROR_CODES,
    AuthenticationException,
)


class GiteaOAuthProvider(OauthAdapter):
    """Gitea OAuth authorization-code provider (self-hosted only).

    Wires Plane's :class:`OauthAdapter` against Gitea's OAuth API. Unlike
    Google/GitHub (cloud SaaS endpoints) or GitLab (cloud-or-self-hosted
    with a public default), Gitea is **only** self-hosted, so this
    provider requires an explicit ``GITEA_HOST`` and validates the URL
    scheme up front to prevent SSRF-style misconfiguration.

    Scope:
        * ``openid email profile`` -- OpenID-Connect-style scope set
          requesting identity + email + profile claims.

    Dynamic endpoint construction (set in :meth:`__init__`):
        * ``self.token_url`` = ``f"{GITEA_HOST}/login/oauth/access_token"``
        * ``self.userinfo_url`` = ``f"{GITEA_HOST}/api/v1/user"``
        * authorization URL =
          ``f"{GITEA_HOST}/login/oauth/authorize?..."``

    Redirect URI pattern:
        ``{scheme}://{host}/auth/gitea/callback/`` where ``scheme`` is
        ``https`` when ``request.is_secure()`` is true, else ``http``.

    Configuration source (per AAP section 0.2.2):
        Reads ``GITEA_CLIENT_ID``, ``GITEA_CLIENT_SECRET``, and
        ``GITEA_HOST`` via :func:`get_configuration_value`, with
        ``os.environ`` as the fallback. **All three** must be present
        AND ``GITEA_HOST`` must have a valid ``http``/``https`` scheme.
        Raises :exc:`AuthenticationException` with error code
        ``GITEA_NOT_CONFIGURED`` for BOTH missing-config AND
        invalid-scheme cases -- the same code is intentionally
        reused (per the in-file comment "avoid leaking details to query
        params") so that the OAuth callback's query string does not
        disclose whether the failure was a missing credential or an
        unsafe host.

    Gitea-specific token expiration:
        :meth:`set_token_data` computes ``access_token_expired_at`` as
        ``datetime.now(tz=pytz.utc) + timedelta(seconds=expires_in)``.
        Gitea returns only ``expires_in`` (no absolute ``created_at``),
        so the absolute expiry is computed relative to "now" rather
        than the server's clock. This is slightly less accurate than
        GitLab's ``created_at + expires_in`` approach (due to clock
        skew between the API and the Plane backend) but matches the
        pre-existing implementation and is the only option given
        Gitea's response shape.

    Email fallback and selection heuristics:
        Gitea's ``/api/v1/user`` may not include the email depending on
        user privacy settings; this provider falls back to
        ``/api/v1/user/emails`` (:meth:`__get_email`) and selects an
        address using a 4-tier priority:
            1. Primary AND verified
            2. Any verified (even if not primary)
            3. Primary (even if not verified)
            4. First email in the list (last-resort)
        ``GITEA_OAUTH_PROVIDER_ERROR`` is raised on HTTP failure, empty
        list, or :exc:`requests.RequestException`.

    User attributes extracted by :meth:`set_user_data`:
        * ``email`` <- ``userinfo.email`` if present, else
          :meth:`__get_email` result
        * ``user.provider_id`` <- ``str(userinfo.id)`` (note the
          explicit string cast: Gitea returns an integer ID, but
          Plane's ``Account.provider_id`` is a string column)
        * ``user.email`` <- same ``email``
        * ``user.avatar`` <- ``userinfo.avatar_url``
        * ``user.first_name`` <- ``userinfo.full_name`` OR
          ``userinfo.login`` (login is the fallback when full_name is
          empty)
        * ``user.last_name`` <- ``""`` (hard-coded empty string;
          Gitea does not expose a separate last-name field, so the
          local value is intentionally left blank rather than guessed
          from ``full_name``)
        * ``user.is_password_autoset`` <- ``True``

    Stateless per request:
        Instances are created per OAuth callback; persisted state is
        written by :meth:`OauthAdapter.set_user_data` (base class) into
        the :class:`~plane.db.models.Account` model.
    """

    provider = "gitea"
    scope = "openid email profile"

    def __init__(self, request, code=None, state=None, callback=None):
        """Validate Gitea OAuth configuration and HOST scheme; initialize.

        Reads ``GITEA_CLIENT_ID`` / ``GITEA_CLIENT_SECRET`` /
        ``GITEA_HOST``, validates the ``GITEA_HOST`` URL scheme is
        ``http`` or ``https`` (rejecting anything else -- including
        unset hosts and exotic schemes like ``file://`` or
        ``gopher://`` -- to prevent SSRF-style misconfiguration),
        normalizes the host by stripping trailing slashes, derives the
        host-scoped token, userinfo, and authorization URLs, builds the
        request-scoped callback redirect URI, and hands off to
        :meth:`OauthAdapter.__init__` for shared OAuth client wiring.

        Args:
            request: The inbound HTTP request; used to derive the
                redirect URI scheme and host.
            code: Authorization code returned by Gitea's consent screen
                during the callback phase (None during the initial
                authorization-URL build).
            state: Opaque CSRF token round-tripped through Gitea's
                consent screen and verified by the calling view.
            callback: Optional post-auth hook invoked from
                :meth:`Adapter.complete_login_or_signup`.

        Raises:
            AuthenticationException: With error code
                ``GITEA_NOT_CONFIGURED`` when any of
                ``GITEA_CLIENT_ID``, ``GITEA_CLIENT_SECRET``, or
                ``GITEA_HOST`` is missing/empty, OR when ``GITEA_HOST``
                uses a non-``http``/``https`` scheme. The same code is
                intentionally reused for both failures to avoid leaking
                configuration details through the callback query
                string.
        """
        (GITEA_CLIENT_ID, GITEA_CLIENT_SECRET, GITEA_HOST) = get_configuration_value(
            [
                {
                    "key": "GITEA_CLIENT_ID",
                    "default": os.environ.get("GITEA_CLIENT_ID"),
                },
                {
                    "key": "GITEA_CLIENT_SECRET",
                    "default": os.environ.get("GITEA_CLIENT_SECRET"),
                },
                {
                    "key": "GITEA_HOST",
                    "default": os.environ.get("GITEA_HOST"),
                },
            ]
        )

        if not (GITEA_CLIENT_ID and GITEA_CLIENT_SECRET and GITEA_HOST):
            raise AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["GITEA_NOT_CONFIGURED"],
                error_message="GITEA_NOT_CONFIGURED",
            )

        # Enforce scheme and normalize trailing slash(es)
        parsed = urlparse(GITEA_HOST)
        if not parsed.scheme or parsed.scheme not in ("https", "http"):
            raise AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["GITEA_NOT_CONFIGURED"],
                error_message="GITEA_NOT_CONFIGURED",  # avoid leaking details to query params
            )
        GITEA_HOST = GITEA_HOST.rstrip("/")

        # Set URLs based on the host
        self.token_url = f"{GITEA_HOST}/login/oauth/access_token"
        self.userinfo_url = f"{GITEA_HOST}/api/v1/user"

        client_id = GITEA_CLIENT_ID
        client_secret = GITEA_CLIENT_SECRET

        redirect_uri = f"{'https' if request.is_secure() else 'http'}://{request.get_host()}/auth/gitea/callback/"
        url_params = {
            "client_id": client_id,
            "scope": self.scope,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "state": state,
        }
        auth_url = f"{GITEA_HOST}/login/oauth/authorize?{urlencode(url_params)}"

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
        """Exchange the callback authorization code for Gitea OAuth tokens.

        POSTs the authorization code to Gitea's token endpoint with the
        ``Accept: application/json`` header. Computes the access-token
        expiration as ``datetime.now(tz=pytz.utc) +
        timedelta(seconds=expires_in)`` because Gitea returns only the
        relative ``expires_in`` offset and no absolute ``created_at``
        timestamp -- unlike GitLab. This approach is slightly less
        accurate than ``created_at + expires_in`` (due to clock skew
        between the Gitea API and the Plane backend) but is the only
        option given Gitea's response shape.

        Normalizes the response into the canonical Plane token shape
        (access/refresh tokens with timezone-aware UTC expiry
        timestamps and the optional ID token) before storing it via
        :meth:`OauthAdapter.set_token_data`.
        """
        data = {
            "code": self.code,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "redirect_uri": self.redirect_uri,
            "grant_type": "authorization_code",
        }
        headers = {"Accept": "application/json"}
        token_response = self.get_user_token(data=data, headers=headers)
        super().set_token_data(
            {
                "access_token": token_response.get("access_token"),
                "refresh_token": token_response.get("refresh_token", None),
                "access_token_expired_at": (
                    datetime.now(tz=pytz.utc) + timedelta(seconds=token_response.get("expires_in"))
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

    def __get_email(self, headers):
        """Fetch the user's email from Gitea's ``/api/v1/user/emails`` endpoint.

        Called from :meth:`set_user_data` when the user-info response
        does not include ``email`` (Gitea may omit the email depending
        on the user's privacy settings). Applies a 4-tier selection
        priority to the returned email list:

        1. Primary AND verified
        2. Any verified (even if not primary)
        3. Primary (even if not verified)
        4. First email in the list (last-resort)

        Args:
            headers: Request headers to forward to Gitea, including the
                ``Authorization: Bearer <access_token>`` token.

        Returns:
            str | None: The selected email address.

        Raises:
            AuthenticationException: With error code
                ``GITEA_OAUTH_PROVIDER_ERROR`` when:

                * The HTTP request returns a non-``ok`` response
                * The response list is empty
                * The request raises
                  :exc:`requests.RequestException` (network failure,
                  timeout, DNS error)
        """
        try:
            # Gitea may not provide email in user response, so fetch it separately
            emails_url = f"{self.userinfo_url}/emails"
            response = requests.get(emails_url, headers=headers)
            if not response.ok:
                raise AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["GITEA_OAUTH_PROVIDER_ERROR"],
                    error_message="GITEA_OAUTH_PROVIDER_ERROR: Failed to fetch emails",
                )
            emails_response = response.json()

            if not emails_response:
                raise AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["GITEA_OAUTH_PROVIDER_ERROR"],
                    error_message="GITEA_OAUTH_PROVIDER_ERROR: No emails found",
                )
            # Prefer primary+verified, then any verified, then primary, else first
            email = next((e.get("email") for e in emails_response if e.get("primary") and e.get("verified")), None)
            if not email:
                email = next((e.get("email") for e in emails_response if e.get("verified")), None)
            if not email:
                email = next((e.get("email") for e in emails_response if e.get("primary")), None)
            if not email and emails_response:
                # If no primary email, use the first one
                email = emails_response[0].get("email")
            return email
        except requests.RequestException:
            raise AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["GITEA_OAUTH_PROVIDER_ERROR"],
                error_message="GITEA_OAUTH_PROVIDER_ERROR: Exception occurred while fetching emails",
            )

    def set_user_data(self):
        """Fetch the Gitea user profile, resolve the email, and map it.

        Drives the Gitea-specific user-data assembly:

        1. Fetches the Gitea user profile via
           :meth:`OauthAdapter.get_user_response`.
        2. Reads ``email`` from the userinfo response; when absent
           (Gitea may omit it based on privacy settings), falls back to
           :meth:`__get_email` against ``/api/v1/user/emails``.
        3. Maps the profile fields into Plane's normalized user payload
           and stores it via :meth:`OauthAdapter.set_user_data` for
           :meth:`Adapter.complete_login_or_signup`.

        Field mapping:
            * ``email`` <- Gitea ``email`` (fallback to
              :meth:`__get_email`)
            * ``provider_id`` <- ``str(userinfo.id)`` (Gitea's ID is
              an integer; cast to string to match Plane's
              ``Account.provider_id`` column type)
            * ``avatar`` <- Gitea ``avatar_url``
            * ``first_name`` <- ``userinfo.full_name`` OR
              ``userinfo.login`` (login fallback when full_name is
              empty)
            * ``last_name`` <- ``""`` (Gitea does not provide a
              separate last-name field; intentionally left blank
              rather than attempting to split ``full_name``)
            * ``is_password_autoset`` <- ``True``
        """
        user_info_response = self.get_user_response()
        headers = {
            "Authorization": f"Bearer {self.token_data.get('access_token')}",
            "Accept": "application/json",
        }

        # Get email if not provided in user info
        email = user_info_response.get("email")
        if not email:
            email = self.__get_email(headers=headers)

        super().set_user_data(
            {
                "email": email,
                "user": {
                    "provider_id": str(user_info_response.get("id")),
                    "email": email,
                    "avatar": user_info_response.get("avatar_url"),
                    "first_name": user_info_response.get("full_name") or user_info_response.get("login"),
                    "last_name": "",  # Gitea doesn't provide separate first/last name
                    "is_password_autoset": True,
                },
            }
        )
