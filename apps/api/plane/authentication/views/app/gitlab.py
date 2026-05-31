# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""GitLab OAuth endpoints for the Plane app authentication flow.

This module exposes the two endpoints that implement GitLab OAuth 2.0
Authorization Code flow on the app surface:

  * :class:`GitLabOauthInitiateEndpoint` -- ``GET /auth/gitlab/``
      Generates a fresh ``state`` (``uuid.uuid4().hex``), stores it in
      ``request.session["state"]``, stores the app host and any caller-
      supplied ``next_path`` in the session, and 302-redirects to GitLab's
      authorization URL produced by :class:`GitLabOAuthProvider`.

  * :class:`GitLabCallbackEndpoint` -- ``GET /auth/gitlab/callback/``
      Receives the ``code`` and ``state`` GitLab sends back, validates the
      returned ``state`` against the session-stored value (OAuth CSRF
      defense), exchanges the ``code`` for a Plane :class:`User` via
      :meth:`GitLabOAuthProvider.authenticate`, invokes
      :func:`post_user_auth_workflow`, logs the user in via
      :func:`user_login` (``is_app=True``), and 302-redirects to the
      stored ``next_path`` (or :func:`get_redirection_path` when absent).

OAuth state CSRF defense
------------------------

Per RFC 6749 section 10.12, the ``state`` parameter is the standard OAuth
CSRF defense -- server-side random generation at initiate, server-side
comparison at callback. A mismatch yields
``AUTHENTICATION_ERROR_CODES["GITLAB_OAUTH_PROVIDER_ERROR"]`` and a 302
back to the app host.

Open-redirect defense
---------------------

User-supplied ``next_path`` is round-tripped through the session and
validated at redirect time by :func:`get_safe_redirect_url`.

Error envelope contract
-----------------------

Every error path returns an HTTP 302 redirect to
``base_host(is_app=True) + "?" + urlencode(params)`` where ``params`` is
:meth:`AuthenticationException.get_error_dict`.
:data:`AUTHENTICATION_ERROR_CODES` keys raised:

  * ``INSTANCE_NOT_CONFIGURED``     -- deployment is not finished
  * ``GITLAB_OAUTH_PROVIDER_ERROR`` -- state mismatch, missing ``code``,
                                        or provider-side failure raised by
                                        :class:`GitLabOAuthProvider`

Architectural notes (per AAP section 0.2.2):

  * Session writes (``host``, ``next_path``, ``state``) and the session
    refresh on login land in the **PostgreSQL-backed Django session
    store** via the custom ``plane.db.models.session`` engine (see
    ``SESSION_ENGINE`` in ``apps/api/plane/settings/common.py``). Redis
    is used for caching and selected ephemeral auth data only -- it is
    NOT the Django session backend, and Plane does NOT use Redis as a
    task broker (Celery jobs route through RabbitMQ).
  * The migrator container has already run schema migrations by the time
    this module is imported.
  * No Celery / RabbitMQ enqueue from this module; provider integration
    is synchronous through :class:`GitLabOAuthProvider`.
"""

# Python imports
import uuid

# Django import
from django.http import HttpResponseRedirect
from django.views import View

# Module imports
from plane.authentication.provider.oauth.gitlab import GitLabOAuthProvider
from plane.authentication.utils.login import user_login
from plane.authentication.utils.redirection_path import get_redirection_path
from plane.authentication.utils.user_auth_workflow import post_user_auth_workflow
from plane.license.models import Instance
from plane.authentication.utils.host import base_host
from plane.authentication.adapter.error import (
    AuthenticationException,
    AUTHENTICATION_ERROR_CODES,
)
from plane.utils.path_validator import get_safe_redirect_url


class GitLabOauthInitiateEndpoint(View):
    """Begin the GitLab OAuth Authorization Code flow.

    HTTP method / URL:
        ``GET /auth/gitlab/``

    Inheritance:
        :class:`django.views.View` -- no ``permission_classes`` declared.
        Effectively anonymous-accessible because initiating OAuth must
        work pre-login.

    Query parameters:
        * ``next_path`` (str, optional) -- post-auth redirect target.
          Stored in ``request.session["next_path"]`` for the callback.

    Response:
        * HTTP 302 redirect to the GitLab authorization URL (success).
        * HTTP 302 redirect to ``base_host(is_app=True) + ?<params>`` on
          error.

    Side effects:
        * Sets ``request.session["host"] = base_host(is_app=True)``.
        * Sets ``request.session["next_path"]`` if ``next_path`` was given.
        * Sets ``request.session["state"] = uuid.uuid4().hex`` -- the
          fresh OAuth CSRF token.
        * Reads :class:`Instance.objects.first`.
        * Constructs :class:`GitLabOAuthProvider` and calls
          :meth:`GitLabOAuthProvider.get_auth_url`.

    Error codes:
        ``INSTANCE_NOT_CONFIGURED``, ``GITLAB_OAUTH_PROVIDER_ERROR``.
    """

    def get(self, request):
        """Stash session state, generate the OAuth ``state`` token, and redirect to GitLab."""
        # Get host and next path
        request.session["host"] = base_host(request=request, is_app=True)
        next_path = request.GET.get("next_path")
        if next_path:
            request.session["next_path"] = str(next_path)

        # Check instance configuration
        instance = Instance.objects.first()
        if instance is None or not instance.is_setup_done:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INSTANCE_NOT_CONFIGURED"],
                error_message="INSTANCE_NOT_CONFIGURED",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)
        try:
            state = uuid.uuid4().hex
            provider = GitLabOAuthProvider(request=request, state=state)
            request.session["state"] = state
            auth_url = provider.get_auth_url()
            return HttpResponseRedirect(auth_url)
        except AuthenticationException as e:
            params = e.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)


class GitLabCallbackEndpoint(View):
    """Validate the OAuth callback and complete GitLab sign-in.

    HTTP method / URL:
        ``GET /auth/gitlab/callback/``

    Inheritance:
        :class:`django.views.View` -- no ``permission_classes`` declared.
        Effectively anonymous-accessible because GitLab redirects the user
        here before they are authenticated in Plane.

    Query parameters (provided by GitLab's redirect):
        * ``code`` (str, required) -- OAuth authorization code; absent if
          the user denied consent.
        * ``state`` (str, required) -- OAuth state value; must match
          ``request.session["state"]``.

    Response:
        * HTTP 302 redirect to the stored ``next_path`` (or
          :func:`get_redirection_path`) on success.
        * HTTP 302 redirect to ``base_host(is_app=True) + ?<params>`` on
          error.

    Side effects:
        * Validates ``state`` against ``request.session.get("state", "")``;
          mismatch raises ``GITLAB_OAUTH_PROVIDER_ERROR``.
        * Validates presence of ``code``; missing raises
          ``GITLAB_OAUTH_PROVIDER_ERROR``.
        * Constructs :class:`GitLabOAuthProvider` with
          ``callback=post_user_auth_workflow`` and calls
          :meth:`GitLabOAuthProvider.authenticate` -- exchanges the code
          for a GitLab access token, loads/creates the Plane :class:`User`,
          and runs the post-auth workflow.
        * Calls :func:`user_login` (``is_app=True``) -- refreshes the
          PostgreSQL-backed Django session via the
          ``plane.db.models.session`` engine.
        * Reads ``request.session.get("next_path")`` for the redirect
          target.

    Error codes:
        ``GITLAB_OAUTH_PROVIDER_ERROR`` (covers state mismatch, missing
        code, and provider-side failure).
    """

    def get(self, request):
        """Validate the OAuth ``state``, exchange the ``code`` for a user, and refresh the session."""
        code = request.GET.get("code")
        state = request.GET.get("state")
        next_path = request.session.get("next_path")

        if state != request.session.get("state", ""):
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["GITLAB_OAUTH_PROVIDER_ERROR"],
                error_message="GITLAB_OAUTH_PROVIDER_ERROR",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)

        if not code:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["GITLAB_OAUTH_PROVIDER_ERROR"],
                error_message="GITLAB_OAUTH_PROVIDER_ERROR",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)

        try:
            provider = GitLabOAuthProvider(request=request, code=code, callback=post_user_auth_workflow)
            user = provider.authenticate()
            # Login the user and record his device info
            user_login(request=request, user=user, is_app=True)
            # Get the redirection path

            if next_path:
                path = next_path
            else:
                path = get_redirection_path(user=user)
            # redirect to referer path
            url = get_safe_redirect_url(base_url=base_host(request=request, is_app=True), next_path=path, params={})
            return HttpResponseRedirect(url)
        except AuthenticationException as e:
            params = e.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)
