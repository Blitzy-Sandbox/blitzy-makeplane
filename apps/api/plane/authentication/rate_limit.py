# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Authentication throttling for Plane's DRF endpoints.

Defines two DRF throttle subclasses used by the authentication views to
rate-limit anonymous authentication traffic and per-user email-verification
code generation. Both classes convert throttle failures into a standardized
``429 TOO MANY REQUESTS`` response by raising and serializing the project's
``AuthenticationException`` with the ``RATE_LIMIT_EXCEEDED`` error code so the
response shape matches the rest of the authentication error surface.
"""

# Third party imports
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.authentication.adapter.error import (
    AuthenticationException,
    AUTHENTICATION_ERROR_CODES,
)


class AuthenticationThrottle(AnonRateThrottle):
    """Per-IP anonymous-traffic throttle for authentication endpoints.

    Caps anonymous authentication attempts (sign-in, sign-up, magic-link
    generation, OAuth initiation, password recovery) at ``30/minute`` per
    client IP under the DRF scope ``"authentication"``. On throttle failure,
    returns HTTP 429 with the standardized ``RATE_LIMIT_EXCEEDED`` error body
    from ``AuthenticationException`` so the error surface stays consistent
    with the rest of the auth views.
    """

    rate = "30/minute"
    scope = "authentication"

    def throttle_failure_view(self, request, *args, **kwargs):
        """Return a 429 response carrying the ``RATE_LIMIT_EXCEEDED`` error body."""
        try:
            raise AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["RATE_LIMIT_EXCEEDED"],
                error_message="RATE_LIMIT_EXCEEDED",
            )
        except AuthenticationException as e:
            return Response(e.get_error_dict(), status=status.HTTP_429_TOO_MANY_REQUESTS)


class EmailVerificationThrottle(UserRateThrottle):
    """Per-user throttle for email-verification code generation.

    Caps email-verification code generation at ``3/hour`` per authenticated
    user under the DRF scope ``"email_verification"`` to deter abuse of
    code-issuance endpoints. On throttle failure, returns HTTP 429 with the
    standardized ``RATE_LIMIT_EXCEEDED`` error body from
    ``AuthenticationException``.
    """

    rate = "3/hour"
    scope = "email_verification"

    def throttle_failure_view(self, request, *args, **kwargs):
        """Return a 429 response carrying the ``RATE_LIMIT_EXCEEDED`` error body."""
        try:
            raise AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["RATE_LIMIT_EXCEEDED"],
                error_message="RATE_LIMIT_EXCEEDED",
            )
        except AuthenticationException as e:
            return Response(e.get_error_dict(), status=status.HTTP_429_TOO_MANY_REQUESTS)
