# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Space-scoped Gitea OAuth 2.0 sign-in (initiate + callback).

Two Django :class:`View` subclasses implement the Gitea authorization-code
flow for the public-space / tenant surface:

  * :class:`GiteaOauthInitiateSpaceEndpoint` -- ``GET /auth/spaces/gitea/``
    generates a CSRF ``state`` (``uuid.uuid4().hex``), stashes the space
    host, optional sanitized ``next_path``, and state in the
    PostgreSQL-backed Django session (via the
    ``plane.db.models.session`` engine), and redirects the browser to
    Gitea's authorization endpoint via
    :meth:`GiteaOAuthProvider.get_auth_url`.
  * :class:`GiteaCallbackSpaceEndpoint` -- ``GET /auth/spaces/gitea/callback/``
    validates the returned ``state`` against the session value (CSRF
    defense), validates the authorization ``code``, exchanges it for a
    Plane :class:`User` via :meth:`GiteaOAuthProvider.authenticate`, calls
    :func:`user_login` with ``is_space=True``, and redirects to the
    sanitized ``next_path`` (or to ``base_host`` if absent).

This module is the ``is_space=True`` mirror of
:mod:`plane.authentication.views.app.gitea` -- view-class shapes mirror
the app surface; only the host-resolution and login flags differ.

Divergence from sibling OAuth views (intentional):
    Unlike :mod:`plane.authentication.views.space.google`,
    :mod:`plane.authentication.views.space.github`,
    :mod:`plane.authentication.views.space.gitlab`, this module composes
    redirect URLs directly via ``f"{base_host(...)}?{urlencode(params)}"``
    rather than going through :func:`get_safe_redirect_url`. The
    success-path redirect also skips the
    :func:`url_has_allowed_host_and_scheme` guard; safety is delegated
    entirely to :func:`validate_next_path` (which constrains the path
    component). The local name ``base_host`` is NOT shadowed here.

OAuth state CSRF defense:
    ``state = uuid.uuid4().hex`` is generated server-side on initiate,
    stored in ``request.session["state"]``, and verified on callback;
    mismatch raises ``GITEA_OAUTH_PROVIDER_ERROR``.

Open-redirect prevention:
    Post-auth ``next_path`` is sanitized via :func:`validate_next_path`
    BOTH when persisted to the session on initiate AND when composed into
    the final redirect URL on callback.

Session storage:
    OAuth ``state``, ``host``, and (optional) sanitized ``next_path``
    are written to the PostgreSQL-backed Django session via the
    ``plane.db.models.session`` engine (see ``SESSION_ENGINE`` in
    ``apps/api/plane/settings/common.py``). Redis is used for caching
    and selected ephemeral auth data only -- it is NOT the Django
    session backend, and Plane's Celery task queueing routes through
    RabbitMQ. OAuth itself does NOT enqueue any Celery task here.

Error codes:
    ``INSTANCE_NOT_CONFIGURED`` (initiate path),
    ``GITEA_OAUTH_PROVIDER_ERROR`` (state mismatch, missing code, provider
    failure on both paths).
"""

# Python imports
import uuid
from urllib.parse import urlencode

# Django import
from django.http import HttpResponseRedirect
from django.views import View

# Module imports
from plane.authentication.provider.oauth.gitea import GiteaOAuthProvider
from plane.authentication.utils.login import user_login
from plane.license.models import Instance
from plane.authentication.utils.host import base_host
from plane.authentication.adapter.error import (
    AUTHENTICATION_ERROR_CODES,
    AuthenticationException,
)
from plane.utils.path_validator import validate_next_path


class GiteaOauthInitiateSpaceEndpoint(View):
    """Begin the space-tenant Gitea OAuth flow.

    HTTP method / URL:
        ``GET /auth/spaces/gitea/``

    Permission:
        Django :class:`~django.views.View` subclass (not DRF). Anonymous
        access required -- this view begins the sign-in.

    Query parameters:
        * ``next_path`` (str, optional) -- post-auth redirect destination;
          sanitized via :func:`validate_next_path` and persisted to
          ``request.session["next_path"]`` for the callback to consume.

    Response:
        HTTP 302 redirect -- either to Gitea's authorization endpoint
        (``provider.get_auth_url()``) on the happy path, or back to
        ``f"{base_host(request, is_space=True)}?{urlencode(params)}"``
        with :meth:`AuthenticationException.get_error_dict` query params
        on failure.

    Side effects (PostgreSQL-backed Django session writes via
    ``plane.db.models.session``):
        * ``request.session["host"] = base_host(request, is_space=True)``
        * ``request.session["next_path"] = validate_next_path(next_path)``
          (only when ``next_path`` is present)
        * ``request.session["state"] = uuid.uuid4().hex`` (CSRF token
          verified on callback).

    Error codes:
        ``INSTANCE_NOT_CONFIGURED``, ``GITEA_OAUTH_PROVIDER_ERROR``.

    Pre-condition:
        ``Instance.objects.first().is_setup_done`` must be ``True``;
        otherwise redirect with ``INSTANCE_NOT_CONFIGURED``.
    """

    def get(self, request):
        """Stash host + sanitized next_path + state in session, then redirect to Gitea's auth URL."""
        # Get host and next path
        request.session["host"] = base_host(request=request, is_space=True)
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
            url = f"{base_host(request=request, is_space=True)}?{urlencode(params)}"
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
                params["next_path"] = str(next_path)
            url = f"{base_host(request=request, is_space=True)}?{urlencode(params)}"
            return HttpResponseRedirect(url)


class GiteaCallbackSpaceEndpoint(View):
    """Complete the space-tenant Gitea OAuth flow (token exchange + login).

    HTTP method / URL:
        ``GET /auth/spaces/gitea/callback/``

    Permission:
        Django :class:`~django.views.View` subclass (not DRF). Public
        endpoint hit by Gitea's redirect-back to Plane.

    Query parameters (set by Gitea):
        * ``code`` (str, required) -- authorization code to exchange.
        * ``state`` (str, required) -- CSRF token; MUST match the value
          stored on initiate in ``request.session["state"]``.

    Session reads:
        * ``request.session.get("next_path")`` -- persisted by the
          initiate view; consumed here to compose the final redirect.

    Response:
        HTTP 302 redirect -- on success to
        ``f"{base_host(request, is_space=True)}{validate_next_path(session_next_path)}"``
        (or just ``base_host(...)`` when no ``next_path``); on failure to
        ``f"{base_host(request, is_space=True)}?{urlencode(error_params)}"``.

        Unlike :mod:`plane.authentication.views.space.google`,
        :mod:`plane.authentication.views.space.github`,
        :mod:`plane.authentication.views.space.gitlab`, this view does NOT
        apply :func:`url_has_allowed_host_and_scheme` to the success-path
        URL; safety is delegated entirely to :func:`validate_next_path`.

    Error codes:
        ``GITEA_OAUTH_PROVIDER_ERROR`` -- raised on state mismatch,
        missing ``code``, or any failure inside
        :meth:`GiteaOAuthProvider.authenticate`.

    Side effects:
        * On success: :func:`user_login` with ``is_space=True`` writes
          the Django session to the PostgreSQL-backed session store via
          the ``plane.db.models.session`` engine.
        * No DB writes from this view directly; user-row writes happen
          inside :meth:`GiteaOAuthProvider.authenticate` when the Gitea
          account is first linked.
    """

    def get(self, request):
        """Validate state + code, exchange for a User, log in, and redirect to the sanitized next_path."""
        code = request.GET.get("code")
        state = request.GET.get("state")
        next_path = request.session.get("next_path")

        if state != request.session.get("state", ""):
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["GITEA_OAUTH_PROVIDER_ERROR"],
                error_message="GITEA_OAUTH_PROVIDER_ERROR",
            )
            params = exc.get_error_dict()
            if next_path:
                params["next_path"] = str(validate_next_path(next_path))
            url = f"{base_host(request=request, is_space=True)}?{urlencode(params)}"
            return HttpResponseRedirect(url)

        if not code:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["GITEA_OAUTH_PROVIDER_ERROR"],
                error_message="GITEA_OAUTH_PROVIDER_ERROR",
            )
            params = exc.get_error_dict()
            if next_path:
                params["next_path"] = str(validate_next_path(next_path))
            url = f"{base_host(request=request, is_space=True)}?{urlencode(params)}"
            return HttpResponseRedirect(url)

        try:
            provider = GiteaOAuthProvider(request=request, code=code)
            user = provider.authenticate()
            # Login the user and record his device info
            user_login(request=request, user=user, is_space=True)
            # Process workspace and project invitations
            # redirect to referer path
            url = (
                f"{base_host(request=request, is_space=True)}{str(validate_next_path(next_path)) if next_path else ''}"
            )
            return HttpResponseRedirect(url)
        except AuthenticationException as e:
            params = e.get_error_dict()
            if next_path:
                params["next_path"] = str(validate_next_path(next_path))
            url = f"{base_host(request=request, is_space=True)}?{urlencode(params)}"
            return HttpResponseRedirect(url)
