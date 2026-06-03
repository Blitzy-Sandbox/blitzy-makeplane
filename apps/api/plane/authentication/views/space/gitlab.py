# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Space-scoped GitLab OAuth 2.0 sign-in (initiate + callback).

Two Django :class:`View` subclasses implement the GitLab authorization-code
flow for the public-space / tenant surface:

  * :class:`GitLabOauthInitiateSpaceEndpoint` -- ``GET /auth/spaces/gitlab/``
    generates a CSRF ``state`` (``uuid.uuid4().hex``), stashes the space
    host and state in the PostgreSQL-backed Django session (via the
    ``plane.db.models.session`` engine), and redirects the browser to
    GitLab's authorization endpoint via
    :meth:`GitLabOAuthProvider.get_auth_url`.
  * :class:`GitLabCallbackSpaceEndpoint` -- ``GET /auth/spaces/gitlab/callback/``
    validates the returned ``state`` against the session value (CSRF
    defense), validates the authorization ``code``, exchanges it for a
    Plane :class:`User` via :meth:`GitLabOAuthProvider.authenticate`, calls
    :func:`user_login` with ``is_space=True``, and redirects safely.

This module is the ``is_space=True`` mirror of
:mod:`apps.api.plane.authentication.views.app.gitlab` -- view-class shapes
mirror the app surface; only the host-resolution and login flags differ.

OAuth state CSRF defense:
    ``state = uuid.uuid4().hex`` is generated server-side on initiate,
    stored in ``request.session["state"]``, and verified on callback;
    mismatch -> ``GITLAB_OAUTH_PROVIDER_ERROR``.

Open-redirect prevention:
    Post-auth ``next_path`` is sanitized via :func:`validate_next_path`,
    composed against ``base_host(request, is_space=True)``, and gated by
    :func:`url_has_allowed_host_and_scheme` against
    :func:`get_allowed_hosts`; unsafe URLs fall back to
    ``base_host(request, is_space=True)``.

Session storage (per AAP 0.2.2):
    OAuth ``state`` and ``host`` are written to the PostgreSQL-backed
    Django session via the ``plane.db.models.session`` engine (see
    ``SESSION_ENGINE`` in ``apps/api/plane/settings/common.py``). Redis
    is used for caching and selected ephemeral auth data only -- it is
    NOT the Django session backend, and Plane's Celery task queueing
    routes through RabbitMQ. OAuth itself does NOT enqueue any Celery
    task here.

Error codes:
    ``INSTANCE_NOT_CONFIGURED`` (initiate path),
    ``GITLAB_OAUTH_PROVIDER_ERROR`` (state mismatch, missing code, provider
    failure on both paths).
"""

# Python imports
import uuid

# Django import
from django.http import HttpResponseRedirect
from django.views import View
from django.utils.http import url_has_allowed_host_and_scheme

# Module imports
from plane.authentication.provider.oauth.gitlab import GitLabOAuthProvider
from plane.authentication.utils.login import user_login
from plane.license.models import Instance
from plane.authentication.utils.host import base_host
from plane.authentication.adapter.error import (
    AUTHENTICATION_ERROR_CODES,
    AuthenticationException,
)
from plane.utils.path_validator import get_safe_redirect_url, validate_next_path, get_allowed_hosts


class GitLabOauthInitiateSpaceEndpoint(View):
    """Begin the space-tenant GitLab OAuth flow.

    HTTP method / URL:
        ``GET /auth/spaces/gitlab/``

    Permission:
        Django :class:`~django.views.View` subclass (not DRF). Anonymous
        access required -- this view begins the sign-in.

    Query parameters:
        * ``next_path`` (str, optional) -- post-auth redirect destination.

    Response:
        HTTP 302 redirect -- either to GitLab's authorization endpoint
        (``provider.get_auth_url()``) on the happy path, or back to
        ``base_host(request, is_space=True)`` with
        :meth:`AuthenticationException.get_error_dict` query params on
        failure.

    Side effects (PostgreSQL-backed Django session writes via
    ``plane.db.models.session``):
        * ``request.session["host"] = base_host(request, is_space=True)``
        * ``request.session["state"] = uuid.uuid4().hex`` (CSRF token
          verified on callback).

    Error codes:
        ``INSTANCE_NOT_CONFIGURED``, ``GITLAB_OAUTH_PROVIDER_ERROR``.

    Pre-condition:
        ``Instance.objects.first().is_setup_done`` must be ``True``;
        otherwise redirect with ``INSTANCE_NOT_CONFIGURED``.
    """

    def get(self, request):
        """Stash host + state in session, then redirect to GitLab's auth URL."""
        # Get host and next path
        request.session["host"] = base_host(request=request, is_space=True)
        next_path = request.GET.get("next_path")

        # Check instance configuration
        instance = Instance.objects.first()
        if instance is None or not instance.is_setup_done:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INSTANCE_NOT_CONFIGURED"],
                error_message="INSTANCE_NOT_CONFIGURED",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True), next_path=next_path, params=params
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
                base_url=base_host(request=request, is_space=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)


class GitLabCallbackSpaceEndpoint(View):
    """Complete the space-tenant GitLab OAuth flow (token exchange + login).

    HTTP method / URL:
        ``GET /auth/spaces/gitlab/callback/``

    Permission:
        Django :class:`~django.views.View` subclass (not DRF). Public
        endpoint hit by GitLab's redirect-back to Plane.

    Query parameters (set by GitLab):
        * ``code`` (str, required) -- authorization code to exchange.
        * ``state`` (str, required) -- CSRF token; MUST match the value
          stored on initiate in ``request.session["state"]``.

    Response:
        HTTP 302 redirect -- on success to
        ``base_host(request, is_space=True) +
        validate_next_path(session_next_path)``; on failure to
        ``base_host(request, is_space=True)`` with
        :meth:`AuthenticationException.get_error_dict` query params.

    Error codes:
        ``GITLAB_OAUTH_PROVIDER_ERROR`` -- raised on state mismatch, missing
        ``code``, or any failure inside
        :meth:`GitLabOAuthProvider.authenticate`.

    Side effects:
        * On success: :func:`user_login` with ``is_space=True`` writes
          the Django session to the PostgreSQL-backed session store via
          the ``plane.db.models.session`` engine.
        * No DB writes from this view directly; user-row writes happen
          inside :meth:`GitLabOAuthProvider.authenticate` when the GitLab
          account is first linked.

    # INTENT UNCLEAR: the ``base_host`` local rebound to ``request.session.get("host")`` shadows the imported function and would raise ``TypeError`` if invoked on the error/success paths; behavior preserved verbatim per AAP 0.12.3.
    """

    def get(self, request):
        """Validate state + code, exchange for a User, log in, and redirect safely."""
        code = request.GET.get("code")
        state = request.GET.get("state")
        base_host = request.session.get("host")
        next_path = request.session.get("next_path")

        if state != request.session.get("state", ""):
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["GITLAB_OAUTH_PROVIDER_ERROR"],
                error_message="GITLAB_OAUTH_PROVIDER_ERROR",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)

        if not code:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["GITLAB_OAUTH_PROVIDER_ERROR"],
                error_message="GITLAB_OAUTH_PROVIDER_ERROR",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)

        try:
            provider = GitLabOAuthProvider(request=request, code=code)
            user = provider.authenticate()
            # Login the user and record his device info
            user_login(request=request, user=user, is_space=True)
            # Process workspace and project invitations
            # redirect to referer path
            next_path = validate_next_path(next_path=next_path)

            url = f"{base_host(request=request, is_space=True).rstrip('/')}{next_path}"
            if url_has_allowed_host_and_scheme(url, allowed_hosts=get_allowed_hosts()):
                return HttpResponseRedirect(url)
            else:
                return HttpResponseRedirect(base_host(request=request, is_space=True))
        except AuthenticationException as e:
            params = e.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)
