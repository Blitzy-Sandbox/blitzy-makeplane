# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Space-scoped GitHub OAuth 2.0 sign-in (initiate + callback).

Two Django :class:`View` subclasses implement the GitHub authorization-code
flow for the public-space / tenant surface:

  * :class:`GitHubOauthInitiateSpaceEndpoint` -- ``GET /auth/spaces/github/``
    generates a CSRF ``state`` (``uuid.uuid4().hex``), stashes the space
    host and state in the Redis-backed session, and redirects the browser
    to GitHub's authorization endpoint via
    :meth:`GitHubOAuthProvider.get_auth_url`.
  * :class:`GitHubCallbackSpaceEndpoint` -- ``GET /auth/spaces/github/callback/``
    validates the returned ``state`` against the session value (CSRF
    defense), validates the authorization ``code``, exchanges it for a
    Plane :class:`User` via :meth:`GitHubOAuthProvider.authenticate`, calls
    :func:`user_login` with ``is_space=True``, and redirects safely.

This module is the ``is_space=True`` mirror of
:mod:`apps.api.plane.authentication.views.app.github` -- view-class shapes
mirror the app surface; only the host-resolution and login flags differ.

OAuth state CSRF defense:
    ``state = uuid.uuid4().hex`` is generated server-side on initiate,
    stored in ``request.session["state"]``, and verified on callback;
    mismatch -> ``GITHUB_OAUTH_PROVIDER_ERROR``.

Open-redirect prevention:
    Post-auth ``next_path`` is sanitized via :func:`validate_next_path`,
    composed against ``base_host(request, is_space=True)``, and gated by
    :func:`url_has_allowed_host_and_scheme` against
    :func:`get_allowed_hosts`; unsafe URLs fall back to
    ``base_host(request, is_space=True)``.

Session storage (per AAP 0.2.2):
    OAuth ``state`` and ``host`` are written to Django's Redis-backed
    session. Redis is used for caching and session storage only -- Plane's
    Celery task queueing routes through RabbitMQ, but OAuth itself does NOT
    enqueue any Celery task here.

Error codes:
    ``INSTANCE_NOT_CONFIGURED`` (initiate path),
    ``GITHUB_OAUTH_PROVIDER_ERROR`` (state mismatch, missing code, provider
    failure on both paths).
"""

# Python imports
import uuid

# Django import
from django.http import HttpResponseRedirect
from django.views import View
from django.utils.http import url_has_allowed_host_and_scheme

# Module imports
from plane.authentication.provider.oauth.github import GitHubOAuthProvider
from plane.authentication.utils.login import user_login
from plane.license.models import Instance
from plane.authentication.utils.host import base_host
from plane.authentication.adapter.error import (
    AUTHENTICATION_ERROR_CODES,
    AuthenticationException,
)
from plane.utils.path_validator import get_safe_redirect_url, validate_next_path, get_allowed_hosts


class GitHubOauthInitiateSpaceEndpoint(View):
    """Begin the space-tenant GitHub OAuth flow.

    HTTP method / URL:
        ``GET /auth/spaces/github/``

    Permission:
        Django :class:`~django.views.View` subclass (not DRF). Anonymous
        access required -- this view begins the sign-in.

    Query parameters:
        * ``next_path`` (str, optional) -- post-auth redirect destination.

    Response:
        HTTP 302 redirect -- either to GitHub's authorization endpoint
        (``provider.get_auth_url()``) on the happy path, or back to
        ``base_host(request, is_space=True)`` with
        :meth:`AuthenticationException.get_error_dict` query params on
        failure.

    Side effects (Redis-backed session writes):
        * ``request.session["host"] = base_host(request, is_space=True)``
        * ``request.session["state"] = uuid.uuid4().hex`` (CSRF token
          verified on callback).

    Error codes:
        ``INSTANCE_NOT_CONFIGURED``, ``GITHUB_OAUTH_PROVIDER_ERROR``.

    Pre-condition:
        ``Instance.objects.first().is_setup_done`` must be ``True``;
        otherwise redirect with ``INSTANCE_NOT_CONFIGURED``.
    """

    def get(self, request):
        """Stash host + state in session, then redirect to GitHub's auth URL."""
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
            provider = GitHubOAuthProvider(request=request, state=state)
            request.session["state"] = state
            auth_url = provider.get_auth_url()
            return HttpResponseRedirect(auth_url)
        except AuthenticationException as e:
            params = e.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)


class GitHubCallbackSpaceEndpoint(View):
    """Complete the space-tenant GitHub OAuth flow (token exchange + login).

    HTTP method / URL:
        ``GET /auth/spaces/github/callback/``

    Permission:
        Django :class:`~django.views.View` subclass (not DRF). Public
        endpoint hit by GitHub's redirect-back to Plane.

    Query parameters (set by GitHub):
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
        ``GITHUB_OAUTH_PROVIDER_ERROR`` -- raised on state mismatch, missing
        ``code``, or any failure inside
        :meth:`GitHubOAuthProvider.authenticate`.

    Side effects:
        * On success: :func:`user_login` with ``is_space=True`` writes the
          Django session to Redis-backed session storage.
        * No DB writes from this view directly; user-row writes happen
          inside :meth:`GitHubOAuthProvider.authenticate` when the GitHub
          account is first linked.

    # INTENT UNCLEAR: line 61 binds the LOCAL name ``base_host`` to
    # ``request.session.get("host")`` (a string), shadowing the imported
    # ``base_host`` function in this method's scope. Subsequent
    # ``base_host(request=request, is_space=True)`` calls on the error /
    # success paths invoke the local string as a callable, which would
    # raise ``TypeError`` if reached. Behavior preserved verbatim per the
    # no-logic-change rule (AAP 0.12.3).
    """

    def get(self, request):
        """Validate state + code, exchange for a User, log in, and redirect safely."""
        code = request.GET.get("code")
        state = request.GET.get("state")
        base_host = request.session.get("host")
        next_path = request.session.get("next_path")

        if state != request.session.get("state", ""):
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["GITHUB_OAUTH_PROVIDER_ERROR"],
                error_message="GITHUB_OAUTH_PROVIDER_ERROR",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)

        if not code:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["GITHUB_OAUTH_PROVIDER_ERROR"],
                error_message="GITHUB_OAUTH_PROVIDER_ERROR",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)

        try:
            provider = GitHubOAuthProvider(request=request, code=code)
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
