# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Shared authentication endpoints for the Plane API.

Cross-context (app + space) authentication endpoints used directly by the
auth URLconf (``apps/api/plane/authentication/urls.py``):

  * :class:`CSRFTokenEndpoint`       -- issues a CSRF token for browser
                                       clients (``GET /auth/get-csrf-token/``)
  * :func:`csrf_failure`             -- Django CSRF failure handler bound by
                                       ``settings.CSRF_FAILURE_VIEW``
  * :class:`ChangePasswordEndpoint`  -- authenticated password change
                                       (``POST /auth/change-password/``)
  * :class:`SetUserPasswordEndpoint` -- first-time password set for accounts
                                       whose password is still auto-set
                                       (``POST /auth/set-password/``)

Password endpoints enforce strength via :func:`zxcvbn` (score >= 3 required)
and refresh the session through :func:`user_login` so the post-rotation
session reflects the new credentials. All error paths return the
standardized envelope from :meth:`AuthenticationException.get_error_dict`
keyed by an :data:`AUTHENTICATION_ERROR_CODES` entry so the auth error
surface is consistent across app and space contexts.

Architectural notes (per AAP 0.2.2):

  * Session storage is PostgreSQL-backed via the custom
    ``plane.db.models.session`` engine (see ``SESSION_ENGINE`` in
    ``apps/api/plane/settings/common.py``). Redis is used for caching
    and selected ephemeral auth data only -- it is NOT the Django
    session backend, and Plane does NOT use Redis as a task broker
    (Celery jobs route through RabbitMQ elsewhere in the auth
    subsystem).
  * The migrator container has already run schema migrations by the time
    this module is imported; ``User`` queries assume the target revision.
"""

# Django imports
from django.shortcuts import render

# Third party imports
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from zxcvbn import zxcvbn

## Module imports
from plane.app.serializers import UserSerializer
from plane.authentication.utils.login import user_login
from plane.db.models import User
from plane.authentication.adapter.error import (
    AuthenticationException,
    AUTHENTICATION_ERROR_CODES,
)
from django.middleware.csrf import get_token
from plane.utils.cache import invalidate_cache
from plane.authentication.utils.host import base_host


class CSRFTokenEndpoint(APIView):
    """Issue a CSRF token for unauthenticated browser clients.

    HTTP method / URL:
        ``GET /auth/get-csrf-token/``

    Permission:
        ``permission_classes = [AllowAny]`` -- clients fetch the CSRF token
        BEFORE they can authenticate, so this endpoint must be anonymous.

    Request body:
        None (GET).

    Response (HTTP 200):
        ``{"csrf_token": <str>}``

    Side effects:
        Invoking :func:`django.middleware.csrf.get_token` causes Django's
        CSRF middleware to set the ``csrftoken`` cookie on the response.
        No database writes.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        """Return ``{"csrf_token": <str>}`` and set the ``csrftoken`` cookie."""
        # Generate a CSRF token
        csrf_token = get_token(request)
        # Return the CSRF token in a JSON response
        return Response({"csrf_token": str(csrf_token)}, status=status.HTTP_200_OK)


def csrf_failure(request, reason=""):
    """Render the project's CSRF-failure HTML page.

    Bound by ``settings.CSRF_FAILURE_VIEW`` and invoked by Django's CSRF
    middleware whenever a request fails CSRF verification. Renders
    ``csrf_failure.html`` with the failure ``reason`` and the resolved root
    host URL (via :func:`base_host`) so the template can present a
    context-appropriate error and recovery link.

    Args:
        request: The Django request that failed CSRF verification.
        reason: Short failure reason supplied by Django's CSRF middleware.

    Returns:
        An :class:`HttpResponse` rendering ``csrf_failure.html``.
    """
    return render(
        request,
        "csrf_failure.html",
        {"reason": reason, "root_url": base_host(request=request)},
    )


class ChangePasswordEndpoint(APIView):
    """Authenticated password change for the current user.

    HTTP method / URL:
        ``POST /auth/change-password/``

    Effective permission:
        Inherits DRF's ``DEFAULT_PERMISSION_CLASSES`` (configured to
        :class:`IsAuthenticated` in ``plane/settings/common.py``); this
        endpoint requires an authenticated session and does not declare its
        own ``permission_classes`` attribute.

    Request body (JSON):
        * ``old_password`` (str) -- required when
          ``request.user.is_password_autoset`` is ``False``; verified via
          :meth:`User.check_password`.
        * ``new_password`` (str, required) -- must score >= 3 on
          :func:`zxcvbn` strength estimation.

    Response shapes:
        * HTTP 200 -- ``{"message": "Password updated successfully"}``
        * HTTP 400 -- :meth:`AuthenticationException.get_error_dict` envelope
          with error code ``MISSING_PASSWORD``, ``INCORRECT_OLD_PASSWORD``,
          or ``PASSWORD_TOO_WEAK``.

    Side effects:
        * Hashes the new password (``User.set_password``).
        * Sets ``is_password_autoset = False``.
        * Persists the user row (``user.save()``).
        * Refreshes the PostgreSQL-backed Django session via
          :func:`user_login` with ``is_app=True`` so subsequent requests
          use the new credentials.
    """

    def post(self, request):
        """Validate inputs, update the password hash, and refresh the session."""
        user = User.objects.get(pk=request.user.id)

        # If the user password is not autoset then we need to check the old passwords
        if not user.is_password_autoset:
            old_password = request.data.get("old_password", False)
            if not old_password:
                exc = AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["MISSING_PASSWORD"],
                    error_message="MISSING_PASSWORD",
                    payload={"error": "Old password is missing"},
                )
                return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        # Get the new password
        new_password = request.data.get("new_password", False)

        if not new_password:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["MISSING_PASSWORD"],
                error_message="MISSING_PASSWORD",
                payload={"error": "Old or new password is missing"},
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        # If the user password is not autoset then we need to check the old passwords
        if not user.is_password_autoset and not user.check_password(old_password):
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INCORRECT_OLD_PASSWORD"],
                error_message="INCORRECT_OLD_PASSWORD",
                payload={"error": "Old password is not correct"},
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        # check the password score
        results = zxcvbn(new_password)
        if results["score"] < 3:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["PASSWORD_TOO_WEAK"],
                error_message="PASSWORD_TOO_WEAK",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        # set_password also hashes the password that the user will get
        user.set_password(new_password)
        user.is_password_autoset = False
        user.save()
        user_login(user=user, request=request, is_app=True)
        return Response({"message": "Password updated successfully"}, status=status.HTTP_200_OK)


class SetUserPasswordEndpoint(APIView):
    """First-time password set for auto-set-password accounts.

    Used when a user is created with an auto-generated
    (``is_password_autoset == True``) password (e.g., after OAuth-only or
    magic-link signup) and is now choosing a user-defined password for the
    first time. Refuses if the user already has a self-chosen password.

    HTTP method / URL:
        ``POST /auth/set-password/``

    Effective permission:
        Inherits DRF's ``DEFAULT_PERMISSION_CLASSES`` (configured to
        :class:`IsAuthenticated` in ``plane/settings/common.py``); this
        endpoint requires an authenticated session and does not declare its
        own ``permission_classes`` attribute.

    Pre-condition:
        ``request.user.is_password_autoset`` must be ``True``. If ``False``,
        the endpoint returns HTTP 400 with the ``PASSWORD_ALREADY_SET``
        error code instructing the client to use the profile-level password
        change flow instead.

    Request body (JSON):
        * ``password`` (str, required) -- must score >= 3 on :func:`zxcvbn`
          strength estimation.

    Response shapes:
        * HTTP 200 -- full :class:`UserSerializer` payload reflecting the
          updated password state (``is_password_autoset == False``).
        * HTTP 400 -- :meth:`AuthenticationException.get_error_dict` envelope
          with error code ``PASSWORD_ALREADY_SET`` or ``INVALID_PASSWORD``.

    Side effects:
        * Hashes the new password (``User.set_password``).
        * Sets ``is_password_autoset = False``.
        * Persists the user row.
        * Refreshes the PostgreSQL-backed Django session via
          :func:`user_login` with ``is_app=True``.
        * Invalidates the cached ``/api/users/me/`` response via
          :func:`invalidate_cache` so subsequent ``GET /users/me/`` returns
          the new password state.
    """

    @invalidate_cache("/api/users/me/")
    def post(self, request):
        """Validate, set first-time password, refresh session, invalidate ``/users/me/`` cache."""
        user = User.objects.get(pk=request.user.id)
        password = request.data.get("password", False)

        # If the user password is not autoset then return error
        if not user.is_password_autoset:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["PASSWORD_ALREADY_SET"],
                error_message="PASSWORD_ALREADY_SET",
                payload={"error": "Your password is already set please change your password from profile"},
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        # Check password validation
        if not password:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INVALID_PASSWORD"],
                error_message="INVALID_PASSWORD",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        results = zxcvbn(password)
        if results["score"] < 3:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INVALID_PASSWORD"],
                error_message="INVALID_PASSWORD",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        # Set the user password
        user.set_password(password)
        user.is_password_autoset = False
        user.save()
        # Login the user as the session is invalidated
        user_login(user=user, request=request, is_app=True)
        # Return the user
        serializer = UserSerializer(user)
        return Response(serializer.data, status=status.HTTP_200_OK)
