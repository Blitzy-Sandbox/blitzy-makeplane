# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Space-scoped credential (email + password) sign-in / sign-up endpoints.

Two Django :class:`View` subclasses serve the public-space / tenant surface:

  * :class:`SignInAuthSpaceEndpoint` — ``POST /auth/spaces/sign-in/``
  * :class:`SignUpAuthSpaceEndpoint` — ``POST /auth/spaces/sign-up/``

Both views are redirect-only (HTTP 302), never JSON. Failure is surfaced by
appending the :meth:`AuthenticationException.get_error_dict` payload as
query parameters to a safe redirect URL constructed via
:func:`get_safe_redirect_url` against ``base_host(request, is_space=True)``.

This module is the ``is_space=True`` mirror of
:mod:`plane.authentication.views.app.email` — the view-class shapes mirror
the app surface byte-for-byte; only the host-resolution and ``user_login``
flags switch to ``is_space=True``.

Authentication delegation:
    Credential exchange is delegated to
    :class:`plane.authentication.provider.credentials.email.EmailProvider`
    with ``is_signup=False`` for sign-in and ``is_signup=True`` for sign-up.

Session storage (per AAP §0.2.2):
    :func:`user_login` calls Django's :func:`django.contrib.auth.login` which
    writes the session to Redis-backed session storage. Plane uses Redis for
    caching and session storage only — Celery tasks (which this module does
    NOT enqueue) route through RabbitMQ.

Open-redirect prevention:
    ``next_path`` is sanitized via :func:`validate_next_path` and the
    composed redirect URL is gated by
    :func:`url_has_allowed_host_and_scheme` against
    :func:`get_allowed_hosts`; unsafe URLs fall back to
    ``base_host(request, is_space=True)``.

Error codes routed through this module:
    ``INSTANCE_NOT_CONFIGURED``, ``REQUIRED_EMAIL_PASSWORD_SIGN_IN``,
    ``REQUIRED_EMAIL_PASSWORD_SIGN_UP``, ``INVALID_EMAIL_SIGN_IN``,
    ``INVALID_EMAIL_SIGN_UP``, ``USER_DOES_NOT_EXIST``,
    ``USER_ALREADY_EXIST`` — plus any error code raised by
    :meth:`EmailProvider.authenticate`.
"""

# Django imports
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.http import HttpResponseRedirect
from django.views import View
from django.utils.http import url_has_allowed_host_and_scheme

# Module imports
from plane.authentication.provider.credentials.email import EmailProvider
from plane.authentication.utils.login import user_login
from plane.license.models import Instance
from plane.authentication.utils.host import base_host
from plane.db.models import User
from plane.authentication.adapter.error import (
    AUTHENTICATION_ERROR_CODES,
    AuthenticationException,
)
from plane.utils.path_validator import get_safe_redirect_url, validate_next_path, get_allowed_hosts


class SignInAuthSpaceEndpoint(View):
    """Space-tenant credential sign-in (POST form, HTTP 302 redirect response).

    HTTP method / URL:
        ``POST /auth/spaces/sign-in/``

    Permission:
        Django :class:`~django.views.View` subclass (not DRF) — no
        ``permission_classes`` declaration applies. Anonymous access is the
        whole point: this view ESTABLISHES the session.

    Request body (POST form):
        * ``email`` (str, required) — normalized to ``email.strip().lower()``
          and validated by Django :func:`validate_email`.
        * ``password`` (str, required) — verified against the hashed
          ``User.password`` by :meth:`EmailProvider.authenticate` with
          ``is_signup=False``.
        * ``next_path`` (str, optional) — post-auth redirect destination;
          sanitized via :func:`validate_next_path`.

    Response:
        HTTP 302 redirect — either to
        ``base_host(request, is_space=True) + validate_next_path(next_path)``
        (when safe) or to ``base_host(request, is_space=True)`` with the
        :meth:`AuthenticationException.get_error_dict` payload encoded as
        query string on failure.

    Error codes:
        ``INSTANCE_NOT_CONFIGURED``, ``REQUIRED_EMAIL_PASSWORD_SIGN_IN``,
        ``INVALID_EMAIL_SIGN_IN``, ``USER_DOES_NOT_EXIST``, plus any code
        raised by :meth:`EmailProvider.authenticate`.

    Side effects:
        * On success: :func:`user_login` with ``is_space=True`` writes the
          Django session to Redis-backed session storage (Redis = cache /
          session only — Plane Celery tasks route through RabbitMQ).
        * On failure: no DB writes, no session writes — only a redirect
          with error params.

    Pre-condition:
        ``Instance.objects.first().is_setup_done`` must be ``True`` (the
        migrator container must have completed); otherwise the redirect
        carries the ``INSTANCE_NOT_CONFIGURED`` error code.
    """

    def post(self, request):
        """Verify credentials and either redirect to ``next_path`` or back with an error code."""
        next_path = request.POST.get("next_path")
        # Check instance configuration
        instance = Instance.objects.first()
        if instance is None or not instance.is_setup_done:
            # Redirection params
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INSTANCE_NOT_CONFIGURED"],
                error_message="INSTANCE_NOT_CONFIGURED",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)

        # set the referer as session to redirect after login
        email = request.POST.get("email", False)
        password = request.POST.get("password", False)

        ## Raise exception if any of the above are missing
        if not email or not password:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["REQUIRED_EMAIL_PASSWORD_SIGN_IN"],
                error_message="REQUIRED_EMAIL_PASSWORD_SIGN_IN",
                payload={"email": str(email)},
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)

        # Validate email
        email = email.strip().lower()
        try:
            validate_email(email)
        except ValidationError:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INVALID_EMAIL_SIGN_IN"],
                error_message="INVALID_EMAIL_SIGN_IN",
                payload={"email": str(email)},
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)

        # Existing User
        existing_user = User.objects.filter(email=email).first()

        if not existing_user:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["USER_DOES_NOT_EXIST"],
                error_message="USER_DOES_NOT_EXIST",
                payload={"email": str(email)},
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)

        try:
            provider = EmailProvider(request=request, key=email, code=password, is_signup=False)
            user = provider.authenticate()
            # Login the user and record his device info
            user_login(request=request, user=user, is_space=True)
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


class SignUpAuthSpaceEndpoint(View):
    """Space-tenant credential sign-up (POST form, HTTP 302 redirect response).

    HTTP method / URL:
        ``POST /auth/spaces/sign-up/``

    Permission:
        Django :class:`~django.views.View` subclass (not DRF) — no
        ``permission_classes`` declaration applies. Anonymous access is
        required; this view CREATES the user.

    Request body (POST form):
        * ``email`` (str, required) — normalized to ``email.strip().lower()``
          and validated by Django :func:`validate_email`.
        * ``password`` (str, required) — used by
          :meth:`EmailProvider.authenticate` (``is_signup=True``) to create
          the new ``User`` row with the hashed password.
        * ``next_path`` (str, optional) — post-auth redirect destination;
          sanitized via :func:`validate_next_path`.

    Response:
        HTTP 302 redirect — same shape as :class:`SignInAuthSpaceEndpoint`.

    Error codes:
        ``INSTANCE_NOT_CONFIGURED``, ``REQUIRED_EMAIL_PASSWORD_SIGN_UP``,
        ``INVALID_EMAIL_SIGN_UP``, ``USER_ALREADY_EXIST``, plus any code
        raised by :meth:`EmailProvider.authenticate` with ``is_signup=True``.

    Side effects:
        * Creates a ``User`` row via
          ``EmailProvider(request, key=email, code=password,
          is_signup=True).authenticate()``.
        * Logs the user in via :func:`user_login` with ``is_space=True``
          which writes the Django session to Redis-backed session storage.
        * Does NOT directly enqueue Celery tasks from this view; downstream
          post-create signal handlers may enqueue tasks via RabbitMQ.

    Pre-condition:
        ``Instance.objects.first().is_setup_done`` must be ``True``;
        otherwise the redirect carries ``INSTANCE_NOT_CONFIGURED``.
    """

    def post(self, request):
        """Create a new user, log them in, and redirect to ``next_path`` (or back with an error)."""
        next_path = request.POST.get("next_path")
        # Check instance configuration
        instance = Instance.objects.first()
        if instance is None or not instance.is_setup_done:
            # Redirection params
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INSTANCE_NOT_CONFIGURED"],
                error_message="INSTANCE_NOT_CONFIGURED",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)

        email = request.POST.get("email", False)
        password = request.POST.get("password", False)
        ## Raise exception if any of the above are missing
        if not email or not password:
            # Redirection params
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["REQUIRED_EMAIL_PASSWORD_SIGN_UP"],
                error_message="REQUIRED_EMAIL_PASSWORD_SIGN_UP",
                payload={"email": str(email)},
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)
        # Validate the email
        email = email.strip().lower()
        try:
            validate_email(email)
        except ValidationError:
            # Redirection params
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INVALID_EMAIL_SIGN_UP"],
                error_message="INVALID_EMAIL_SIGN_UP",
                payload={"email": str(email)},
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)

        # Existing User
        existing_user = User.objects.filter(email=email).first()

        if existing_user:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["USER_ALREADY_EXIST"],
                error_message="USER_ALREADY_EXIST",
                payload={"email": str(email)},
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True), next_path=next_path, params=params
            )
            return HttpResponseRedirect(url)

        try:
            provider = EmailProvider(request=request, key=email, code=password, is_signup=True)
            user = provider.authenticate()
            # Login the user and record his device info
            user_login(request=request, user=user, is_space=True)
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
