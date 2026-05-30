# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Email-preflight endpoint for the Plane app authentication flow.

This module exposes :class:`EmailCheckEndpoint` -- the public, throttled,
``AllowAny`` DRF endpoint mounted at ``POST /auth/email-check/`` (registered
in ``apps/api/plane/authentication/urls.py`` and prefixed under ``auth/`` by
``apps/api/plane/urls.py``). Browser clients call it with a candidate email
*before* showing a password vs. magic-link prompt; the endpoint reports
whether a :class:`plane.db.models.User` already exists with that email and
which sign-in flow the client should drive next -- ``MAGIC_CODE`` or
``CREDENTIAL`` -- based on the deployment's SMTP and magic-link
configuration.

The decision matrix is:

  * SMTP configured AND magic-link enabled AND
    (no existing user OR existing user with ``is_password_autoset=True``)
    -> ``MAGIC_CODE``.
  * Otherwise -> ``CREDENTIAL``.

Architectural notes (per AAP section 0.2.2):

  * Reads :class:`plane.license.models.Instance` and
    :class:`plane.db.models.User` from PostgreSQL -- schema state assumes
    the ``migrator`` container has already run Django migrations before
    this view is reachable.
  * No Redis and no RabbitMQ involvement; no Celery task is enqueued from
    this module. Unlike
    :class:`plane.authentication.views.app.magic.MagicGenerateEndpoint`
    (which writes a magic code to Redis and dispatches an email via
    Celery), this endpoint is a pure read-only decision point.
  * Errors are returned through the standardized
    :meth:`plane.authentication.adapter.error.AuthenticationException.get_error_dict`
    envelope keyed by
    :data:`plane.authentication.adapter.error.AUTHENTICATION_ERROR_CODES`.
  * Anonymous access is intentional (``permission_classes = [AllowAny]``)
    because the caller is on the pre-login screen. The rate-limit
    surface for email-enumeration probing is bounded by
    :class:`plane.authentication.rate_limit.AuthenticationThrottle`.
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
    AuthenticationException,
    AUTHENTICATION_ERROR_CODES,
)
from plane.authentication.rate_limit import AuthenticationThrottle
from plane.license.utils.instance_value import get_configuration_value


class EmailCheckEndpoint(APIView):
    """Decide whether an email should authenticate via magic-link or credentials.

    HTTP method / URL:
        ``POST /auth/email-check/`` (registered in
        ``apps/api/plane/authentication/urls.py``; mounted under the
        ``auth/`` prefix declared in ``apps/api/plane/urls.py``).

    Permission:
        ``permission_classes = [AllowAny]`` -- the caller is pre-login and
        not yet authenticated. Do NOT tighten this; the pre-login client
        cannot present credentials yet.

    Throttling:
        ``throttle_classes = [AuthenticationThrottle]`` -- rate-limited to
        defeat email-enumeration probing. Do NOT remove this throttle:
        an unbounded endpoint that returns ``existing: true/false`` would
        leak the deployment's user list to anonymous scanners.

    Request body (JSON):
        * ``email`` (str, required) -- candidate email address. Read via
          ``request.data.get("email", False)``; the sentinel ``False``
          (not ``None``) is intentional so that an empty submission maps
          to a falsy value that triggers the ``EMAIL_REQUIRED`` branch.
          The value is normalized via ``str(email).lower().strip()``
          before being passed to :func:`django.core.validators.validate_email`.

    Response shapes:
        * HTTP 200 -- ``{"existing": <bool>, "status": "MAGIC_CODE" |
          "CREDENTIAL"}``. ``MAGIC_CODE`` is returned only when SMTP is
          configured (``EMAIL_HOST`` non-empty) AND
          ``ENABLE_MAGIC_LINK_LOGIN == "1"`` AND
          (no existing user OR the existing user has
          ``is_password_autoset == True``); otherwise ``CREDENTIAL``. The
          ``is_password_autoset`` branch is what distinguishes an
          OAuth/magic-link-only user (no password ever set, so route them
          to magic-link) from a user who has a password (route them to
          the credential form they already know).
        * HTTP 400 --
          :meth:`plane.authentication.adapter.error.AuthenticationException.get_error_dict`
          envelope with one of these
          :data:`plane.authentication.adapter.error.AUTHENTICATION_ERROR_CODES`
          codes:

            - ``INSTANCE_NOT_CONFIGURED`` -- ``Instance.objects.first()``
              is ``None`` or ``instance.is_setup_done`` is falsy. This
              is the deployment-readiness gate; every authentication
              view in this folder short-circuits on it.
            - ``EMAIL_REQUIRED`` -- ``email`` is missing or empty.
            - ``INVALID_EMAIL`` -- :func:`validate_email` raised
              :class:`django.core.exceptions.ValidationError`.

    Configuration lookup:
        ``EMAIL_HOST`` and ``ENABLE_MAGIC_LINK_LOGIN`` are resolved via
        :func:`plane.license.utils.instance_value.get_configuration_value`,
        which prefers values from the :class:`InstanceConfiguration`
        table (when ``settings.SKIP_ENV_VAR`` is truthy) and otherwise
        falls back to the corresponding ``os.environ`` entries.

    Side effects:
        Read-only. No database writes, no session writes, no Celery
        enqueue, no redirects, no Redis interaction. This endpoint
        returns a JSON decision payload only.
    """

    permission_classes = [AllowAny]

    throttle_classes = [AuthenticationThrottle]

    def post(self, request):
        """Return the recommended sign-in flow (``MAGIC_CODE``/``CREDENTIAL``) for ``email``."""
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

        # Lower the email
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
