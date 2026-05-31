# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Space-scoped magic-link auth: generate -> sign-in / sign-up.

Three classes implement the public-space / tenant magic-code flow:

  * :class:`MagicGenerateSpaceEndpoint` -- ``POST /auth/spaces/magic-generate/``
    DRF :class:`APIView` (``AllowAny``). Validates the supplied email,
    asks :class:`MagicCodeProvider` to mint a ``(key, token)`` pair, and
    enqueues the email-delivery task. Returns ``{"key": <str>}``.
  * :class:`MagicSignInSpaceEndpoint` -- ``POST /auth/spaces/magic-sign-in/``
    Django :class:`View`. Verifies the submitted ``(email, code)`` for an
    EXISTING user, logs the user in, and redirects safely.
  * :class:`MagicSignUpSpaceEndpoint` -- ``POST /auth/spaces/magic-sign-up/``
    Django :class:`View`. Verifies the submitted ``(email, code)`` for a
    NEW user (refuses if the user already exists), creates the account via
    the provider, logs in, and redirects safely.

This module is the ``is_space=True`` mirror of
:mod:`plane.authentication.views.app.magic` -- view-class shapes and
validation rules mirror the app surface; only the host-resolution and
login flags switch to ``is_space=True``.

Async infrastructure (per AAP architectural context -- critical distinction):
    * Email delivery uses **Celery via RabbitMQ**:
      :func:`magic_link.delay(email, key, token)` enqueues the task
      :func:`plane.bgtasks.magic_link_code_task.magic_link` for a Celery
      worker to consume from the RabbitMQ broker.
    * Magic-code STORAGE uses **Redis (cache / ephemeral auth data only --
      not task queue)**: :class:`MagicCodeProvider` writes the issued
      ``(key, token)`` to Redis with a short TTL and reads it back on
      sign-in / sign-up.
    * Django session storage uses **PostgreSQL** via the custom
      ``plane.db.models.session`` engine (see ``SESSION_ENGINE`` in
      ``apps/api/plane/settings/common.py``): :func:`user_login` with
      ``is_space=True`` writes the Django session to the PostgreSQL
      ``sessions`` table -- NOT Redis.

    Plane uses RabbitMQ for task queueing, Redis for caching + selected
    ephemeral auth data, and PostgreSQL for authoritative session
    storage; these are THREE DIFFERENT backing services and must not be
    conflated.

Open-redirect prevention:
    Both sign-in / sign-up views sanitize ``next_path`` via
    :func:`validate_next_path` and gate the composed URL via
    :func:`url_has_allowed_host_and_scheme` against
    :func:`get_allowed_hosts`; unsafe URLs fall back to
    ``base_host(request, is_space=True)``.

Error codes routed through this module:
    ``INSTANCE_NOT_CONFIGURED``, ``MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED``,
    ``MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED``, ``USER_DOES_NOT_EXIST``,
    ``USER_ALREADY_EXIST``, plus any code raised by
    :meth:`MagicCodeProvider.authenticate` (e.g. expired or mismatched
    code).
"""

# Django imports
from django.core.validators import validate_email
from django.http import HttpResponseRedirect
from django.views import View
from django.utils.http import url_has_allowed_host_and_scheme

# Third party imports
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

# Module imports
from plane.authentication.provider.credentials.magic_code import MagicCodeProvider
from plane.authentication.utils.login import user_login
from plane.bgtasks.magic_link_code_task import magic_link
from plane.license.models import Instance
from plane.authentication.utils.host import base_host
from plane.db.models import User
from plane.authentication.adapter.error import (
    AuthenticationException,
    AUTHENTICATION_ERROR_CODES,
)
from plane.utils.path_validator import get_safe_redirect_url, validate_next_path, get_allowed_hosts


class MagicGenerateSpaceEndpoint(APIView):
    """Mint a magic code for an email and enqueue the delivery task.

    HTTP method / URL:
        ``POST /auth/spaces/magic-generate/``

    Permission:
        ``permission_classes = [AllowAny]`` -- anonymous access required;
        clients call this BEFORE they have a session.

    Request body (JSON):
        * ``email`` (str, required) -- normalized to
          ``email.strip().lower()`` and validated by Django
          :func:`validate_email`.

    Response shapes:
        * HTTP 200 -- ``{"key": <str>}`` where ``key`` is the Redis cache
          key under which the magic code is stored. The client passes
          this key back on the subsequent sign-in / sign-up call.
        * HTTP 400 -- :meth:`AuthenticationException.get_error_dict`
          envelope with ``INSTANCE_NOT_CONFIGURED`` or whatever code the
          underlying :func:`validate_email` / :class:`MagicCodeProvider`
          surfaces.

    Side effects (per AAP architectural context -- service distinction):
        * Writes the ``(key, token)`` to **Redis** via
          :meth:`MagicCodeProvider.initiate` (Redis = cache only).
        * Enqueues an email-delivery task via
          ``magic_link.delay(email, key, token)`` -- this routes through
          **Celery via RabbitMQ** (NOT Redis). The Celery worker consumes
          the task and dispatches the email via Django's email backend.

    Pre-condition:
        ``Instance.objects.first().is_setup_done`` must be ``True``;
        otherwise HTTP 400 with ``INSTANCE_NOT_CONFIGURED``.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        """Validate email, mint code to Redis, enqueue Celery email task."""
        # Check if instance is configured
        instance = Instance.objects.first()
        if instance is None or not instance.is_setup_done:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INSTANCE_NOT_CONFIGURED"],
                error_message="INSTANCE_NOT_CONFIGURED",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        email = request.data.get("email", "").strip().lower()
        try:
            validate_email(email)
            adapter = MagicCodeProvider(request=request, key=email)
            key, token = adapter.initiate()
            # If the smtp is configured send through here
            magic_link.delay(email, key, token)
            return Response({"key": str(key)}, status=status.HTTP_200_OK)
        except AuthenticationException as e:
            return Response(e.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)


class MagicSignInSpaceEndpoint(View):
    """Magic-code sign-in for an EXISTING space-tenant user.

    HTTP method / URL:
        ``POST /auth/spaces/magic-sign-in/``

    Permission:
        Django :class:`~django.views.View` subclass (not DRF). Anonymous
        access required.

    Request body (POST form):
        * ``code`` (str, required) -- magic code originally sent to the
          user's email; verified against the value cached in Redis under
          ``magic_<email>``.
        * ``email`` (str, required) -- normalized to
          ``email.strip().lower()``.
        * ``next_path`` (str, optional) -- post-auth redirect destination.

    Response:
        HTTP 302 redirect -- on success to ``base_host(request,
        is_space=True) + validate_next_path(next_path)`` (gated by
        :func:`url_has_allowed_host_and_scheme`); on failure to
        ``base_host(request, is_space=True)`` with
        :meth:`AuthenticationException.get_error_dict` query params.

    Error codes:
        ``MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED``, ``USER_DOES_NOT_EXIST``,
        plus any code raised by :meth:`MagicCodeProvider.authenticate`.

    Pre-condition:
        A :class:`User` row must already exist for the supplied email;
        otherwise redirect with ``USER_DOES_NOT_EXIST``.

    Side effects:
        * Reads the magic code from **Redis** via
          :meth:`MagicCodeProvider.authenticate` (key ``magic_<email>``);
          the provider deletes the code on successful consumption
          (Redis = cache / ephemeral auth data only).
        * On success: :func:`user_login` with ``is_space=True`` writes
          the Django session to the PostgreSQL-backed session store via
          the ``plane.db.models.session`` engine (NOT Redis).
    """

    def post(self, request):
        """Verify code against Redis, log in the existing user, and redirect safely."""
        # set the referer as session to redirect after login
        code = request.POST.get("code", "").strip()
        email = request.POST.get("email", "").strip().lower()
        next_path = request.POST.get("next_path")

        if code == "" or email == "":
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED"],
                error_message="MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)

        existing_user = User.objects.filter(email=email).first()

        if not existing_user:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["USER_DOES_NOT_EXIST"],
                error_message="USER_DOES_NOT_EXIST",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)

        # Active User
        try:
            provider = MagicCodeProvider(request=request, key=f"magic_{email}", code=code)
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
                base_url=base_host(request=request, is_space=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)


class MagicSignUpSpaceEndpoint(View):
    """Magic-code sign-up for a NEW space-tenant user.

    HTTP method / URL:
        ``POST /auth/spaces/magic-sign-up/``

    Permission:
        Django :class:`~django.views.View` subclass (not DRF). Anonymous
        access required -- this view CREATES the user.

    Request body (POST form):
        * ``code`` (str, required) -- magic code originally sent to the
          user's email; verified against the value cached in Redis under
          ``magic_<email>``.
        * ``email`` (str, required) -- normalized to
          ``email.strip().lower()``.
        * ``next_path`` (str, optional) -- post-auth redirect destination.

    Response:
        HTTP 302 redirect -- on success to ``base_host(request,
        is_space=True) + validate_next_path(next_path)`` (gated by
        :func:`url_has_allowed_host_and_scheme`); on failure to
        ``base_host(request, is_space=True)`` with
        :meth:`AuthenticationException.get_error_dict` query params.

    Error codes:
        ``MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED``, ``USER_ALREADY_EXIST``,
        plus any code raised by :meth:`MagicCodeProvider.authenticate`
        when ``is_signup`` semantics apply.

    Pre-condition:
        NO :class:`User` row may exist for the supplied email; if one
        does, redirect with ``USER_ALREADY_EXIST``.

    Side effects:
        * Reads the magic code from **Redis** via
          :meth:`MagicCodeProvider.authenticate` (Redis = cache /
          ephemeral auth data only).
        * Creates a new :class:`User` row inside the provider's
          ``authenticate`` flow.
        * On success: :func:`user_login` with ``is_space=True`` writes
          the Django session to the PostgreSQL-backed session store via
          the ``plane.db.models.session`` engine (NOT Redis).
        * Does NOT directly enqueue Celery tasks from this view;
          downstream post-create signal handlers may enqueue tasks via
          RabbitMQ.
    """

    def post(self, request):
        """Verify code against Redis, create the new user, log in, and redirect safely."""
        # set the referer as session to redirect after login
        code = request.POST.get("code", "").strip()
        email = request.POST.get("email", "").strip().lower()
        next_path = request.POST.get("next_path")

        if code == "" or email == "":
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED"],
                error_message="MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)
        # Existing User
        existing_user = User.objects.filter(email=email).first()
        # Already existing
        if existing_user:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["USER_ALREADY_EXIST"],
                error_message="USER_ALREADY_EXIST",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_space=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)

        try:
            provider = MagicCodeProvider(request=request, key=f"magic_{email}", code=code)
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
                base_url=base_host(request=request, is_space=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)
