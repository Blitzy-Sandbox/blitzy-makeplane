# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Concrete OAuth adapter for third-party authentication providers.

Hosts :class:`OauthAdapter`, the shared
:class:`~plane.authentication.adapter.base.Adapter` subclass that
implements the OAuth 2.0 authorization-code lifecycle used by Plane's
external sign-in integrations (Google, GitHub, GitLab, Gitea). The
class stores per-instance OAuth client configuration (authorization,
token, and user-info endpoints; scopes; redirect URI; optional client
secret; authorization code) and exposes a generic token-exchange,
user-info-fetch, and account-persistence flow that concrete provider
subclasses can drive without re-implementing the boilerplate.

Subclass contract: concrete providers in
:mod:`plane.authentication.provider.oauth` (``google``, ``github``,
``gitlab``, ``gitea``) set the provider-specific endpoints and scopes,
override :meth:`OauthAdapter.set_token_data` to perform the token
exchange with the provider's specific request shape, and override
:meth:`OauthAdapter.set_user_data` to normalize the provider's
user-profile response into Plane's user payload format. This module's
class then drives :meth:`OauthAdapter.authenticate` end-to-end.

Account persistence: on successful authentication,
:meth:`OauthAdapter.create_update_account` upserts a row in
:class:`~plane.db.models.Account` carrying the access token, refresh
token, expiry timestamps, last-connected time, and ID token. Persisting
these enables silent re-auth and lets the ``Account`` row serve as the
canonical OAuth identity binding for the user. Failures during the DB
write are intentionally swallowed (logged via :func:`log_exception`) so
an OAuth login is never rejected purely because the bookkeeping write
failed.

Architectural notes (per AAP section 0.2.2):

* Pure adapter logic - no Celery/RabbitMQ handoffs live here; any
  asynchronous work (such as activation email delivery) is dispatched
  from the base class' ``save_user_data`` via Celery tasks defined
  elsewhere.
* Assumes the migrator-startup contract: the ``Account`` table schema
  is at the target revision before any authentication ever runs.
"""

# Python imports
import requests
from django.db import DatabaseError, IntegrityError

# Django imports
from django.utils import timezone

from plane.authentication.adapter.error import (
    AUTHENTICATION_ERROR_CODES,
    AuthenticationException,
)

# Module imports
from plane.db.models import Account
from plane.utils.exception_logger import log_exception

from .base import Adapter


class OauthAdapter(Adapter):
    """OAuth-flow adapter that authenticates against third-party providers.

    Extends :class:`Adapter` with the shared OAuth 2.0 authorization-code
    lifecycle: subclasses configure the provider-specific endpoints,
    scopes, and parsing logic; this class drives the cross-provider
    boilerplate of token exchange, user-info fetch, and account
    persistence.

    Per-instance OAuth client configuration (set via :meth:`__init__`):

    * ``client_id`` / ``client_secret`` -- provider-issued OAuth client
      credentials; ``client_secret`` is optional to support PKCE-style
      flows.
    * ``scope`` -- provider-specific permissions string requested at
      authorization time.
    * ``redirect_uri`` -- the callback URL registered with the provider.
    * ``auth_url`` / ``token_url`` / ``userinfo_url`` -- provider
      endpoints.
    * ``code`` -- the authorization code returned by the provider's
      consent screen, to be exchanged for tokens by
      :meth:`get_user_token`.
    * ``callback`` -- optional post-auth hook (inherited from
      :class:`Adapter`).

    The runtime path is :meth:`authenticate` -> :meth:`set_token_data`
    (subclass; performs token exchange via :func:`requests.post` and
    populates ``self.token_data``) -> :meth:`set_user_data` (subclass;
    performs user-info fetch via :func:`requests.get` with a Bearer
    token and populates ``self.user_data``) ->
    :meth:`~Adapter.complete_login_or_signup` (shared base
    orchestration), which in turn invokes
    :meth:`create_update_account` to persist the per-provider
    :class:`~plane.db.models.Account` binding.
    """

    def __init__(
        self,
        request,
        provider,
        client_id,
        scope,
        redirect_uri,
        auth_url,
        token_url,
        userinfo_url,
        client_secret=None,
        code=None,
        callback=None,
    ):
        """Initialize the OAuth adapter with provider-specific client configuration.

        Args:
            request: The inbound HTTP request carrying the OAuth
                callback; used for client-IP/user-agent capture in
                :meth:`Adapter.save_user_data`.
            provider: Short provider identifier (e.g. ``"google"``,
                ``"github"``, ``"gitlab"``, ``"gitea"``); stamped onto
                :attr:`User.last_login_medium` and used by
                :meth:`authentication_error_code` to resolve the
                matching ``*_OAUTH_PROVIDER_ERROR`` code.
            client_id: Provider-issued OAuth client identifier.
            scope: Space-separated permissions string requested at
                authorization time.
            redirect_uri: Callback URL registered with the provider;
                must match the provider's app configuration verbatim.
            auth_url: Provider's authorization-screen endpoint.
            token_url: Provider's token-exchange endpoint.
            userinfo_url: Provider's user-info endpoint (fetched with
                the Bearer access token in :meth:`get_user_response`).
            client_secret: Provider-issued OAuth client secret. Optional
                to permit PKCE-style flows.
            code: Authorization code returned by the provider's consent
                screen; passed by the subclass to :meth:`get_user_token`
                during token exchange.
            callback: Optional callable invoked from
                :meth:`Adapter.complete_login_or_signup` with
                ``(user, is_signup, request)`` after a successful login.
        """
        super().__init__(request=request, provider=provider, callback=callback)
        self.client_id = client_id
        self.scope = scope
        self.redirect_uri = redirect_uri
        self.auth_url = auth_url
        self.token_url = token_url
        self.userinfo_url = userinfo_url
        self.client_secret = client_secret
        self.code = code

    def authentication_error_code(self):
        """Resolve the provider-specific OAuth error code key.

        Returns the string key into :data:`AUTHENTICATION_ERROR_CODES`
        that corresponds to ``self.provider``. Falls back to
        ``"OAUTH_NOT_CONFIGURED"`` for unknown providers so the error
        envelope still carries a stable code rather than a generic 500.

        Returns:
            str: One of ``"GOOGLE_OAUTH_PROVIDER_ERROR"``,
            ``"GITHUB_OAUTH_PROVIDER_ERROR"``,
            ``"GITLAB_OAUTH_PROVIDER_ERROR"``,
            ``"GITEA_OAUTH_PROVIDER_ERROR"``, or
            ``"OAUTH_NOT_CONFIGURED"``.
        """
        if self.provider == "google":
            return "GOOGLE_OAUTH_PROVIDER_ERROR"
        elif self.provider == "github":
            return "GITHUB_OAUTH_PROVIDER_ERROR"
        elif self.provider == "gitlab":
            return "GITLAB_OAUTH_PROVIDER_ERROR"
        elif self.provider == "gitea":
            return "GITEA_OAUTH_PROVIDER_ERROR"
        else:
            return "OAUTH_NOT_CONFIGURED"

    def get_auth_url(self):
        """Return the provider's authorization-screen endpoint URL."""
        return self.auth_url

    def get_token_url(self):
        """Return the provider's token-exchange endpoint URL."""
        return self.token_url

    def get_user_info_url(self):
        """Return the provider's user-info endpoint URL."""
        return self.userinfo_url

    def authenticate(self):
        """Run the full OAuth authentication lifecycle and return the user.

        Drives the three-phase OAuth flow:

        1. :meth:`set_token_data` (subclass): exchanges ``self.code`` for
           an access/refresh token pair via :meth:`get_user_token` and
           populates ``self.token_data``.
        2. :meth:`set_user_data` (subclass): fetches the user-info
           payload via :meth:`get_user_response` and normalizes it into
           Plane's user shape in ``self.user_data``.
        3. :meth:`~Adapter.complete_login_or_signup` (shared base):
           validates the payload, creates or fetches the matching
           :class:`User`, optionally syncs profile data from the
           provider, persists login metadata, calls
           :meth:`create_update_account` to upsert the :class:`Account`
           row, and runs the optional ``callback``.

        Returns:
            plane.db.models.User: The authenticated user ready for
            :func:`django.contrib.auth.login`.
        """
        self.set_token_data()
        self.set_user_data()
        return self.complete_login_or_signup()

    def get_user_token(self, data, headers=None):
        """Exchange an authorization code for OAuth tokens.

        POSTs ``data`` to the provider's :meth:`get_token_url` and
        returns the parsed JSON token response (access token, refresh
        token, expiries, optional id_token). Used by concrete subclasses
        inside their :meth:`set_token_data` implementation.

        Args:
            data: The form/JSON payload sent to the token endpoint
                (typically client_id, client_secret, code, redirect_uri,
                grant_type).
            headers: Optional request headers (e.g. ``Accept``).

        Returns:
            dict: The provider's token response JSON.

        Raises:
            AuthenticationException: When the HTTP token-exchange
                request fails (network error, non-2xx response); the
                error envelope carries the provider-specific code
                resolved by :meth:`authentication_error_code`.
        """
        try:
            headers = headers or {}
            response = requests.post(self.get_token_url(), data=data, headers=headers)
            response.raise_for_status()
            return response.json()
        except requests.RequestException:
            self.logger.warning("Error getting user token")
            code = self.authentication_error_code()
            raise AuthenticationException(error_code=AUTHENTICATION_ERROR_CODES[code], error_message=str(code))

    def get_user_response(self):
        """Fetch the provider's user-info payload using the stored access token.

        GETs :meth:`get_user_info_url` with the Bearer access token from
        ``self.token_data`` and returns the parsed JSON profile payload.
        Used by concrete subclasses inside their :meth:`set_user_data`
        implementation to read the raw provider profile before
        normalizing it into Plane's user shape.

        Returns:
            dict: The provider's user-info JSON response.

        Raises:
            AuthenticationException: When the HTTP user-info fetch fails
                (network error, non-2xx response); the error envelope
                carries the provider-specific code resolved by
                :meth:`authentication_error_code`.
        """
        try:
            headers = {"Authorization": f"Bearer {self.token_data.get('access_token')}"}
            response = requests.get(self.get_user_info_url(), headers=headers)
            response.raise_for_status()
            return response.json()
        except requests.RequestException:
            self.logger.warning(
                "Error getting user response",
                extra={
                    "headers": headers,
                },
            )
            code = self.authentication_error_code()
            raise AuthenticationException(error_code=AUTHENTICATION_ERROR_CODES[code], error_message=str(code))

    def set_user_data(self, data):
        """Store the normalized user-data payload on the adapter instance.

        Overrides :meth:`Adapter.set_user_data` with the same body;
        concrete OAuth provider subclasses override this further to
        drive :meth:`get_user_response`, normalize the provider profile,
        and call ``super().set_user_data(payload)`` with Plane's user
        shape.

        Args:
            data: Normalized user-data dict; ultimately consumed by
                :meth:`Adapter.complete_login_or_signup`.
        """
        self.user_data = data

    def create_update_account(self, user):
        """Upsert the user's :class:`Account` row for this OAuth provider.

        Persists the per-provider OAuth identity binding so silent
        re-auth and token-refresh flows downstream can recover the
        access/refresh token pair without re-running the consent screen.

        Lookup is by ``(user, provider, provider_account_id)`` triple.
        On a match, updates ``access_token``, ``refresh_token``,
        ``access_token_expired_at``, ``refresh_token_expired_at``,
        ``last_connected_at`` (set to ``timezone.now()``), and
        ``id_token``. On a miss, creates a new ``Account`` row with the
        same fields.

        The DB write is defensively wrapped in a ``try/except`` for
        :exc:`DatabaseError` and :exc:`IntegrityError`; failures are
        logged via :func:`log_exception` and swallowed so that an OAuth
        login is never rejected purely because the bookkeeping row could
        not be persisted (the user is already authenticated at the point
        this is called from :meth:`Adapter.complete_login_or_signup`).

        Args:
            user: The :class:`User` whose :class:`Account` row should be
                created or updated.
        """
        try:
            # Check if the account already exists
            account = Account.objects.filter(
                user=user,
                provider=self.provider,
                provider_account_id=self.user_data.get("user").get("provider_id"),
            ).first()
            # Update the account if it exists
            if account:
                account.access_token = self.token_data.get("access_token")
                account.refresh_token = self.token_data.get("refresh_token", None)
                account.access_token_expired_at = self.token_data.get("access_token_expired_at")
                account.refresh_token_expired_at = self.token_data.get("refresh_token_expired_at")
                account.last_connected_at = timezone.now()
                account.id_token = self.token_data.get("id_token", "")
                account.save()
            # Create a new account if it does not exist
            else:
                Account.objects.create(
                    user=user,
                    provider=self.provider,
                    provider_account_id=self.user_data.get("user", {}).get("provider_id"),
                    access_token=self.token_data.get("access_token"),
                    refresh_token=self.token_data.get("refresh_token", None),
                    access_token_expired_at=self.token_data.get("access_token_expired_at"),
                    refresh_token_expired_at=self.token_data.get("refresh_token_expired_at"),
                    last_connected_at=timezone.now(),
                    id_token=self.token_data.get("id_token", ""),
                )
        except (DatabaseError, IntegrityError) as e:
            log_exception(e)
