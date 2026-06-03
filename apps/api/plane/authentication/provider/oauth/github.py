# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""GitHub OAuth sign-in provider implementation for Plane authentication.

Concrete :class:`OauthAdapter` subclass that integrates Plane's standard
authorization-code OAuth flow with GitHub's OAuth API. Distinguished from
its sibling provider modules by **organization-membership enforcement**:
when ``GITHUB_ORGANIZATION_ID`` is configured, only users who are members
of that GitHub organization may complete sign-in.

The module also handles GitHub's idiosyncratic email behavior --
GitHub's ``/user`` endpoint does NOT include the email if the user has
set it to private, so this provider ALWAYS supplements the profile fetch
with a call to ``/user/emails`` to obtain the primary email.

Provider lifecycle is driven by :class:`OauthAdapter`; this file supplies
the GitHub-specific endpoints, scopes, organization-membership policy,
email-fallback logic, and field mappings. Instances are **stateless
adapters** instantiated per request -- token persistence into the
:class:`~plane.db.models.Account` row is handled by
:meth:`OauthAdapter.set_user_data` (base class), not here.
"""

# Python imports
import os
from datetime import datetime
from urllib.parse import urlencode

import pytz
import requests

from plane.authentication.adapter.error import (
    AUTHENTICATION_ERROR_CODES,
    AuthenticationException,
)

# Module imports
from plane.authentication.adapter.oauth import OauthAdapter
from plane.license.utils.instance_value import get_configuration_value


class GitHubOAuthProvider(OauthAdapter):
    """GitHub OAuth authorization-code provider with optional org-gating.

    Wires Plane's :class:`OauthAdapter` against GitHub's OAuth API,
    optionally constraining sign-in to a single GitHub organization.

    Endpoints:
        * ``token_url`` = ``https://github.com/login/oauth/access_token``
        * ``userinfo_url`` = ``https://api.github.com/user``
        * ``org_membership_url`` = ``https://api.github.com/orgs`` (base
          for per-user org-membership checks)

    Scopes:
        * Default: ``read:user user:email`` (profile + email access)
        * Conditional: when ``GITHUB_ORGANIZATION_ID`` is configured,
          ``read:org`` is appended so the runtime can verify org
          membership via :meth:`is_user_in_organization`.

    Authorization URL (assembled in :meth:`__init__`):
        ``https://github.com/login/oauth/authorize?...``

    Redirect URI pattern:
        ``{scheme}://{host}/auth/github/callback/`` where ``scheme`` is
        ``https`` when ``request.is_secure()`` is true, else ``http``.

    Configuration source:
        Reads ``GITHUB_CLIENT_ID``, ``GITHUB_CLIENT_SECRET``, and (optional)
        ``GITHUB_ORGANIZATION_ID`` via :func:`get_configuration_value`,
        with ``os.environ`` as the fallback. Raises
        :exc:`AuthenticationException` with error code
        ``GITHUB_NOT_CONFIGURED`` when client_id or client_secret is
        missing.

    Organization-membership enforcement (when GITHUB_ORGANIZATION_ID is set):
        * The ``read:org`` scope is appended at adapter init time.
        * :meth:`set_user_data` invokes :meth:`is_user_in_organization`
          BEFORE setting user data; non-members are rejected with
          ``GITHUB_USER_NOT_IN_ORG`` so the would-be user never receives
          a Plane session.

    Email handling:
        GitHub's ``/user`` endpoint may return ``email = null`` when the
        user has set their primary email to private. This provider
        ALWAYS calls :meth:`__get_email` against ``/user/emails`` to
        retrieve the user's **primary** email; missing primary, malformed
        response, or network errors all surface as
        ``GITHUB_OAUTH_PROVIDER_ERROR``.

    User attributes extracted by :meth:`set_user_data`:
        * ``email`` <- ``/user/emails`` primary email (NOT
          ``userinfo.email`` which may be null)
        * ``user.provider_id`` <- ``userinfo.id``
        * ``user.avatar`` <- ``userinfo.avatar_url``
        * ``user.first_name`` <- ``userinfo.name`` (GitHub does not
          return ``given_name``)
        * ``user.last_name`` <- ``userinfo.family_name`` (this field
          does NOT exist on GitHub's user payload, so the value is
          always ``None`` -- pre-existing behavior documented as-is
          per the no-behavior-changes constraint)
        * ``user.is_password_autoset`` <- ``True``

    Stateless per request:
        Instances are created per OAuth callback; persisted state (OAuth
        tokens, account links) is written by
        :meth:`OauthAdapter.set_user_data` (base class) into the
        :class:`~plane.db.models.Account` model, not by this provider.
    """

    token_url = "https://github.com/login/oauth/access_token"
    userinfo_url = "https://api.github.com/user"
    org_membership_url = "https://api.github.com/orgs"

    provider = "github"
    scope = "read:user user:email"

    organization_scope = "read:org"

    def __init__(self, request, code=None, state=None, callback=None):
        """Validate GitHub OAuth configuration and initialize the adapter.

        Reads ``GITHUB_CLIENT_ID`` / ``GITHUB_CLIENT_SECRET`` /
        ``GITHUB_ORGANIZATION_ID`` from instance config (env fallback),
        appends the ``read:org`` scope when org-gating is enabled, builds
        the GitHub authorization URL, derives the request-scoped callback
        redirect URI, and hands off to :meth:`OauthAdapter.__init__` for
        the shared OAuth client wiring.

        Args:
            request: The inbound HTTP request; used to derive the redirect
                URI scheme and host.
            code: Authorization code returned by GitHub's consent screen
                during the callback phase (None during the initial
                authorization-URL build).
            state: Opaque CSRF token round-tripped through GitHub's consent
                screen and verified by the calling view.
            callback: Optional post-auth hook invoked from
                :meth:`Adapter.complete_login_or_signup`.

        Raises:
            AuthenticationException: With error code ``GITHUB_NOT_CONFIGURED``
                when client_id or client_secret is missing from both
                instance config and environment.
        """
        GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_ORGANIZATION_ID = get_configuration_value([
            {
                "key": "GITHUB_CLIENT_ID",
                "default": os.environ.get("GITHUB_CLIENT_ID"),
            },
            {
                "key": "GITHUB_CLIENT_SECRET",
                "default": os.environ.get("GITHUB_CLIENT_SECRET"),
            },
            {
                "key": "GITHUB_ORGANIZATION_ID",
                "default": os.environ.get("GITHUB_ORGANIZATION_ID"),
            },
        ])

        if not (GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET):
            raise AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["GITHUB_NOT_CONFIGURED"],
                error_message="GITHUB_NOT_CONFIGURED",
            )

        client_id = GITHUB_CLIENT_ID
        client_secret = GITHUB_CLIENT_SECRET
        self.organization_id = GITHUB_ORGANIZATION_ID

        if self.organization_id:
            self.scope += f" {self.organization_scope}"

        redirect_uri = f"""{"https" if request.is_secure() else "http"}://{request.get_host()}/auth/github/callback/"""
        url_params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": self.scope,
            "state": state,
        }
        auth_url = f"https://github.com/login/oauth/authorize?{urlencode(url_params)}"
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
        """Exchange the callback authorization code for GitHub OAuth tokens.

        POSTs the authorization code to GitHub's token endpoint with the
        ``Accept: application/json`` header -- critical because
        GitHub's token endpoint otherwise defaults to a form-encoded
        response that would break the JSON parser in
        :meth:`OauthAdapter.get_user_token`. Normalizes the response into
        the canonical Plane token shape (access/refresh tokens with
        timezone-aware UTC expiry timestamps and the optional ID token)
        before storing it via :meth:`OauthAdapter.set_token_data`.

        The ``datetime.fromtimestamp(..., tz=pytz.utc)`` calls produce
        timezone-aware UTC datetimes; the Account model persists these
        into PostgreSQL ``timestamptz`` columns and would warn on naive
        datetimes.
        """
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": self.code,
            "redirect_uri": self.redirect_uri,
        }
        token_response = self.get_user_token(data=data, headers={"Accept": "application/json"})
        super().set_token_data({
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
        })

    def __get_email(self, headers):
        """Fetch the user's primary email from GitHub ``/user/emails``.

        GitHub's ``/user`` endpoint omits the email when the user has set
        their primary email to private, so this private helper is always
        called from :meth:`set_user_data` to retrieve the canonical email.
        Selects the entry where ``primary == True``.

        Args:
            headers: Request headers to forward to GitHub's API, including
                the ``Authorization: Bearer <access_token>`` token.

        Returns:
            str: The user's primary email.

        Raises:
            AuthenticationException: With error code
                ``GITHUB_OAUTH_PROVIDER_ERROR`` when:
                * GitHub's response is not a list (malformed/unauthorized)
                * No entry has ``primary == True``
                * The request raises :exc:`requests.RequestException`
                (network failure, timeout, DNS error)
        """
        try:
            # Github does not provide email in user response
            emails_url = "https://api.github.com/user/emails"
            emails_response = requests.get(emails_url, headers=headers).json()
            # Ensure the response is a list before iterating
            if not isinstance(emails_response, list):
                self.logger.error("Unexpected response format from GitHub emails API")
                raise AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["GITHUB_OAUTH_PROVIDER_ERROR"],
                    error_message="GITHUB_OAUTH_PROVIDER_ERROR",
                )
            email = next((email["email"] for email in emails_response if email["primary"]), None)
            if not email:
                self.logger.error("No primary email found for user")
                raise AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["GITHUB_OAUTH_PROVIDER_ERROR"],
                    error_message="GITHUB_OAUTH_PROVIDER_ERROR",
                )
            return email
        except requests.RequestException:
            self.logger.warning(
                "Error getting email from GitHub",
            )
            raise AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["GITHUB_OAUTH_PROVIDER_ERROR"],
                error_message="GITHUB_OAUTH_PROVIDER_ERROR",
            )

    def is_user_in_organization(self, github_username):
        """Return whether ``github_username`` is a member of the configured org.

        GETs ``{org_membership_url}/{organization_id}/memberships/{username}``
        with the user's access token; GitHub returns HTTP 200 when the user
        is a member and 404 otherwise. Used by :meth:`set_user_data` to
        gate sign-in when ``GITHUB_ORGANIZATION_ID`` is set.

        Args:
            github_username: GitHub login handle (``userinfo.login``).

        Returns:
            bool: ``True`` if GitHub returns HTTP 200 (member),
            ``False`` for any other status (non-member, missing, error).
        """
        headers = {"Authorization": f"Bearer {self.token_data.get('access_token')}"}
        response = requests.get(
            f"{self.org_membership_url}/{self.organization_id}/memberships/{github_username}",
            headers=headers,
        )
        return response.status_code == 200  # 200 means the user is a member

    def set_user_data(self):
        """Enforce org policy, fetch primary email, and map the GitHub profile.

        Drives the GitHub-specific user-data assembly:

        1. Fetches the GitHub user profile via
           :meth:`OauthAdapter.get_user_response`.
        2. When ``GITHUB_ORGANIZATION_ID`` is configured, calls
           :meth:`is_user_in_organization` on the user's login handle;
           non-members are rejected with ``GITHUB_USER_NOT_IN_ORG`` BEFORE
           any user-data is persisted.
        3. Calls :meth:`__get_email` to fetch the user's primary email
           (GitHub's ``/user`` endpoint does not always include it).
        4. Maps the profile fields into Plane's normalized user payload
           and stores it via :meth:`OauthAdapter.set_user_data` for
           :meth:`Adapter.complete_login_or_signup` to consume.

        Field mapping:
            * ``email`` <- ``/user/emails`` primary
            * ``provider_id`` <- GitHub ``id``
            * ``avatar`` <- GitHub ``avatar_url``
            * ``first_name`` <- GitHub ``name``
            * ``last_name`` <- GitHub ``family_name`` (absent from
              GitHub's payload -- always ``None``; pre-existing
              behavior, intentionally unchanged)

        Raises:
            AuthenticationException: With error code
                ``GITHUB_USER_NOT_IN_ORG`` when org-gating is enabled and
                the user is not a member; or with
                ``GITHUB_OAUTH_PROVIDER_ERROR`` propagated from
                :meth:`__get_email`.
        """
        user_info_response = self.get_user_response()
        headers = {
            "Authorization": f"Bearer {self.token_data.get('access_token')}",
            "Accept": "application/json",
        }

        if self.organization_id:
            if not self.is_user_in_organization(user_info_response.get("login")):
                self.logger.warning(
                    "User is not in organization",
                    extra={
                        "organization_id": self.organization_id,
                        "user_login": user_info_response.get("login"),
                    },
                )
                raise AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["GITHUB_USER_NOT_IN_ORG"],
                    error_message="GITHUB_USER_NOT_IN_ORG",
                )

        email = self.__get_email(headers=headers)
        self.logger.debug(
            "Email found",
            extra={
                "email": email,
            },
        )
        super().set_user_data({
            "email": email,
            "user": {
                "provider_id": user_info_response.get("id"),
                "email": email,
                "avatar": user_info_response.get("avatar_url"),
                "first_name": user_info_response.get("name"),
                "last_name": user_info_response.get("family_name"),
                "is_password_autoset": True,
            },
        })
