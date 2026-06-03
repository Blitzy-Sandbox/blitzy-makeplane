# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Space-scoped password recovery: forgot-password initiation and reset completion.

Three documented artifacts implement the public-space / tenant password
recovery flow:

  * :func:`generate_password_token` — module-level helper. Produces the
    ``(uidb64, token)`` pair embedded in the reset link.
  * :class:`ForgotPasswordSpaceEndpoint` —
    ``POST /auth/spaces/forgot-password/``. DRF :class:`APIView`
    (``AllowAny`` + throttled). Validates email, mints the reset token,
    and enqueues the email-delivery Celery task.
  * :class:`ResetPasswordSpaceEndpoint` —
    ``POST /auth/spaces/reset-password/<uidb64>/<token>/``. Django
    :class:`View`. Decodes the token, enforces password strength via
    :func:`zxcvbn` (score ≥ 3), updates the user's password, and
    redirects.

This module is the ``is_space=True`` mirror of
:mod:`plane.authentication.views.app.password_management` — view-class
shapes and validation rules mirror the app surface; only the
host-resolution flag switches to ``is_space=True``.

Async infrastructure (per AAP §0.2.2 — critical distinction):
    * The forgot-password email is dispatched via **Celery via RabbitMQ**:
      ``forgot_password.delay(first_name, email, uidb64, token,
      current_site)`` enqueues
      :func:`plane.bgtasks.forgot_password_task.forgot_password` for a
      Celery worker to consume from the RabbitMQ broker.
    * The password hash itself is written **synchronously to PostgreSQL**
      by :meth:`ResetPasswordSpaceEndpoint.post` via
      ``user.set_password(...)`` + ``user.save()`` — no Celery, no Redis,
      no cache invalidation. The post-reset flow returns directly to the
      user.
    * The reset link is signed by Django's
      :class:`~django.contrib.auth.tokens.PasswordResetTokenGenerator`,
      which is stateless (no Redis, no DB row). Token validity is
      verified by recomputing the signature against the user's current
      state; the link is single-use by design because consuming it
      changes the user's password hash, which invalidates the signature.

Strength enforcement:
    :func:`zxcvbn` is invoked with the candidate password; if
    ``results["score"] < 3`` the reset is rejected with the
    ``PASSWORD_TOO_WEAK`` error code and the browser is redirected to
    ``/accounts/reset-password/`` with the error encoded in the query
    string.

SMTP pre-check (forgot-password only):
    Reads ``EMAIL_HOST``, ``EMAIL_HOST_USER``, and ``EMAIL_HOST_PASSWORD``
    from :func:`get_configuration_value` (runtime instance config with
    ``os.environ`` fallback) and rejects with ``SMTP_NOT_CONFIGURED`` if
    ``EMAIL_HOST`` is unset — there's no point enqueueing an email task
    that will fail at delivery time.

Error codes routed through this module:
    ``INSTANCE_NOT_CONFIGURED``, ``SMTP_NOT_CONFIGURED``, ``INVALID_EMAIL``,
    ``USER_DOES_NOT_EXIST``, ``INVALID_PASSWORD_TOKEN``,
    ``EXPIRED_PASSWORD_TOKEN``, ``INVALID_PASSWORD``, ``PASSWORD_TOO_WEAK``.
"""

# Python imports
import os
from urllib.parse import urlencode

# Third party imports
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from zxcvbn import zxcvbn

# Django imports
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.http import HttpResponseRedirect
from django.utils.encoding import DjangoUnicodeDecodeError, smart_bytes, smart_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.views import View

# Module imports
from plane.bgtasks.forgot_password_task import forgot_password
from plane.license.models import Instance
from plane.db.models import User
from plane.license.utils.instance_value import get_configuration_value
from plane.authentication.utils.host import base_host
from plane.authentication.adapter.error import (
    AuthenticationException,
    AUTHENTICATION_ERROR_CODES,
)
from plane.authentication.rate_limit import AuthenticationThrottle


def generate_password_token(user):
    """Produce the ``(uidb64, token)`` pair for a password-reset URL.

    Encodes the user's primary key via
    :func:`urlsafe_base64_encode(smart_bytes(user.id))` and signs a reset
    token via :class:`PasswordResetTokenGenerator().make_token(user)`. The
    token is stateless — verification recomputes the signature against the
    user's current row state, so any password change or last-login update
    invalidates outstanding tokens (single-use by design).

    Args:
        user: The :class:`User` row to mint a reset token for.

    Returns:
        A ``(uidb64, token)`` tuple suitable for embedding in
        ``/accounts/reset-password/?uidb64=<…>&token=<…>&email=<…>``.

    Consumer:
        :meth:`ForgotPasswordSpaceEndpoint.post` calls this once per
        forgot-password request and passes the result to the
        :func:`forgot_password` Celery task.
    """
    uidb64 = urlsafe_base64_encode(smart_bytes(user.id))
    token = PasswordResetTokenGenerator().make_token(user)

    return uidb64, token


class ForgotPasswordSpaceEndpoint(APIView):
    """Initiate the space-tenant forgot-password flow (email a reset link).

    HTTP method / URL:
        ``POST /auth/spaces/forgot-password/``

    Permission:
        ``permission_classes = [AllowAny]`` — anonymous access required;
        users can't sign in to reset their own password.

    Throttling:
        ``throttle_classes = [AuthenticationThrottle]`` — rate-limited to
        defend against forgot-password enumeration / email-bombing.

    Request body (JSON):
        * ``email`` (str, required) — the address to mail the reset link
          to; validated by Django :func:`validate_email`.

    Response shapes:
        * HTTP 200 —
          ``{"message": "Check your email to reset your password"}``
          returned whenever an account exists for the supplied email.
        * HTTP 400 — :meth:`AuthenticationException.get_error_dict`
          envelope with one of:

            - ``INSTANCE_NOT_CONFIGURED`` — migrator not done.
            - ``SMTP_NOT_CONFIGURED`` — ``EMAIL_HOST`` empty in
              :func:`get_configuration_value` (instance config / env).
            - ``INVALID_EMAIL`` — :func:`validate_email` rejected the
              input.
            - ``USER_DOES_NOT_EXIST`` — no :class:`User` row matches the
              supplied email.

    Side effects (per AAP §0.2.2 — service distinction):
        * Mints a stateless ``(uidb64, token)`` pair via
          :func:`generate_password_token` (no DB write, no cache).
        * Enqueues the email-delivery task via
          ``forgot_password.delay(user.first_name, user.email, uidb64,
          token, current_site)`` — this routes through **Celery via
          RabbitMQ** (NOT Redis). The Celery worker consumes the task and
          dispatches the email via Django's email backend using the
          ``EMAIL_HOST_USER`` / ``EMAIL_HOST_PASSWORD`` credentials read
          from instance config.

    Pre-conditions:
        * ``Instance.objects.first().is_setup_done`` must be ``True``.
        * ``EMAIL_HOST`` must be non-empty in the runtime instance config
          (or environment fallback).
    """

    permission_classes = [AllowAny]

    throttle_classes = [AuthenticationThrottle]

    def post(self, request):
        """Validate input + SMTP config, mint a reset token, enqueue the email Celery task."""
        email = request.data.get("email")

        # Check instance configuration
        instance = Instance.objects.first()
        if instance is None or not instance.is_setup_done:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INSTANCE_NOT_CONFIGURED"],
                error_message="INSTANCE_NOT_CONFIGURED",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        (EMAIL_HOST, EMAIL_HOST_USER, EMAIL_HOST_PASSWORD) = get_configuration_value(
            [
                {"key": "EMAIL_HOST", "default": os.environ.get("EMAIL_HOST")},
                {
                    "key": "EMAIL_HOST_USER",
                    "default": os.environ.get("EMAIL_HOST_USER"),
                },
                {
                    "key": "EMAIL_HOST_PASSWORD",
                    "default": os.environ.get("EMAIL_HOST_PASSWORD"),
                },
            ]
        )

        if not (EMAIL_HOST):
            exc = AuthenticationException(
                error_message="SMTP_NOT_CONFIGURED",
                error_code=AUTHENTICATION_ERROR_CODES["SMTP_NOT_CONFIGURED"],
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_email(email)
        except ValidationError:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INVALID_EMAIL"],
                error_message="INVALID_EMAIL",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        # Get the user
        user = User.objects.filter(email=email).first()
        if user:
            # Get the reset token for user
            uidb64, token = generate_password_token(user=user)
            current_site = base_host(request=request, is_space=True)
            # send the forgot password email
            forgot_password.delay(user.first_name, user.email, uidb64, token, current_site)
            return Response(
                {"message": "Check your email to reset your password"},
                status=status.HTTP_200_OK,
            )
        exc = AuthenticationException(
            error_code=AUTHENTICATION_ERROR_CODES["USER_DOES_NOT_EXIST"],
            error_message="USER_DOES_NOT_EXIST",
        )
        return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)


class ResetPasswordSpaceEndpoint(View):
    """Complete the space-tenant password-reset flow (consume the token, set the new password).

    HTTP method / URL:
        ``POST /auth/spaces/reset-password/<uidb64>/<token>/``

    Permission:
        Django :class:`~django.views.View` subclass (not DRF). Anonymous
        access required — the reset link is the auth credential.

    URL path parameters (from the URLconf):
        * ``uidb64`` (str) — base64-url-encoded :class:`User.id`, decoded
          via :func:`urlsafe_base64_decode` and :func:`smart_str`.
        * ``token`` (str) — signature produced by
          :class:`PasswordResetTokenGenerator`; verified by
          :meth:`PasswordResetTokenGenerator.check_token`.

    Request body (POST form):
        * ``password`` (str, required) — the new password. Must score
          ``>= 3`` on :func:`zxcvbn` strength estimation.

    Response:
        HTTP 302 redirect — on success to ``base_host(request,
        is_space=True)``; on failure to
        ``f"{base_host(request, is_space=True)}/accounts/reset-password/?{urlencode(error_dict)}"``.

    Error codes:
        * ``INVALID_PASSWORD_TOKEN`` — signature didn't verify.
        * ``EXPIRED_PASSWORD_TOKEN`` — base64 decode raised
          :class:`DjangoUnicodeDecodeError` (treated as expired).
        * ``INVALID_PASSWORD`` — empty ``password`` field.
        * ``PASSWORD_TOO_WEAK`` — :func:`zxcvbn` score ``< 3``.

    Side effects (synchronous, no Celery / no Redis):
        * Calls :meth:`User.set_password` which hashes the new password
          using Django's configured hasher.
        * Sets ``User.is_password_autoset = False`` (the user now owns
          their password instead of an auto-generated one).
        * Persists with ``user.save()`` — a synchronous PostgreSQL row
          update.
        * Successful token consumption implicitly invalidates the link
          (changing the password mutates the inputs to
          :class:`PasswordResetTokenGenerator`, so the same token cannot
          be reused).

    Note:
        Unlike :class:`ForgotPasswordSpaceEndpoint`, this view does NOT
        enqueue any Celery task and does NOT touch Redis. The password
        write is a direct PostgreSQL update.
    """

    def post(self, request, uidb64, token):
        """Verify token, enforce strength, write the new password hash, and redirect."""
        try:
            # Decode the id from the uidb64
            id = smart_str(urlsafe_base64_decode(uidb64))
            user = User.objects.get(id=id)

            # check if the token is valid for the user
            if not PasswordResetTokenGenerator().check_token(user, token):
                exc = AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["INVALID_PASSWORD_TOKEN"],
                    error_message="INVALID_PASSWORD_TOKEN",
                )
                params = exc.get_error_dict()
                url = f"{base_host(request=request, is_space=True)}/accounts/reset-password/?{urlencode(params)}"
                return HttpResponseRedirect(url)

            password = request.POST.get("password", False)

            if not password:
                exc = AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["INVALID_PASSWORD"],
                    error_message="INVALID_PASSWORD",
                )
                url = f"{base_host(request=request, is_space=True)}/accounts/reset-password/?{urlencode(exc.get_error_dict())}"  # noqa: E501
                return HttpResponseRedirect(url)

            # Check the password complexity
            results = zxcvbn(password)
            if results["score"] < 3:
                exc = AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["PASSWORD_TOO_WEAK"],
                    error_message="PASSWORD_TOO_WEAK",
                )
                url = f"{base_host(request=request, is_space=True)}/accounts/reset-password/?{urlencode(exc.get_error_dict())}"  # noqa: E501
                return HttpResponseRedirect(url)

            # set_password also hashes the password that the user will get
            user.set_password(password)
            user.is_password_autoset = False
            user.save()

            return HttpResponseRedirect(base_host(request=request, is_space=True))
        except DjangoUnicodeDecodeError:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["EXPIRED_PASSWORD_TOKEN"],
                error_message="EXPIRED_PASSWORD_TOKEN",
            )
            url = f"{base_host(request=request, is_space=True)}/accounts/reset-password/?{urlencode(exc.get_error_dict())}"  # noqa: E501
            return HttpResponseRedirect(url)
