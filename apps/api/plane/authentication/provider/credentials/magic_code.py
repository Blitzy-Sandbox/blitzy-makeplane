# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Magic-code (one-time-code) credential provider for ``plane.authentication``.

This module implements :class:`MagicCodeProvider`, a non-OAuth credential
provider that authenticates a user by mailing them a short-lived numeric
one-time code.  The provider specialises
:class:`plane.authentication.adapter.credential.CredentialAdapter`.

Architectural distinction (per AAP §0.2.2):

  * **Redis** is used here as a **cache** to persist transient code state.
    The provider writes a JSON document
    ``{"current_attempt": int, "email": str, "token": str}`` keyed by
    ``"magic_<email>"`` with a 600-second TTL.  Redis is NOT a task queue
    in this context.
  * **Celery via RabbitMQ** is the task-queue infrastructure used for the
    actual email delivery (``magic_link_code_task.magic_link.delay()``),
    but the enqueue happens in the **view layer**
    (``plane.authentication.views`` magic-code endpoints), not in this
    provider.  This provider's :meth:`MagicCodeProvider.initiate` only
    generates the token and writes it to Redis; it is the caller's
    responsibility to enqueue the email task.

Feature gating:

  * ``EMAIL_HOST`` must be configured (constructor raises
    ``SMTP_NOT_CONFIGURED`` otherwise).
  * ``ENABLE_MAGIC_LINK_LOGIN`` must not be ``"0"`` (constructor raises
    ``MAGIC_LINK_LOGIN_DISABLED`` otherwise).

The class attribute :attr:`MagicCodeProvider.provider` is the kebab-case
literal ``"magic-code"`` (NOT ``"magic_code"``); this is the canonical key
that the adapter layer uses for Account/Provider lookups, so renaming it
would break sign-in flows.
"""

# Python imports
import json
import os
import secrets


# Module imports
from plane.authentication.adapter.credential import CredentialAdapter
from plane.license.utils.instance_value import get_configuration_value
from plane.settings.redis import redis_instance
from plane.authentication.adapter.error import (
    AUTHENTICATION_ERROR_CODES,
    AuthenticationException,
)
from plane.db.models import User


class MagicCodeProvider(CredentialAdapter):
    """Redis-backed one-time-code credential provider.

    Authenticates a user via a 6-digit numeric code emailed to them.  The
    lifecycle has three phases:

      1. **Issuance** (:meth:`initiate`) -- generates a 6-digit code via
         ``secrets.randbelow(900000) + 100000`` and stores
         ``{"current_attempt": int, "email": str, "token": str}`` in Redis
         under the key ``"magic_<email>"`` with a 600-second TTL.  Returns
         the pair ``(redis_key, token)`` to the caller.
      2. **Attempt tracking** -- each subsequent :meth:`initiate` call on
         an existing key increments ``current_attempt``.  When the stored
         ``current_attempt`` is greater than ``2`` (i.e., on the 4th
         issuance attempt) the method raises
         ``EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_IN`` or
         ``EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_UP`` depending on whether a
         :class:`~plane.db.models.User` row with that email already
         exists.
      3. **Verification** (:meth:`set_user_data`) -- reads the JSON
         payload from Redis, compares the submitted ``self.code`` against
         the stored ``token``, and on success delegates a normalized user
         payload to the base adapter and DELETES the Redis entry
         (single-use semantics).

    Class attribute:

      * ``provider = "magic-code"`` -- kebab-case key used by the adapter
        layer for Account/Provider lookups.

    Error codes raised (see
    :data:`plane.authentication.adapter.error.AUTHENTICATION_ERROR_CODES`):

      * ``SMTP_NOT_CONFIGURED`` -- ``__init__``, when ``EMAIL_HOST`` is
        unset.
      * ``MAGIC_LINK_LOGIN_DISABLED`` -- ``__init__``, when
        ``ENABLE_MAGIC_LINK_LOGIN == "0"``.
      * ``EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_IN`` /
        ``EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_UP`` -- :meth:`initiate`,
        when attempts are exhausted (the user-exists branch picks the
        variant).
      * ``INVALID_MAGIC_CODE_SIGN_IN`` /
        ``INVALID_MAGIC_CODE_SIGN_UP`` -- :meth:`set_user_data`, on
        token mismatch.
      * ``EXPIRED_MAGIC_CODE_SIGN_IN`` /
        ``EXPIRED_MAGIC_CODE_SIGN_UP`` -- :meth:`set_user_data`, when
        no Redis entry exists (TTL expired or never issued).

    Normalized user payload on successful verification::

        {"email": <email>,
         "user": {"avatar": "", "first_name": "", "last_name": "",
                  "provider_id": "", "is_password_autoset": True}}

    Side effects:

      * Redis writes -- ``SET magic_<email> <json> EX 600`` on issuance.
      * Redis reads -- ``EXISTS`` and ``GET`` against the same key on
        verification.
      * Redis deletes -- ``DEL`` of the key on successful verification
        (enforces single-use semantics; a code cannot be replayed).
      * **No Celery dispatch from this class.** The caller (view layer)
        enqueues ``magic_link_code_task.magic_link.delay()`` after
        :meth:`initiate` returns.
    """

    provider = "magic-code"

    def __init__(self, request, key, code=None, callback=None):
        """Validate feature gating and initialise the provider.

        Constructor arguments:
          * ``request`` -- the Django ``HttpRequest`` forwarded to the
            adapter base (used for IP / user-agent context).
          * ``key`` -- the email address to issue the code to.  At
            verification time, the caller passes the full Redis key
            ``"magic_<email>"`` here instead (see
            :meth:`set_user_data`).
          * ``code`` -- the submitted token at verification time
            (optional during issuance; required at verification).
          * ``callback`` -- post-authentication redirect URL forwarded
            to the adapter base.

        Validates ``EMAIL_HOST`` and ``ENABLE_MAGIC_LINK_LOGIN`` BEFORE
        calling ``super().__init__()``, raising ``SMTP_NOT_CONFIGURED``
        or ``MAGIC_LINK_LOGIN_DISABLED`` on misconfiguration.
        """
        (EMAIL_HOST, ENABLE_MAGIC_LINK_LOGIN) = get_configuration_value(
            [
                {"key": "EMAIL_HOST", "default": os.environ.get("EMAIL_HOST")},
                {
                    "key": "ENABLE_MAGIC_LINK_LOGIN",
                    "default": os.environ.get("ENABLE_MAGIC_LINK_LOGIN", "1"),
                },
            ]
        )

        if not (EMAIL_HOST):
            raise AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["SMTP_NOT_CONFIGURED"],
                error_message="SMTP_NOT_CONFIGURED",
                payload={"email": str(key)},
            )

        if ENABLE_MAGIC_LINK_LOGIN == "0":
            raise AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["MAGIC_LINK_LOGIN_DISABLED"],
                error_message="MAGIC_LINK_LOGIN_DISABLED",
                payload={"email": str(key)},
            )

        super().__init__(request=request, provider=self.provider, callback=callback)
        self.key = key
        self.code = code

    def initiate(self):
        """Generate and store a one-time code, returning ``(redis_key, token)``.

        Returns:
            tuple[str, str]: ``(redis_key, token)`` where ``redis_key`` is
            ``"magic_" + str(self.key)`` and ``token`` is a 6-digit
            numeric string generated as
            ``str(secrets.randbelow(900000) + 100000)``.  The
            ``+ 100000`` offset guarantees exactly 6 digits without
            leading zeros, and :mod:`secrets` provides cryptographically
            secure randomness suitable for authentication codes.

        Behavior:

          * On a fresh email (no existing Redis key) -- writes
            ``{"current_attempt": 0, "email": self.key, "token": token}``
            with a 600-second TTL.
          * On a repeated request (existing Redis key) -- increments
            ``current_attempt`` and re-writes the entry with the new
            token (TTL reset to 600 seconds).  When the stored
            ``current_attempt`` is greater than ``2`` (i.e., on the 4th
            issuance attempt), raises
            ``EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_IN`` if the user exists
            or ``EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_UP`` otherwise.

        Side effects: a single Redis ``SET`` on the key
        ``"magic_<email>"`` with a 600-second expiry.  No Celery
        dispatch is performed here -- the caller (view layer) is
        responsible for enqueueing ``magic_link_code_task.magic_link``
        with the returned ``token``.

        Idempotency: NOT idempotent -- every call mutates Redis state
        (either bumping the attempt counter or creating the entry).
        """
        ## Generate a random token
        token = str(secrets.randbelow(900000) + 100000)

        ri = redis_instance()

        key = "magic_" + str(self.key)

        # Check if the key already exists in python
        if ri.exists(key):
            data = json.loads(ri.get(key))

            current_attempt = data["current_attempt"] + 1

            if data["current_attempt"] > 2:
                email = str(self.key).replace("magic_", "", 1)
                if User.objects.filter(email=email).exists():
                    raise AuthenticationException(
                        error_code=AUTHENTICATION_ERROR_CODES["EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_IN"],
                        error_message="EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_IN",
                        payload={"email": str(email)},
                    )
                else:
                    raise AuthenticationException(
                        error_code=AUTHENTICATION_ERROR_CODES["EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_UP"],
                        error_message="EMAIL_CODE_ATTEMPT_EXHAUSTED_SIGN_UP",
                        payload={"email": self.key},
                    )

            value = {
                "current_attempt": current_attempt,
                "email": str(self.key),
                "token": token,
            }
            expiry = 600
            ri.set(key, json.dumps(value), ex=expiry)
        else:
            value = {"current_attempt": 0, "email": self.key, "token": token}
            expiry = 600

            ri.set(key, json.dumps(value), ex=expiry)
        return key, token

    def set_user_data(self):
        """Verify the submitted code against the Redis-stored token.

        Resolution branches:

          * If no Redis entry exists for ``self.key`` (TTL expired or
            never issued) -- raises ``EXPIRED_MAGIC_CODE_SIGN_IN`` when
            a :class:`~plane.db.models.User` row with that email exists,
            otherwise ``EXPIRED_MAGIC_CODE_SIGN_UP``.
          * If the Redis entry exists and
            ``str(self.code) == str(token)`` -- delegates the normalized
            payload to :meth:`Adapter.set_user_data` and DELETES the
            Redis entry to enforce **single-use semantics** (a code
            cannot be replayed).
          * If the codes do not match -- raises
            ``INVALID_MAGIC_CODE_SIGN_IN`` / ``INVALID_MAGIC_CODE_SIGN_UP``
            (variant chosen by
            ``User.objects.filter(email=email).exists()``).

        ``self.key`` at this stage is the full Redis key
        ``"magic_<email>"`` returned from :meth:`initiate`; the email
        is recovered via ``str(self.key).replace("magic_", "", 1)`` for
        the error payloads.
        """
        ri = redis_instance()
        if ri.exists(self.key):
            data = json.loads(ri.get(self.key))
            token = data["token"]
            email = data["email"]

            if str(token) == str(self.code):
                super().set_user_data(
                    {
                        "email": email,
                        "user": {
                            "avatar": "",
                            "first_name": "",
                            "last_name": "",
                            "provider_id": "",
                            "is_password_autoset": True,
                        },
                    }
                )
                # Delete the token from redis if the code match is successful
                ri.delete(self.key)
                return
            else:
                email = str(self.key).replace("magic_", "", 1)
                if User.objects.filter(email=email).exists():
                    raise AuthenticationException(
                        error_code=AUTHENTICATION_ERROR_CODES["INVALID_MAGIC_CODE_SIGN_IN"],
                        error_message="INVALID_MAGIC_CODE_SIGN_IN",
                        payload={"email": str(email)},
                    )
                else:
                    raise AuthenticationException(
                        error_code=AUTHENTICATION_ERROR_CODES["INVALID_MAGIC_CODE_SIGN_UP"],
                        error_message="INVALID_MAGIC_CODE_SIGN_UP",
                        payload={"email": str(email)},
                    )
        else:
            email = str(self.key).replace("magic_", "", 1)
            if User.objects.filter(email=email).exists():
                raise AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["EXPIRED_MAGIC_CODE_SIGN_IN"],
                    error_message="EXPIRED_MAGIC_CODE_SIGN_IN",
                    payload={"email": str(email)},
                )
            else:
                raise AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["EXPIRED_MAGIC_CODE_SIGN_UP"],
                    error_message="EXPIRED_MAGIC_CODE_SIGN_UP",
                    payload={"email": str(email)},
                )
