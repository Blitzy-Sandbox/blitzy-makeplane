# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Gitea OAuth endpoints for the Plane app authentication flow.

This module exposes the two endpoints that implement Gitea OAuth 2.0
Authorization Code flow on the app surface:

  * :class:`GiteaOauthInitiateEndpoint` -- ``GET /auth/gitea/``
      Generates a fresh ``state`` (``uuid.uuid4().hex``), stores it in
      ``request.session["state"]``, stores the app host and the
      :func:`validate_next_path`-cleaned ``next_path`` in the session, and
      302-redirects to Gitea's authorization URL produced by
      :class:`GiteaOAuthProvider`.

  * :class:`GiteaCallbackEndpoint` -- ``GET /auth/gitea/callback/``
      Receives the ``code`` and ``state`` Gitea sends back, validates the
      returned ``state`` against the session-stored value (OAuth CSRF
      defense), exchanges the ``code`` for a Plane :class:`User` via
      :meth:`GiteaOAuthProvider.authenticate`, invokes
      :func:`post_user_auth_workflow`, logs the user in via
      :func:`user_login` (``is_app=True``), and 302-redirects to the
      stored ``next_path`` (or :func:`get_redirection_path` when absent).

Divergent redirect construction
-------------------------------

Unlike the Google/GitHub/GitLab modules in this folder (which build
redirects through :func:`get_safe_redirect_url`), this module constructs
redirects via raw ``urljoin(base_host, "?" + urlencode(params))``. The
``next_path`` query parameter is validated **directly** via
:func:`validate_next_path` (from :mod:`plane.utils.path_validator`) at
every point where it is embedded into a URL. This is the same
open-redirect defense surface as the other modules, just expressed as a
direct call rather than wrapped in :func:`get_safe_redirect_url`.

Additionally, :meth:`GiteaCallbackEndpoint.get` reads the host from the
session (``base_host = request.session.get("host")``) -- this
**locally shadows** the imported :func:`base_host` function for the
remainder of that method body. The intent is to pin the callback's
redirect to the SAME host the initiate handler used (preventing cross-
host drift if the request's ``Host`` header changed between initiate and
callback).

OAuth state CSRF defense
------------------------

Per RFC 6749 section 10.12, the ``state`` parameter is the standard
OAuth CSRF defense -- server-side random generation at initiate,
server-side comparison at callback. A mismatch yields
``AUTHENTICATION_ERROR_CODES["GITEA_OAUTH_PROVIDER_ERROR"]`` and a 302
back to the app host.

Error envelope contract
-----------------------

Every error path returns an HTTP 302 redirect to
``urljoin(<session host>, "?" + urlencode(params))`` where ``params`` is
:meth:`AuthenticationException.get_error_dict` augmented with the
sanitised ``next_path`` when present. :data:`AUTHENTICATION_ERROR_CODES`
keys raised:

  * ``INSTANCE_NOT_CONFIGURED``    -- deployment is not finished
  * ``GITEA_OAUTH_PROVIDER_ERROR`` -- state mismatch, missing ``code``,
                                       or provider-side failure raised by
                                       :class:`GiteaOAuthProvider`

Architectural notes (per AAP section 0.2.2):

  * Session writes (``host``, ``next_path``, ``state``) and the session
    refresh on login land in **Redis-backed session storage**. Redis =
    caching + session only -- Plane does NOT use Redis as a task broker
    (Celery jobs route through RabbitMQ).
  * The migrator container has already run schema migrations by the time
    this module is imported.
  * No Celery / RabbitMQ enqueue from this module; provider integration
    handoff is synchronous through :class:`GiteaOAuthProvider`.
"""

import uuid
from urllib.parse import urlencode, urljoin

# Django import
from django.http import HttpResponseRedirect
from django.views import View

# Module imports
from plane.authentication.provider.oauth.gitea import GiteaOAuthProvider
from plane.authentication.utils.login import user_login
from plane.authentication.utils.redirection_path import get_redirection_path
from plane.authentication.utils.user_auth_workflow import post_user_auth_workflow
from plane.license.models import Instance
from plane.authentication.utils.host import base_host
from plane.authentication.adapter.error import (
    AuthenticationException,
    AUTHENTICATION_ERROR_CODES,
)
from plane.utils.path_validator import validate_next_path


class GiteaOauthInitiateEndpoint(View):
    """Begin the Gitea OAuth Authorization Code flow.

    HTTP method / URL:
        ``GET /auth/gitea/``

    Inheritance:
        :class:`django.views.View` -- no ``permission_classes`` declared.
        Effectively anonymous-accessible because initiating OAuth must
        work pre-login.

    Query parameters:
        * ``next_path`` (str, optional) -- post-auth redirect target.
          Cleaned via :func:`validate_next_path` and stored in
          ``request.session["next_path"]`` for the callback.

    Response:
        * HTTP 302 redirect to the Gitea authorization URL (success).
        * HTTP 302 redirect to ``urljoin(base_host, "?" + urlencode(params))``
          on error (with the validated ``next_path`` re-embedded into
          ``params`` when present).

    Side effects:
        * Sets ``request.session["host"] = base_host(is_app=True)``.
        * Sets ``request.session["next_path"]`` to
          ``validate_next_path(next_path)`` when provided.
        * Sets ``request.session["state"] = uuid.uuid4().hex`` -- the
          fresh OAuth CSRF token.
        * Reads :class:`Instance.objects.first`.
        * Constructs :class:`GiteaOAuthProvider` and calls
          :meth:`GiteaOAuthProvider.get_auth_url`.

    Error codes:
        ``INSTANCE_NOT_CONFIGURED``, ``GITEA_OAUTH_PROVIDER_ERROR``.
    """

    def get(self, request):
        """Stash session state, generate the OAuth ``state`` token, and redirect to Gitea."""
        # Get host and next path
        request.session["host"] = base_host(request=request, is_app=True)
        next_path = request.GET.get("next_path")
        if next_path:
            request.session["next_path"] = str(validate_next_path(next_path))

        # Check instance configuration
        instance = Instance.objects.first()
        if instance is None or not instance.is_setup_done:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INSTANCE_NOT_CONFIGURED"],
                error_message="INSTANCE_NOT_CONFIGURED",
            )
            params = exc.get_error_dict()
            if next_path:
                params["next_path"] = str(validate_next_path(next_path))
            url = urljoin(base_host(request=request, is_app=True), "?" + urlencode(params))
            return HttpResponseRedirect(url)
        try:
            state = uuid.uuid4().hex
            provider = GiteaOAuthProvider(request=request, state=state)
            request.session["state"] = state
            auth_url = provider.get_auth_url()
            return HttpResponseRedirect(auth_url)
        except AuthenticationException as e:
            params = e.get_error_dict()
            if next_path:
                params["next_path"] = str(validate_next_path(next_path))
            url = urljoin(base_host(request=request, is_app=True), "?" + urlencode(params))
            return HttpResponseRedirect(url)


class GiteaCallbackEndpoint(View):
    """Validate the OAuth callback and complete Gitea sign-in.

    HTTP method / URL:
        ``GET /auth/gitea/callback/``

    Inheritance:
        :class:`django.views.View` -- no ``permission_classes`` declared.
        Effectively anonymous-accessible because Gitea redirects the user
        here before they are authenticated in Plane.

    Query parameters (provided by Gitea's redirect):
        * ``code`` (str, required) -- OAuth authorization code; absent if
          the user denied consent.
        * ``state`` (str, required) -- OAuth state value; must match
          ``request.session["state"]``.

    Local shadowing note:
        Inside this method, the local variable ``base_host`` (read from
        ``request.session.get("host")``) **shadows** the imported
        :func:`base_host` function for the remainder of the method body.
        This pins the redirect to the SAME host the initiate handler used,
        preventing cross-host drift if the request's ``Host`` header
        changed between initiate and callback.

    Response:
        * HTTP 302 redirect to the validated ``next_path`` (joined onto
          the session-stored host) on success.
        * HTTP 302 redirect to ``urljoin(<session host>, "?" + urlencode(params))``
          on error.

    Side effects:
        * Validates ``state`` against ``request.session.get("state", "")``;
          mismatch raises ``GITEA_OAUTH_PROVIDER_ERROR``.
        * Validates presence of ``code``; missing raises
          ``GITEA_OAUTH_PROVIDER_ERROR``.
        * Constructs :class:`GiteaOAuthProvider` with
          ``callback=post_user_auth_workflow`` and calls
          :meth:`GiteaOAuthProvider.authenticate` -- exchanges the code
          for a Gitea access token, loads/creates the Plane
          :class:`User`, and runs the post-auth workflow.
        * Calls :func:`user_login` (``is_app=True``) -- refreshes the
          Redis-backed session.
        * Reads ``request.session.get("next_path")`` and routes the
          redirect through :func:`validate_next_path` before
          ``urljoin``.

    Error codes:
        ``GITEA_OAUTH_PROVIDER_ERROR`` (covers state mismatch, missing
        code, and provider-side failure).
    """

    def get(self, request):
        """Validate the OAuth ``state``, exchange the ``code`` for a user, and refresh the session."""
        code = request.GET.get("code")
        state = request.GET.get("state")
        base_host = request.session.get("host")
        next_path = request.session.get("next_path")

        if state != request.session.get("state", ""):
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["GITEA_OAUTH_PROVIDER_ERROR"],
                error_message="GITEA_OAUTH_PROVIDER_ERROR",
            )
            params = exc.get_error_dict()
            if next_path:
                params["next_path"] = str(next_path)
            url = urljoin(base_host, "?" + urlencode(params))
            return HttpResponseRedirect(url)

        if not code:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["GITEA_OAUTH_PROVIDER_ERROR"],
                error_message="GITEA_OAUTH_PROVIDER_ERROR",
            )
            params = exc.get_error_dict()
            if next_path:
                params["next_path"] = str(validate_next_path(next_path))
            url = urljoin(base_host, "?" + urlencode(params))
            return HttpResponseRedirect(url)

        try:
            provider = GiteaOAuthProvider(request=request, code=code, callback=post_user_auth_workflow)
            user = provider.authenticate()
            # Login the user and record his device info
            user_login(request=request, user=user, is_app=True)
            # Get the redirection path
            if next_path:
                path = str(validate_next_path(next_path))
            else:
                path = get_redirection_path(user=user)
            # redirect to referer path
            url = urljoin(base_host, path)
            return HttpResponseRedirect(url)
        except AuthenticationException as e:
            params = e.get_error_dict()
            if next_path:
                params["next_path"] = str(validate_next_path(next_path))
            url = urljoin(base_host, "?" + urlencode(params))
            return HttpResponseRedirect(url)
