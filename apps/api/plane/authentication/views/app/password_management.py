# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Password recovery endpoints for the Plane app authentication flow.

This module exposes the password-recovery surface on the app side:

  * :func:`generate_password_token` -- helper producing the
    ``(uidb64, token)`` pair embedded in the reset URL.
  * :class:`ForgotPasswordEndpoint` -- ``POST /auth/forgot-password/``.
    Validates the deployment, SMTP configuration, and supplied email,
    locates the :class:`User`, generates the reset token via
    :func:`generate_password_token`, and asynchronously dispatches the
    password-reset email by calling ``forgot_password.delay(...)``.
  * :class:`ResetPasswordEndpoint` --
    ``POST /auth/reset-password/<uidb64>/<token>/``. Decodes the
    base64-encoded user id, verifies the reset token via
    :class:`PasswordResetTokenGenerator`, enforces password strength via
    :func:`zxcvbn` (score >= 3), rotates the password, clears
    ``is_password_autoset``, persists the user, and 302-redirects to
    ``sign-in?success=True``.

Celery handoff -- Celery via RabbitMQ (per AAP section 0.2.2)
-------------------------------------------------------------

``ForgotPasswordEndpoint`` enqueues the email-send via
``forgot_password.delay(user.first_name, user.email, uidb64, token,
current_site)``. This is a Celery ``@shared_task`` defined in
``apps/api/plane/bgtasks/forgot_password_task.py`` that publishes to
**RabbitMQ** -- the Plane Celery broker. Workers consuming the queue
build the reset URL
(``<current_site>/accounts/reset-password/?uidb64=<uidb64>&token=
<token>&email=<email>``) and send it via Django's
``EmailMultiAlternatives``.

**Redis is NOT a task broker in Plane.** Redis is used only for caching
and session storage. ``ResetPasswordEndpoint`` does not refresh the
session itself; on success it redirects the browser to ``sign-in/``
where the user re-authenticates with the new password.

Token contract
--------------

:func:`generate_password_token` returns ``(uidb64, token)``:

  * ``uidb64 = urlsafe_base64_encode(smart_bytes(user.id))``
  * ``token  = PasswordResetTokenGenerator().make_token(user)``

The reset endpoint reverses this by:

  * ``smart_str(urlsafe_base64_decode(uidb64))`` -> user id
  * ``PasswordResetTokenGenerator().check_token(user, token)``

Django's :class:`PasswordResetTokenGenerator` ties tokens to
``user.password`` and ``user.last_login``, so any successful password
rotation invalidates outstanding reset links.

Password strength enforcement
-----------------------------

:func:`zxcvbn` is consulted on the submitted password; ``score < 3`` is
rejected as ``PASSWORD_TOO_WEAK``. The threshold matches the
:class:`ChangePasswordEndpoint` and :class:`SetUserPasswordEndpoint`
strength gates in ``apps/api/plane/authentication/views/common.py``.

Error envelope contracts
------------------------

* :class:`ForgotPasswordEndpoint` returns JSON: success
  ``{"message": "Check your email to reset your password"}`` with HTTP
  200, error :meth:`AuthenticationException.get_error_dict` with HTTP
  400.
* :class:`ResetPasswordEndpoint` returns HTTP 302 redirects. Error
  redirects target ``base_host(is_app=True) + "accounts/reset-password?"
  + urlencode(<error envelope>)``. Success redirects target
  ``base_host(is_app=True) + "sign-in?" + urlencode({"success": True})``.

:data:`AUTHENTICATION_ERROR_CODES` keys raised:

  * ``INSTANCE_NOT_CONFIGURED``
  * ``SMTP_NOT_CONFIGURED``    (forgot path; ``EMAIL_HOST`` empty)
  * ``INVALID_EMAIL``          (forgot path)
  * ``USER_DOES_NOT_EXIST``    (forgot path)
  * ``INVALID_PASSWORD_TOKEN`` (reset path; decode or token-check
                                failure)
  * ``INVALID_PASSWORD``       (reset path; empty ``password`` POST)
  * ``PASSWORD_TOO_WEAK``      (reset path; zxcvbn score < 3)
  * ``EXPIRED_PASSWORD_TOKEN`` (reset path; ``DjangoUnicodeDecodeError``)

Architectural notes (per AAP section 0.2.2):

  * Password-reset email delivery: **Celery via RabbitMQ** (NOT Redis).
  * Redis is used only for caching and selected ephemeral auth data in
    Plane -- NOT for Django sessions. Django sessions are persisted to
    PostgreSQL via the custom ``plane.db.models.session`` engine (see
    ``SESSION_ENGINE`` in ``apps/api/plane/settings/common.py``).
  * Migrator container has already run schema migrations by import time;
    ``User`` queries assume the target revision.
"""

# Python imports
import os
from urllib.parse import urlencode, urljoin

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
    """Return the ``(uidb64, token)`` pair embedded into the password-reset URL.

    Used by :meth:`ForgotPasswordEndpoint.post` to produce the components
    of the reset URL emailed to the user.

    Args:
        user: The :class:`User` instance for whom the reset token is
            being generated.

    Returns:
        A ``(uidb64, token)`` tuple where ``uidb64`` is the
        ``urlsafe_base64_encode(smart_bytes(user.id))`` of the user's
        primary key and ``token`` is
        :meth:`PasswordResetTokenGenerator.make_token` for ``user``.
        Django's token generator ties the token to ``user.password`` and
        ``user.last_login``, so any successful password rotation
        invalidates outstanding tokens.
    """
    uidb64 = urlsafe_base64_encode(smart_bytes(user.id))
    token = PasswordResetTokenGenerator().make_token(user)

    return uidb64, token


class ForgotPasswordEndpoint(APIView):
    """Initiate the password-reset email flow.

    HTTP method / URL:
        ``POST /auth/forgot-password/``

    Permission:
        ``permission_classes = [AllowAny]`` -- the caller is pre-login
        and not yet authenticated.

    Throttling:
        ``throttle_classes = [AuthenticationThrottle]`` -- rate-limited
        to bound reset-email spam and email-enumeration probing.

    Request body (JSON):
        * ``email`` (str, required) -- account email.

    Response shapes:
        * HTTP 200 --
          ``{"message": "Check your email to reset your password"}``.
        * HTTP 400 -- :meth:`AuthenticationException.get_error_dict`
          envelope with one of: ``INSTANCE_NOT_CONFIGURED``,
          ``SMTP_NOT_CONFIGURED``, ``INVALID_EMAIL``,
          ``USER_DOES_NOT_EXIST``.

    Side effects:
        * Reads :class:`Instance.objects.first` (deployment gate).
        * Reads ``EMAIL_HOST`` via :func:`get_configuration_value`;
          returns ``SMTP_NOT_CONFIGURED`` when empty.
        * Calls :func:`generate_password_token` to produce the
          ``(uidb64, token)`` pair.
        * **Enqueues the Celery task**
          ``forgot_password.delay(user.first_name, user.email, uidb64,
          token, current_site)`` (defined in
          ``apps/api/plane/bgtasks/forgot_password_task.py``). The task
          is published to the project's **RabbitMQ** broker and consumed
          by Celery workers that send the password-reset email via
          Django's SMTP configuration. The link points back to
          ``current_site = base_host(request=request, is_app=True)``.
        * No database writes from this view; password rotation happens
          in :class:`ResetPasswordEndpoint`.
    """

    permission_classes = [AllowAny]

    throttle_classes = [AuthenticationThrottle]

    def post(self, request):
        """Validate the request, generate the reset token, and enqueue the email task via RabbitMQ."""
        email = request.data.get("email")

        # Check instance configuration
        instance = Instance.objects.first()
        if instance is None or not instance.is_setup_done:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INSTANCE_NOT_CONFIGURED"],
                error_message="INSTANCE_NOT_CONFIGURED",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        (EMAIL_HOST,) = get_configuration_value([{"key": "EMAIL_HOST", "default": os.environ.get("EMAIL_HOST")}])

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
            current_site = base_host(request=request, is_app=True)
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


class ResetPasswordEndpoint(View):
    """Consume a password-reset link and rotate the user's password.

    HTTP method / URL:
        ``POST /auth/reset-password/<uidb64>/<token>/``

    Inheritance:
        :class:`django.views.View` -- not a DRF ``APIView``. No
        ``permission_classes`` declared; effectively anonymous-accessible
        because the caller has not yet authenticated (the reset link is
        the credential).

    URL parameters:
        * ``uidb64`` (str) -- ``urlsafe_base64_encode`` of ``user.id``,
          embedded in the reset link by
          :class:`ForgotPasswordEndpoint` + the Celery task.
        * ``token`` (str) -- :class:`PasswordResetTokenGenerator` token,
          tied to ``user.password`` + ``user.last_login``.

    Request body (form-encoded POST):
        * ``password`` (str, required) -- new password; must score >= 3
          on :func:`zxcvbn` strength estimation.

    Response shapes:
        * HTTP 302 redirect to ``base_host(is_app=True) + "sign-in?" +
          urlencode({"success": True})`` on success -- the user
          re-authenticates with the new password.
        * HTTP 302 redirect to ``base_host(is_app=True) +
          "accounts/reset-password?" + urlencode(<error envelope>)`` on
          error.

    Side effects (success path):
        * Decodes ``uidb64`` via :func:`urlsafe_base64_decode` to recover
          ``user.id``; loads :class:`User`.
        * Validates ``token`` via
          :meth:`PasswordResetTokenGenerator.check_token`.
        * Validates new password via :func:`zxcvbn` -- rejects score < 3
          with ``PASSWORD_TOO_WEAK``.
        * Calls :meth:`User.set_password` (hashes the password).
        * Sets ``User.is_password_autoset = False`` (the user has now
          deliberately chosen this password).
        * Persists the row via ``user.save()``.

    Error codes:
        ``INVALID_PASSWORD_TOKEN`` (decode failure, missing user, or
        token rejection), ``INVALID_PASSWORD`` (empty POST password),
        ``PASSWORD_TOO_WEAK`` (zxcvbn score < 3),
        ``EXPIRED_PASSWORD_TOKEN`` (``DjangoUnicodeDecodeError``).

    Token invalidation:
        Django's :class:`PasswordResetTokenGenerator` ties tokens to
        ``user.password`` and ``user.last_login``. Successful password
        rotation -- and any subsequent sign-in updating
        ``last_login`` -- invalidates outstanding reset links.
    """

    def post(self, request, uidb64, token):
        """Validate the reset token + new password, rotate the password hash, and redirect."""
        try:
            # Decode the id from the uidb64
            try:
                id = smart_str(urlsafe_base64_decode(uidb64))
                user = User.objects.get(id=id)
            except (ValueError, User.DoesNotExist):
                exc = AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["INVALID_PASSWORD_TOKEN"],
                    error_message="INVALID_PASSWORD_TOKEN",
                )
                params = exc.get_error_dict()
                url = urljoin(
                    base_host(request=request, is_app=True),
                    "accounts/reset-password?" + urlencode(params),
                )
                return HttpResponseRedirect(url)

            # check if the token is valid for the user
            if not PasswordResetTokenGenerator().check_token(user, token):
                exc = AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["INVALID_PASSWORD_TOKEN"],
                    error_message="INVALID_PASSWORD_TOKEN",
                )
                params = exc.get_error_dict()
                url = urljoin(
                    base_host(request=request, is_app=True),
                    "accounts/reset-password?" + urlencode(params),
                )
                return HttpResponseRedirect(url)

            password = request.POST.get("password", False)

            if not password:
                exc = AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["INVALID_PASSWORD"],
                    error_message="INVALID_PASSWORD",
                )
                url = urljoin(
                    base_host(request=request, is_app=True),
                    "accounts/reset-password?" + urlencode(exc.get_error_dict()),
                )
                return HttpResponseRedirect(url)

            # Check the password complexity
            results = zxcvbn(password)
            if results["score"] < 3:
                exc = AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["PASSWORD_TOO_WEAK"],
                    error_message="PASSWORD_TOO_WEAK",
                )
                url = urljoin(
                    base_host(request=request, is_app=True),
                    "accounts/reset-password?" + urlencode(exc.get_error_dict()),
                )
                return HttpResponseRedirect(url)

            # set_password also hashes the password that the user will get
            user.set_password(password)
            user.is_password_autoset = False
            user.save()

            url = urljoin(
                base_host(request=request, is_app=True),
                "sign-in?" + urlencode({"success": True}),
            )
            return HttpResponseRedirect(url)
        except DjangoUnicodeDecodeError:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["EXPIRED_PASSWORD_TOKEN"],
                error_message="EXPIRED_PASSWORD_TOKEN",
            )
            url = urljoin(
                base_host(request=request, is_app=True),
                "accounts/reset-password?" + urlencode(exc.get_error_dict()),
            )
            return HttpResponseRedirect(url)
