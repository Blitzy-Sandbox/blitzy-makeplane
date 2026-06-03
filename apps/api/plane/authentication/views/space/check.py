# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Email-auth preflight endpoint for the space-tenant surface.

Exposes :class:`EmailCheckSpaceEndpoint` (``POST /auth/spaces/email-check/``)
which the space-tenant frontend hits BEFORE choosing between password
credentials and magic-link flows. The response narrows the next step to
either ``"MAGIC_CODE"`` (email-only flow) or ``"CREDENTIAL"`` (email +
password flow) based on:

  * Whether the supplied email already maps to a :class:`User` row
    (``existing``).
  * Whether the instance is configured for SMTP delivery (``EMAIL_HOST``).
  * Whether magic-link login is enabled at the instance level
    (``ENABLE_MAGIC_LINK_LOGIN == "1"``).
  * For existing users, whether the user's password is still auto-set
    (``is_password_autoset``).

This module is the ``is_space=True`` mirror of
:mod:`plane.authentication.views.app.check` -- the response shape is
identical; only the URL prefix differs (``spaces/email-check/`` here vs.
``email-check/`` there).

The endpoint is throttled by :class:`AuthenticationThrottle` to defend
against email-enumeration abuse since it must remain accessible to anonymous
callers (clients fetch instance-aware auth state BEFORE they can
authenticate). Validation failures return the standardized
:meth:`AuthenticationException.get_error_dict` envelope keyed by an
:data:`AUTHENTICATION_ERROR_CODES` entry.

Startup ordering (per AAP architectural context): the ``migrator`` container
must have completed Django migrations AND ``instance.is_setup_done`` must be
``True`` before a non-error response is produced.

Runtime-configurable knobs (``EMAIL_HOST``, ``ENABLE_MAGIC_LINK_LOGIN``) are
read via :func:`plane.license.utils.instance_value.get_configuration_value`,
which sources values from :class:`InstanceConfiguration` (admin-managed) with
``os.environ`` fallback -- changes take effect on the next request without
requiring a process restart.
"""

# Python imports
import os

# Django imports
from django.core.validators import validate_email
from django.core.exceptions import ValidationError

# Third party imports
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

## Module imports
from plane.db.models import User
from plane.license.models import Instance
from plane.authentication.adapter.error import (
    AUTHENTICATION_ERROR_CODES,
    AuthenticationException,
)
from plane.authentication.rate_limit import AuthenticationThrottle
from plane.license.utils.instance_value import get_configuration_value


class EmailCheckSpaceEndpoint(APIView):
    """Email-auth preflight: tell the client whether to ask for a password or a code.

    HTTP method / URL:
        ``POST /auth/spaces/email-check/`` (registered in
        :mod:`plane.authentication.urls`).

    Permission:
        ``permission_classes = [AllowAny]`` -- anonymous access is required
        because clients fetch instance-aware auth state BEFORE they can
        authenticate.

    Throttling:
        ``throttle_classes = [AuthenticationThrottle]`` -- rate-limited
        (anonymous, 30/minute) to defend against email-enumeration abuse.

    Request body (JSON):
        * ``email`` (str, required) -- normalized to ``email.lower().strip()``
          before validation.

    Response shapes:
        * HTTP 200 -- ``{"existing": <bool>, "status": "MAGIC_CODE" |
          "CREDENTIAL"}`` where:

            - existing users: ``"MAGIC_CODE"`` iff
              ``user.is_password_autoset`` AND SMTP configured AND
              ``ENABLE_MAGIC_LINK_LOGIN == "1"``; else ``"CREDENTIAL"``.
            - new users: ``"MAGIC_CODE"`` iff SMTP configured AND magic-link
              enabled; else ``"CREDENTIAL"``.

        * HTTP 400 -- :meth:`AuthenticationException.get_error_dict` envelope
          keyed by one of ``INSTANCE_NOT_CONFIGURED`` (5000),
          ``EMAIL_REQUIRED`` (5010), or ``INVALID_EMAIL`` (5005) from
          :data:`AUTHENTICATION_ERROR_CODES`.

    Side effects:
        Read-only -- no database writes, no session writes, no email
        dispatch. The endpoint only queries
        :class:`Instance`, :class:`InstanceConfiguration`, and :class:`User`.

    Startup ordering:
        Requires the ``migrator`` container to have completed Django
        migrations AND ``instance.is_setup_done`` to be ``True`` before
        producing a non-error response; otherwise returns
        ``INSTANCE_NOT_CONFIGURED``.
    """

    permission_classes = [AllowAny]

    throttle_classes = [AuthenticationThrottle]

    def post(self, request):
        """Resolve next-step auth (MAGIC_CODE vs CREDENTIAL) for the given email."""
        # Check instance configuration
        instance = Instance.objects.first()
        if instance is None or not instance.is_setup_done:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INSTANCE_NOT_CONFIGURED"],
                error_message="INSTANCE_NOT_CONFIGURED",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        (EMAIL_HOST, ENABLE_MAGIC_LINK_LOGIN) = get_configuration_value(
            [
                {"key": "EMAIL_HOST", "default": os.environ.get("EMAIL_HOST", "")},
                {
                    "key": "ENABLE_MAGIC_LINK_LOGIN",
                    "default": os.environ.get("ENABLE_MAGIC_LINK_LOGIN", "1"),
                },
            ]
        )

        smtp_configured = bool(EMAIL_HOST)
        is_magic_login_enabled = ENABLE_MAGIC_LINK_LOGIN == "1"

        email = request.data.get("email", False)

        # Return error if email is not present
        if not email:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["EMAIL_REQUIRED"],
                error_message="EMAIL_REQUIRED",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        email = str(email).lower().strip()
        # Validate email
        try:
            validate_email(email)
        except ValidationError:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INVALID_EMAIL"],
                error_message="INVALID_EMAIL",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)
        # Check if a user already exists with the given email
        existing_user = User.objects.filter(email=email).first()

        # If existing user
        if existing_user:
            # Return response
            return Response(
                {
                    "existing": True,
                    "status": (
                        "MAGIC_CODE"
                        if existing_user.is_password_autoset and smtp_configured and is_magic_login_enabled
                        else "CREDENTIAL"
                    ),
                },
                status=status.HTTP_200_OK,
            )
        # Else return response
        return Response(
            {
                "existing": False,
                "status": ("MAGIC_CODE" if smtp_configured and is_magic_login_enabled else "CREDENTIAL"),
            },
            status=status.HTTP_200_OK,
        )
