# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Canonical error vocabulary for the Plane authentication subsystem.

Defines two artifacts consumed across the entire auth surface:

* :data:`AUTHENTICATION_ERROR_CODES` -- a frozen mapping of string
  identifiers to stable numeric error codes in the ``5000-5999``
  range. The numeric codes are an architectural contract the Plane web
  frontend depends on for error rendering and localization; renumbering,
  renaming, or removing an entry is a breaking change.
* :class:`AuthenticationException` -- a custom :exc:`Exception` that
  carries a numeric ``error_code``, a string ``error_message``, and an
  optional structured ``payload`` (e.g. the offending ``email`` or
  ``provider``). :meth:`AuthenticationException.get_error_dict`
  serializes the exception into the response-ready envelope consumed by
  :func:`~plane.authentication.adapter.exception.auth_exception_handler`
  and by every view that catches and re-raises into a DRF
  :class:`~rest_framework.response.Response`.

Numeric range partitioning (mirroring the inline section comments in
:data:`AUTHENTICATION_ERROR_CODES`):

============  =========================================================
Range         Concern
============  =========================================================
5000-5019     Global -- instance config, email validity, signup
              enable, login enable, deactivation
5020-5025     Password strength + SMTP configuration
5030-5056     Sign Up failures
5060-5085     Sign In failures
5090-5102     Magic code (sign-in + sign-up overlap)
5104-5123     OAuth (provider-not-configured + provider-error mapping)
5125-5130     Reset Password
5135-5140     Change Password
5145          Set Password (password already set)
5150-5190     Admin authentication
5900          Rate limit exceeded
5999          Unknown / fallback authentication failure
============  =========================================================

The class is intentionally a plain :exc:`Exception` (NOT a subclass of
:class:`rest_framework.exceptions.APIException`) so it can be raised
from non-DRF contexts -- signal handlers, Celery task chains, and the
OAuth adapter's :mod:`requests` failure path -- without coupling those
call sites to the DRF response cycle.

Consumers:

* :mod:`plane.authentication.adapter.exception` (DRF exception handler
  ``auth_exception_handler`` that translates Throttled responses into
  ``RATE_LIMIT_EXCEEDED`` envelopes)
* :mod:`plane.authentication.rate_limit` (throttle classes)
* :mod:`plane.authentication.adapter.base` (signup, password,
  email-validation raises)
* :mod:`plane.authentication.adapter.oauth` (OAuth token / user-info
  HTTP failures)
* All view classes in :mod:`plane.authentication.views`
"""

AUTHENTICATION_ERROR_CODES = {
    # Global
    "INSTANCE_NOT_CONFIGURED": 5000,
    "INVALID_EMAIL": 5005,
    "EMAIL_REQUIRED": 5010,
    "SIGNUP_DISABLED": 5015,
    "MAGIC_LINK_LOGIN_DISABLED": 5016,
    "PASSWORD_LOGIN_DISABLED": 5018,
    "USER_ACCOUNT_DEACTIVATED": 5019,
    # Password strength
    "INVALID_PASSWORD": 5020,
    "PASSWORD_TOO_WEAK": 5021,
    "SMTP_NOT_CONFIGURED": 5025,
    # Sign Up
    "USER_ALREADY_EXIST": 5030,
    "AUTHENTICATION_FAILED_SIGN_UP": 5035,
    "REQUIRED_EMAIL_PASSWORD_SIGN_UP": 5040,
    "INVALID_EMAIL_SIGN_UP": 5045,
    "INVALID_EMAIL_MAGIC_SIGN_UP": 5050,
    "MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED": 5055,
    "EMAIL_PASSWORD_AUTHENTICATION_DISABLED": 5056,
    # Sign In
    "USER_DOES_NOT_EXIST": 5060,
    "AUTHENTICATION_FAILED_SIGN_IN": 5065,
    "REQUIRED_EMAIL_PASSWORD_SIGN_IN": 5070,
    "INVALID_EMAIL_SIGN_IN": 5075,
    "INVALID_EMAIL_MAGIC_SIGN_IN": 5080,
    "MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED": 5085,
    # Both Sign in and Sign up for magic
    "INVALID_MAGIC_CODE_SIGN_IN": 5090,
    "INVALID_MAGIC_CODE_SIGN_UP": 5092,
    "EXPIRED_MAGIC_CODE_SIGN_IN": 5095,
    "EXPIRED_MAGIC_CODE_SIGN_UP": 5097,
    "EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_IN": 5100,
    "EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_UP": 5102,
    # Oauth
    "OAUTH_NOT_CONFIGURED": 5104,
    "GOOGLE_NOT_CONFIGURED": 5105,
    "GITHUB_NOT_CONFIGURED": 5110,
    "GITHUB_USER_NOT_IN_ORG": 5122,
    "GITLAB_NOT_CONFIGURED": 5111,
    "GITEA_NOT_CONFIGURED": 5112,
    "GOOGLE_OAUTH_PROVIDER_ERROR": 5115,
    "GITHUB_OAUTH_PROVIDER_ERROR": 5120,
    "GITLAB_OAUTH_PROVIDER_ERROR": 5121,
    "GITEA_OAUTH_PROVIDER_ERROR": 5123,
    # Reset Password
    "INVALID_PASSWORD_TOKEN": 5125,
    "EXPIRED_PASSWORD_TOKEN": 5130,
    # Change password
    "INCORRECT_OLD_PASSWORD": 5135,
    "MISSING_PASSWORD": 5138,
    "INVALID_NEW_PASSWORD": 5140,
    # set password
    "PASSWORD_ALREADY_SET": 5145,
    # Admin
    "ADMIN_ALREADY_EXIST": 5150,
    "REQUIRED_ADMIN_EMAIL_PASSWORD_FIRST_NAME": 5155,
    "INVALID_ADMIN_EMAIL": 5160,
    "INVALID_ADMIN_PASSWORD": 5165,
    "REQUIRED_ADMIN_EMAIL_PASSWORD": 5170,
    "ADMIN_AUTHENTICATION_FAILED": 5175,
    "ADMIN_USER_ALREADY_EXIST": 5180,
    "ADMIN_USER_DOES_NOT_EXIST": 5185,
    "ADMIN_USER_DEACTIVATED": 5190,
    # Rate limit
    "RATE_LIMIT_EXCEEDED": 5900,
    # Unknown
    "AUTHENTICATION_FAILED": 5999,
}


class AuthenticationException(Exception):
    """Carrier for a structured Plane authentication failure.

    Pairs a numeric ``error_code`` (from
    :data:`AUTHENTICATION_ERROR_CODES`), a string ``error_message``, and
    an optional structured ``payload`` (e.g. the offending ``email`` or
    ``provider`` identifier). Designed to be raised from anywhere in the
    authentication surface and translated into a uniform HTTP response
    body by either the DRF exception handler in
    :mod:`plane.authentication.adapter.exception` or by per-view
    ``try``/``except`` blocks that hand the result of
    :meth:`get_error_dict` directly to a
    :class:`~rest_framework.response.Response`.

    The numeric code is the contract the frontend reads; the string
    message is a stable machine-readable label (NOT a user-facing
    sentence -- the frontend renders the localized copy keyed by
    ``error_code``). The ``payload`` dict is merged flat into the
    response body by :meth:`get_error_dict`, so payload keys must not
    collide with ``error_code`` or ``error_message``.

    Subclasses :class:`Exception` (not
    :class:`rest_framework.exceptions.APIException`) so it remains
    raisable from non-DRF contexts (signal handlers, Celery tasks,
    OAuth :mod:`requests` failure paths).
    """

    error_code = None
    error_message = None
    payload = {}

    def __init__(self, error_code, error_message, payload={}):
        """Construct an authentication failure with a code, message, and payload.

        Args:
            error_code: Numeric code from
                :data:`AUTHENTICATION_ERROR_CODES` (e.g. ``5005`` for
                ``INVALID_EMAIL``).
            error_message: Stable machine-readable label matching the
                ``AUTHENTICATION_ERROR_CODES`` key (e.g.
                ``"INVALID_EMAIL"``). The Plane frontend renders the
                localized user-facing copy keyed by ``error_code`` --
                this string is for logs, tests, and machine consumers.
            payload: Optional structured context (e.g.
                ``{"email": user_email}``) that is merged flat into the
                error envelope by :meth:`get_error_dict`. Keys must not
                collide with ``error_code`` or ``error_message``.
        """
        self.error_code = error_code
        self.error_message = error_message
        self.payload = payload

    def get_error_dict(self):
        """Serialize the exception into the response-ready envelope.

        Returns the canonical Plane authentication error body shape:
        ``{"error_code": <int>, "error_message": <str>, ...payload}``.
        The ``payload`` keys are merged flat onto the top-level envelope
        (not nested under a ``"payload"`` key) so the frontend can read
        offending values like ``email`` or ``provider`` directly off the
        response body without descending into a sub-object.

        Returns:
            dict: The response-ready error envelope.
        """
        error = {"error_code": self.error_code, "error_message": self.error_message}
        for key in self.payload:
            error[key] = self.payload[key]

        return error
