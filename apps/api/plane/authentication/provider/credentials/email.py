# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Email/password credential provider for ``plane.authentication``.

This module implements :class:`EmailProvider`, the conventional
username-and-password credential provider that specialises
:class:`plane.authentication.adapter.credential.CredentialAdapter`.

The provider is feature-gated by the instance configuration value
``ENABLE_EMAIL_PASSWORD`` (with ``os.environ.get`` fallback): when set to
``"0"`` the constructor raises
``AuthenticationException(EMAIL_PASSWORD_AUTHENTICATION_DISABLED)``.

The provider itself does NOT write to the database.  Persistence happens
in the inherited ``Adapter.complete_login_or_signup()`` flow (defined in
``plane.authentication.adapter.base``) AFTER :meth:`EmailProvider.set_user_data`
populates the normalised user payload.

The class attribute :attr:`EmailProvider.provider` is the lowercase literal
``"email"`` -- this is the canonical key the adapter layer uses for Account
lookups.
"""

# Python imports
import os

# Module imports
from plane.authentication.adapter.credential import CredentialAdapter
from plane.authentication.adapter.error import (
    AUTHENTICATION_ERROR_CODES,
    AuthenticationException,
)
from plane.db.models import User
from plane.license.utils.instance_value import get_configuration_value


class EmailProvider(CredentialAdapter):
    """Email/password credential provider specialising :class:`CredentialAdapter`.

    Class attribute:

      * ``provider = "email"`` -- key used by the adapter layer to scope
        Account / Provider lookups.

    The class supports a dual sign-in / sign-up flow gated by the
    ``is_signup`` constructor kwarg (default ``False`` = sign-in).

    Error codes raised (see
    :data:`plane.authentication.adapter.error.AUTHENTICATION_ERROR_CODES`):

      * ``EMAIL_PASSWORD_AUTHENTICATION_DISABLED`` -- ``__init__``, when
        ``ENABLE_EMAIL_PASSWORD == "0"``.
      * ``USER_ALREADY_EXIST`` -- :meth:`set_user_data`, when
        ``is_signup=True`` and a user with that email already exists.
      * ``USER_DOES_NOT_EXIST`` -- :meth:`set_user_data`, when
        ``is_signup=False`` and no user with that email is found.
      * ``AUTHENTICATION_FAILED_SIGN_IN`` -- :meth:`set_user_data`, on
        ``user.check_password(self.code)`` failure when
        ``is_signup=False``.
      * ``AUTHENTICATION_FAILED_SIGN_UP`` -- declared in the password-
        check branch as the ``is_signup=True`` variant; the signup
        branch returns before reaching the password check, so this
        variant is observable only by the conditional in the raise
        site itself.

    Normalised user payload on success::

        {
            "email": self.key,
            "user": {
                "avatar": "",
                "first_name": "",
                "last_name": "",
                "provider_id": "",
                "is_password_autoset": False,
            },
        }

    Side effects: NONE in this class.  DB writes occur in the inherited
    ``complete_login_or_signup()`` flow on
    :class:`plane.authentication.adapter.base.Adapter`.
    """

    provider = "email"

    def __init__(self, request, key=None, code=None, is_signup=False, callback=None):
        """Initialise the provider and enforce the feature-gate.

        Parameters:
          * ``request`` -- the Django ``HttpRequest`` forwarded to the
            adapter base.
          * ``key`` -- the email address (user identifier).
          * ``code`` -- the password to verify (sign-in) or set
            (sign-up).
          * ``is_signup`` -- ``True`` for the sign-up branch, ``False``
            (default) for sign-in.
          * ``callback`` -- post-authentication redirect URL forwarded to
            the adapter base.

        Reads ``ENABLE_EMAIL_PASSWORD`` from the instance configuration
        (with ``os.environ`` fallback); when it is ``"0"``, raises
        ``AuthenticationException(EMAIL_PASSWORD_AUTHENTICATION_DISABLED)``.
        """
        super().__init__(request=request, provider=self.provider, callback=callback)
        self.key = key
        self.code = code
        self.is_signup = is_signup

        (ENABLE_EMAIL_PASSWORD,) = get_configuration_value([
            {
                "key": "ENABLE_EMAIL_PASSWORD",
                "default": os.environ.get("ENABLE_EMAIL_PASSWORD"),
            }
        ])

        if ENABLE_EMAIL_PASSWORD == "0":
            raise AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["EMAIL_PASSWORD_AUTHENTICATION_DISABLED"],
                error_message="EMAIL_PASSWORD_AUTHENTICATION_DISABLED",
            )

    def set_user_data(self):
        """Validate the credentials and stage the normalised user payload.

        Branches on ``self.is_signup``:

          * ``is_signup=True`` -- checks
            ``User.objects.filter(email=self.key).exists()`` and raises
            ``USER_ALREADY_EXIST`` on duplicate.  Otherwise delegates
            the normalised payload to
            :meth:`Adapter.set_user_data` and returns.
          * ``is_signup=False`` -- looks up the user via
            ``User.objects.filter(email=self.key).first()``.  Raises
            ``USER_DOES_NOT_EXIST`` when missing; otherwise calls
            ``user.check_password(self.code)`` and raises
            ``AUTHENTICATION_FAILED_SIGN_IN`` (or
            ``AUTHENTICATION_FAILED_SIGN_UP``, per the inline
            conditional) on mismatch.  On success delegates the
            normalised payload and returns.

        Both branches emit blank profile fields (``avatar``,
        ``first_name``, ``last_name``, ``provider_id``); the provider
        does NOT collect those -- downstream user-update flows populate
        them later.
        """
        if self.is_signup:
            # Check if the user already exists
            if User.objects.filter(email=self.key).exists():
                self.logger.warning("User already exists")
                raise AuthenticationException(
                    error_message="USER_ALREADY_EXIST",
                    error_code=AUTHENTICATION_ERROR_CODES["USER_ALREADY_EXIST"],
                )

            super().set_user_data({
                "email": self.key,
                "user": {
                    "avatar": "",
                    "first_name": "",
                    "last_name": "",
                    "provider_id": "",
                    "is_password_autoset": False,
                },
            })
            return
        else:
            user = User.objects.filter(email=self.key).first()

            # User does not exists
            if not user:
                self.logger.warning("User does not exist")
                raise AuthenticationException(
                    error_message="USER_DOES_NOT_EXIST",
                    error_code=AUTHENTICATION_ERROR_CODES["USER_DOES_NOT_EXIST"],
                    payload={"email": self.key},
                )

            # Check user password
            if not user.check_password(self.code):
                self.logger.warning("Authentication failed - invalid credentials")
                raise AuthenticationException(
                    error_message=(
                        "AUTHENTICATION_FAILED_SIGN_UP" if self.is_signup else "AUTHENTICATION_FAILED_SIGN_IN"
                    ),
                    error_code=AUTHENTICATION_ERROR_CODES[
                        ("AUTHENTICATION_FAILED_SIGN_UP" if self.is_signup else "AUTHENTICATION_FAILED_SIGN_IN")
                    ],
                    payload={"email": self.key},
                )

            super().set_user_data({
                "email": self.key,
                "user": {
                    "avatar": "",
                    "first_name": "",
                    "last_name": "",
                    "provider_id": "",
                    "is_password_autoset": False,
                },
            })
            return
