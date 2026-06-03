# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Shared base adapter for the Plane authentication subsystem.

Hosts :class:`Adapter`, the abstract base for every authentication
provider in the codebase. Both credential-flow providers (email /
password, magic-code via
:class:`~plane.authentication.adapter.credential.CredentialAdapter`)
and OAuth-flow providers (Google, GitHub, GitLab, Gitea via
:class:`~plane.authentication.adapter.oauth.OauthAdapter`) extend this
class so that the cross-cutting concerns of an authentication lifecycle
-- email sanitization, password-strength validation, signup
eligibility, provider sync gating, avatar download / upload, login
metadata, account upsert, and the optional post-auth ``callback`` --
live in exactly one place.

Concrete subclasses implement the provider-specific
:meth:`Adapter.set_user_data`, :meth:`Adapter.create_update_account`
(OAuth only), and :meth:`Adapter.authenticate` flow; the rest of the
behavior is shared.

Side effects driven from this module:

* Persists rows to :class:`~plane.db.models.User`,
  :class:`~plane.db.models.Profile`, and
  :class:`~plane.db.models.FileAsset`, and reads
  :class:`~plane.db.models.WorkspaceMemberInvite` (and indirectly
  :class:`~plane.db.models.Account` via subclasses).
* Uploads avatar assets via :class:`~plane.settings.storage.S3Storage`
  (object store).
* Enqueues exactly one Celery task:
  :func:`~plane.bgtasks.user_activation_email_task.user_activation_email`
  via ``.delay(...)`` to send the activation email when a previously
  inactive user logs in. Celery tasks in Plane route through
  **RabbitMQ**; Redis in this codebase is reserved for caching and
  session storage and is NOT used as a task broker.

Schema-readiness assumption: the ``migrator`` container runs Django
migrations before any API service starts, so this module assumes the
``User``, ``Profile``, ``FileAsset``, and ``WorkspaceMemberInvite``
tables are at their target revisions at import time.
"""

# Python imports
import logging
import os
import uuid
from io import BytesIO

import requests
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email

# Django imports
from django.utils import timezone

# Third party imports
from zxcvbn import zxcvbn

from plane.bgtasks.user_activation_email_task import user_activation_email

# Module imports
from plane.db.models import FileAsset, Profile, User, WorkspaceMemberInvite
from plane.license.utils.instance_value import get_configuration_value
from plane.settings.storage import S3Storage
from plane.utils.exception_logger import log_exception
from plane.utils.host import base_host
from plane.utils.ip_address import get_client_ip

from .error import AUTHENTICATION_ERROR_CODES, AuthenticationException


class Adapter:
    """Shared base class for credential and OAuth authentication providers.

    Concrete subclasses implement the provider-specific hooks
    (:meth:`set_user_data`, :meth:`set_token_data`,
    :meth:`create_update_account`, :meth:`authenticate`) while
    delegating the cross-cutting concerns to the shared helpers defined
    here.

    Instance state (set in :meth:`__init__`):

    * ``request`` -- inbound HTTP request; used for client-IP,
      user-agent, and tenant-host resolution.
    * ``provider`` -- short provider identifier (e.g. ``"google"``,
      ``"github"``, ``"email"``, ``"magic-code"``); stamped onto
      ``User.last_login_medium``.
    * ``callback`` -- optional callable invoked with
      ``(user, is_signup, request)`` after a successful login.
    * ``token_data`` -- OAuth token payload set by subclass; drives
      :meth:`create_update_account`.
    * ``user_data`` -- normalized user payload set by subclass; drives
      :meth:`complete_login_or_signup`.
    * ``logger`` -- :class:`logging.Logger` rooted at
      ``"plane.authentication"``.

    Subclass-implemented abstract hooks (raise
    :exc:`NotImplementedError` here):

    * :meth:`get_user_token` -- token-exchange call (OAuth).
    * :meth:`get_user_response` -- user-info fetch (OAuth).
    * :meth:`create_update_account` -- upsert
      :class:`~plane.db.models.Account` row (OAuth).
    * :meth:`authenticate` -- end-to-end flow driver.

    Shared helpers (implemented here):

    * :meth:`sanitize_email` -- lowercase / strip + validate.
    * :meth:`validate_password` -- ``zxcvbn`` score >= 3.
    * :meth:`check_sync_enabled` -- provider-sync gating against the
      ``ENABLE_<PROVIDER>_SYNC`` configuration value.
    * :meth:`download_and_upload_avatar` -- fetch remote avatar,
      validate type / size, upload to S3, create
      :class:`~plane.db.models.FileAsset`.
    * :meth:`delete_old_avatar` -- remove prior avatar from S3 + DB.
    * :meth:`sync_user_data` -- overwrite local user fields from
      provider payload.
    * :meth:`save_user_data` -- stamp login metadata and enqueue the
      activation email for newly-active users.
    * :meth:`complete_login_or_signup` -- final orchestration:
      validate -> get-or-create -> sync -> save -> callback ->
      account upsert.
    """

    def __init__(self, request, provider, callback=None):
        """Initialize the adapter with request context and provider identity.

        Args:
            request: Inbound HTTP request; used for client-IP,
                user-agent, and tenant-host resolution via
                :func:`~plane.utils.ip_address.get_client_ip` and
                :func:`~plane.utils.host.base_host`.
            provider: Short provider identifier (e.g. ``"google"``,
                ``"email"``); stamped onto ``User.last_login_medium``
                on successful login.
            callback: Optional callable invoked from
                :meth:`complete_login_or_signup` with
                ``(user, is_signup, request)`` after authentication
                succeeds. Used by callers that need post-auth
                side-effects (e.g. attaching the user to a pending
                invite) without subclassing.
        """
        self.request = request
        self.provider = provider
        self.callback = callback
        self.token_data = None
        self.user_data = None
        self.logger = logging.getLogger("plane.authentication")

    def get_user_token(self, data, headers=None):
        """Exchange provider credentials or code for an OAuth token.

        Abstract hook: concrete subclasses (e.g.
        :class:`~plane.authentication.adapter.oauth.OauthAdapter`)
        perform the provider-specific token-exchange HTTP call and
        return a parsed token dict; the base implementation raises
        :exc:`NotImplementedError`.

        Args:
            data: Token-exchange payload (typically
                ``{"client_id": ..., "client_secret": ...,
                "code": ..., "redirect_uri": ..., "grant_type": ...}``).
            headers: Optional headers for the token-exchange POST.

        Raises:
            NotImplementedError: Always, when invoked on the base
                class.
        """
        raise NotImplementedError

    def get_user_response(self):
        """Fetch the provider's user-info payload.

        Abstract hook: concrete subclasses (e.g.
        :class:`~plane.authentication.adapter.oauth.OauthAdapter`)
        perform the provider-specific user-info HTTP call and return
        the parsed profile JSON; the base implementation raises
        :exc:`NotImplementedError`.

        Raises:
            NotImplementedError: Always, when invoked on the base
                class.
        """
        raise NotImplementedError

    def set_token_data(self, data):
        """Store the provider's token payload on the adapter instance.

        Concrete OAuth subclasses call this with the parsed
        token-exchange response so that
        :meth:`complete_login_or_signup` can invoke
        :meth:`create_update_account` to persist the
        :class:`~plane.db.models.Account` row.

        Args:
            data: Parsed token-exchange JSON (access_token,
                refresh_token, expiry timestamps, optional id_token).
        """
        self.token_data = data

    def set_user_data(self, data):
        """Store the normalized user-data payload on the adapter instance.

        Concrete subclasses call this with the normalized provider
        profile so that :meth:`complete_login_or_signup` can drive
        get-or-create against the :class:`~plane.db.models.User`
        table.

        Args:
            data: Normalized provider user payload with the shape
                ``{"email": ..., "user": {"first_name": ...,
                "last_name": ..., "avatar": ..., "display_name": ...,
                "is_password_autoset": bool, "provider_id": ...}}``.
        """
        self.user_data = data

    def create_update_account(self, user):
        """Upsert the per-provider :class:`~plane.db.models.Account` row.

        Abstract hook: concrete OAuth subclasses (e.g.
        :class:`~plane.authentication.adapter.oauth.OauthAdapter`)
        persist the provider OAuth-token binding so silent re-auth and
        token refresh can recover the credentials later. The base
        implementation raises :exc:`NotImplementedError`.

        Args:
            user: The authenticated :class:`~plane.db.models.User`
                whose account binding should be written.

        Raises:
            NotImplementedError: Always, when invoked on the base
                class.
        """
        raise NotImplementedError

    def authenticate(self):
        """Drive the end-to-end authentication flow.

        Abstract hook: concrete subclasses run the provider-specific
        lifecycle (e.g.
        :class:`~plane.authentication.adapter.oauth.OauthAdapter`
        does ``set_token_data`` -> ``set_user_data`` ->
        ``complete_login_or_signup``;
        :class:`~plane.authentication.adapter.credential.CredentialAdapter`
        does ``set_user_data`` -> ``complete_login_or_signup``). The
        base implementation raises :exc:`NotImplementedError`.

        Raises:
            NotImplementedError: Always, when invoked on the base
                class.
        """
        raise NotImplementedError

    def sanitize_email(self, email):
        """Normalize and validate an email address before user lookup.

        Lowercases and strips the input, then runs Django's
        :func:`~django.core.validators.validate_email`. The
        normalization step guarantees that downstream
        :class:`~plane.db.models.User` lookups by email are
        case-insensitive (the User table stores normalized emails).

        Args:
            email: Raw email string from the provider payload.

        Returns:
            str: The sanitized, validated email.

        Raises:
            AuthenticationException: With error code
                ``INVALID_EMAIL`` when the input is empty or fails
                :func:`~django.core.validators.validate_email`.
        """
        # Check if email is present
        if not email:
            self.logger.error("Email is not present")
            raise AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INVALID_EMAIL"],
                error_message="INVALID_EMAIL",
                payload={"email": email},
            )

        # Sanitize email
        email = str(email).lower().strip()

        # validate email
        try:
            validate_email(email)
        except ValidationError:
            self.logger.warning(f"Email is not valid: {email}")
            raise AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INVALID_EMAIL"],
                error_message="INVALID_EMAIL",
                payload={"email": email},
            )
        # Return email
        return email

    def validate_password(self, email):
        """Enforce password strength via ``zxcvbn``.

        Runs :func:`zxcvbn.zxcvbn` on the candidate password (read
        from ``self.code``) and raises
        :exc:`~plane.authentication.adapter.error.AuthenticationException`
        with ``PASSWORD_TOO_WEAK`` when the score is below ``3``.

        Reads ``self.code`` rather than receiving the password as an
        argument; ``self.code`` is set by subclass constructors -- the
        OAuth adapter accepts a ``code=`` parameter and the credential
        providers populate ``self.code`` from the inbound request
        body. This indirection lets the same strength check apply to
        both flows without changing the call signature.

        Args:
            email: Email of the user attempting authentication;
                included in the error payload for downstream
                observability.

        Raises:
            AuthenticationException: With error code
                ``PASSWORD_TOO_WEAK`` when the ``zxcvbn`` score is
                below ``3``.
        """
        results = zxcvbn(self.code)
        if results["score"] < 3:
            self.logger.warning("Password is not strong enough")
            raise AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["PASSWORD_TOO_WEAK"],
                error_message="PASSWORD_TOO_WEAK",
                payload={"email": email},
            )
        return

    def __check_signup(self, email):
        """Verify that this email is allowed to sign up.

        Reads the ``ENABLE_SIGNUP`` configuration value via
        :func:`~plane.license.utils.instance_value.get_configuration_value`
        (falling back to the ``ENABLE_SIGNUP`` environment variable,
        default ``"1"``). When signup is globally disabled
        (``ENABLE_SIGNUP == "0"``), allows the sign-up to proceed
        ONLY if a :class:`~plane.db.models.WorkspaceMemberInvite`
        row exists for this email -- i.e. the user was invited even
        though open signups are closed.

        Args:
            email: Sanitized email address being registered.

        Returns:
            bool: ``True`` if signup is permitted.

        Raises:
            AuthenticationException: With error code
                ``SIGNUP_DISABLED`` when signup is globally disabled
                and no matching invite exists.
        """
        # Get configuration value
        (ENABLE_SIGNUP,) = get_configuration_value([
            {"key": "ENABLE_SIGNUP", "default": os.environ.get("ENABLE_SIGNUP", "1")}
        ])

        # Check if sign up is disabled and invite is present or not
        if ENABLE_SIGNUP == "0" and not WorkspaceMemberInvite.objects.filter(email=email).exists():
            self.logger.warning("Sign up is disabled and invite is not present")
            # Raise exception
            raise AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["SIGNUP_DISABLED"],
                error_message="SIGNUP_DISABLED",
                payload={"email": email},
            )

        return True

    def get_avatar_download_headers(self):
        """Return optional HTTP headers used when fetching the provider avatar.

        Base implementation returns an empty dict so the default
        avatar download in :meth:`download_and_upload_avatar` makes an
        unauthenticated GET. Concrete subclasses override this when
        the provider requires an ``Authorization`` header (e.g.
        GitHub private avatars) to fetch the avatar URL.

        Returns:
            dict: Header mapping merged into the avatar GET request.
        """
        return {}

    def check_sync_enabled(self):
        """Return whether IDP-to-Plane field sync is enabled for this provider.

        Looks up the per-provider ``ENABLE_<PROVIDER>_SYNC``
        configuration value (currently mapped for ``google``,
        ``github``, ``gitlab``, ``gitea``) and treats ``"1"`` as
        enabled. When enabled, :meth:`complete_login_or_signup`
        overwrites the local first-name, last-name, display-name, and
        avatar from the provider's payload on every login (NOT on
        signup). When disabled, only the initial signup seeds those
        fields and subsequent logins leave them untouched.

        Returns:
            bool: ``True`` when sync is enabled for ``self.provider``;
            ``False`` for unknown providers or when sync is disabled.
        """
        provider_config_map = {
            "google": "ENABLE_GOOGLE_SYNC",
            "github": "ENABLE_GITHUB_SYNC",
            "gitlab": "ENABLE_GITLAB_SYNC",
            "gitea": "ENABLE_GITEA_SYNC",
        }
        config_key = provider_config_map.get(self.provider)
        if config_key:
            (enabled,) = get_configuration_value([{"key": config_key, "default": os.environ.get(config_key, "0")}])
            return enabled == "1"
        return False

    def download_and_upload_avatar(self, avatar_url, user):
        """Download the provider avatar URL and persist it to Plane's storage.

        Performs the validate -> download -> upload -> persist
        sequence:

        1. GETs ``avatar_url`` with optional provider-auth headers
           (see :meth:`get_avatar_download_headers`); a 10-second
           timeout caps slow providers.
        2. Validates the ``Content-Length`` and streams via
           ``response.iter_content(chunk_size=8192)`` so the total
           bytes never exceed
           ``settings.DATA_UPLOAD_MAX_MEMORY_SIZE``.
        3. Verifies the ``Content-Type`` is in the allowed image set
           (``image/jpeg``, ``image/jpg``, ``image/png``,
           ``image/gif``, ``image/webp``); anything else returns
           ``None``.
        4. Uploads the bytes to S3 via
           :class:`~plane.settings.storage.S3Storage` and creates a
           :class:`~plane.db.models.FileAsset` row of entity type
           ``FileAsset.EntityTypeContext.USER_AVATAR``.
        5. Catches any exception, logs via
           :func:`~plane.utils.exception_logger.log_exception`, and
           returns ``None`` so the caller can fall back to the
           original URL rather than fail the entire login.

        Args:
            avatar_url: Remote URL of the provider avatar; ``None``
                or empty short-circuits to ``None``.
            user: :class:`~plane.db.models.User` whose avatar is
                being uploaded; recorded as both ``user`` and
                ``created_by`` on the resulting
                :class:`~plane.db.models.FileAsset`.

        Returns:
            FileAsset | None: The persisted
            :class:`~plane.db.models.FileAsset` row on success;
            ``None`` when the URL is empty, the response is too
            large, the content type is disallowed, or any step
            fails.
        """
        if not avatar_url:
            return None

        try:
            headers = self.get_avatar_download_headers()
            # Download the avatar image
            response = requests.get(avatar_url, timeout=10, headers=headers)
            response.raise_for_status()

            # Check content length before downloading
            content_length = response.headers.get("Content-Length")
            max_size = settings.DATA_UPLOAD_MAX_MEMORY_SIZE
            if content_length and int(content_length) > max_size:
                return None

            # Get content type and determine file extension
            content_type = response.headers.get("Content-Type", "image/jpeg")
            extension_map = {
                "image/jpeg": "jpg",
                "image/jpg": "jpg",
                "image/png": "png",
                "image/gif": "gif",
                "image/webp": "webp",
            }
            extension = extension_map.get(content_type)

            if not extension:
                return None

            # Download with size limit
            chunks = []
            total_size = 0
            for chunk in response.iter_content(chunk_size=8192):
                total_size += len(chunk)
                if total_size > max_size:
                    return None
                chunks.append(chunk)
            content = b"".join(chunks)
            file_size = len(content)

            # Generate unique filename
            filename = f"{uuid.uuid4().hex}-user-avatar.{extension}"

            storage = S3Storage(request=self.request)

            # Create file-like object
            file_obj = BytesIO(response.content)
            file_obj.seek(0)

            # Upload using boto3 directly
            upload_success = storage.upload_file(file_obj=file_obj, object_name=filename, content_type=content_type)
            if not upload_success:
                return None

            # Get storage metadata
            storage_metadata = storage.get_object_metadata(object_name=filename)

            # Create FileAsset record
            file_asset = FileAsset.objects.create(
                attributes={"name": f"{self.provider}-avatar.{extension}", "type": content_type, "size": file_size},
                asset=filename,
                size=file_size,
                user=user,
                created_by=user,
                entity_type=FileAsset.EntityTypeContext.USER_AVATAR,
                is_uploaded=True,
                storage_metadata=storage_metadata,
            )

            return file_asset

        except Exception as e:
            log_exception(e)
            # Return None if upload fails, so original URL can be used as fallback
            return None

    def save_user_data(self, user):
        """Stamp login metadata onto the user and ensure the account is active.

        Writes ``last_login_medium`` (provider name), ``last_active``,
        ``last_login_time``, ``last_login_ip`` (resolved via
        :func:`~plane.utils.ip_address.get_client_ip`),
        ``last_login_uagent``, and ``token_updated_at`` -- all set to
        ``timezone.now()`` where applicable. When the user is
        currently inactive (i.e. ``user.is_active is False``),
        enqueues
        :func:`~plane.bgtasks.user_activation_email_task.user_activation_email`
        via ``.delay(...)`` to send the activation email through
        Celery + RabbitMQ before flipping ``is_active = True``.

        Args:
            user: The authenticated
                :class:`~plane.db.models.User`.

        Returns:
            plane.db.models.User: The same user, persisted with
            updated login metadata.
        """
        # Update user details
        user.last_login_medium = self.provider
        user.last_active = timezone.now()
        user.last_login_time = timezone.now()
        user.last_login_ip = get_client_ip(request=self.request)
        user.last_login_uagent = self.request.META.get("HTTP_USER_AGENT")
        user.token_updated_at = timezone.now()
        # If user is not active, send the activation email and set the user as active
        if not user.is_active:
            user_activation_email.delay(base_host(request=self.request), user.id)
        # Set user as active
        user.is_active = True
        user.save()
        return user

    def delete_old_avatar(self, user):
        """Remove the user's prior avatar from S3 and detach the FileAsset.

        Reads ``user.avatar_asset``; if set, fetches the underlying
        :class:`~plane.db.models.FileAsset`, deletes the S3 object via
        :meth:`~plane.settings.storage.S3Storage.delete_files`,
        deletes the ``FileAsset`` row, and clears
        ``user.avatar_asset`` and ``user.avatar`` on the user.
        Swallows :class:`~plane.db.models.FileAsset.DoesNotExist`
        (no-op when the asset row is already gone) and logs other
        exceptions via
        :func:`~plane.utils.exception_logger.log_exception` without
        raising, so an in-flight avatar refresh never blocks the
        login.

        Args:
            user: The :class:`~plane.db.models.User` whose old avatar
                should be removed.
        """
        try:
            if user.avatar_asset:
                asset = FileAsset.objects.get(pk=user.avatar_asset_id)
                storage = S3Storage(request=self.request)
                storage.delete_files(object_names=[asset.asset.name])

                # Delete the user avatar
                asset.delete()
                user.avatar_asset = None
                user.avatar = ""
                user.save()
            return
        except FileAsset.DoesNotExist:
            pass
        except Exception as e:
            log_exception(e)
            return

    def sync_user_data(self, user):
        """Overwrite the user's profile fields from the provider payload.

        Called from :meth:`complete_login_or_signup` only when
        :meth:`check_sync_enabled` returns ``True`` AND the request
        is a login (not a signup) -- i.e. the user already exists
        and the operator has opted into IDP-to-Plane sync for this
        provider.

        Updates ``first_name``, ``last_name``, ``display_name``
        (falling back to
        :meth:`~plane.db.models.User.get_display_name` when the
        provider does not supply one), and runs the
        :meth:`delete_old_avatar` -> :meth:`download_and_upload_avatar`
        cycle to refresh the avatar. If the avatar upload fails,
        falls back to storing the remote URL on ``user.avatar``.

        Args:
            user: The :class:`~plane.db.models.User` to sync from
                ``self.user_data``.

        Returns:
            plane.db.models.User: The saved user.
        """
        # Update user details
        first_name = self.user_data.get("user", {}).get("first_name", "")
        last_name = self.user_data.get("user", {}).get("last_name", "")
        user.first_name = first_name if first_name else ""
        user.last_name = last_name if last_name else ""

        # Get email
        email = self.user_data.get("email")

        # Get display name
        display_name = self.user_data.get("user", {}).get("display_name")
        # If display name is not provided, generate a random display name
        if not display_name:
            display_name = User.get_display_name(email)

        # Set display name
        user.display_name = display_name

        # Download and upload avatar only if the avatar is different from the one in the storage
        avatar = self.user_data.get("user", {}).get("avatar", "")
        # Delete the old avatar if it exists
        self.delete_old_avatar(user=user)
        avatar_asset = self.download_and_upload_avatar(avatar_url=avatar, user=user)
        if avatar_asset:
            user.avatar_asset = avatar_asset
        # If avatar upload fails, set the avatar to the original URL
        else:
            user.avatar = avatar

        user.save()
        return user

    def complete_login_or_signup(self):
        """Drive the post-payload phase of the authentication lifecycle.

        Single entry point for both credential and OAuth flows once
        ``self.user_data`` has been populated. Performs, in order:

        1. Sanitize the email from ``self.user_data`` via
           :meth:`sanitize_email`.
        2. Look up an existing :class:`~plane.db.models.User` by
           email -- the presence / absence of a row distinguishes
           login from signup.
        3. **Signup path**: when no user exists, validate signup
           eligibility via the private ``__check_signup`` (Python
           name-mangled to ``_Adapter__check_signup``), generate a
           new :class:`~plane.db.models.User` with a UUID username,
           set the password (either autoset for magic-code / OAuth
           flows or :meth:`validate_password`-checked for email /
           password), create the linked
           :class:`~plane.db.models.Profile`, and download the
           avatar.
        4. **Login path**: when the user already exists and
           :meth:`check_sync_enabled` is ``True``, refresh the
           user's profile fields via :meth:`sync_user_data`.
        5. Stamp login metadata via :meth:`save_user_data` (also
           enqueues the activation email when ``is_active`` flips).
        6. Invoke the optional ``callback`` with
           ``(user, is_signup, request)`` so callers can react to
           the auth event without subclassing.
        7. When ``self.token_data`` is present (OAuth flow), call
           :meth:`create_update_account` to upsert the
           :class:`~plane.db.models.Account` row.

        Returns:
            plane.db.models.User: The authenticated user, ready for
            :func:`django.contrib.auth.login`.

        Raises:
            AuthenticationException: Propagated from the helpers
                (``INVALID_EMAIL``, ``SIGNUP_DISABLED``,
                ``PASSWORD_TOO_WEAK``).
        """
        # Get email
        email = self.user_data.get("email")

        # Sanitize email
        email = self.sanitize_email(email)

        # Check if the user is present
        user = User.objects.filter(email=email).first()
        # Check if sign up case or login
        is_signup = bool(user)
        # If user is not present, create a new user
        if not user:
            # New user
            self.__check_signup(email)

            # Initialize user
            user = User(email=email, username=uuid.uuid4().hex)

            # Check if password is autoset
            if self.user_data.get("user").get("is_password_autoset"):
                user.set_password(uuid.uuid4().hex)
                user.is_password_autoset = True
                user.is_email_verified = True

            # Validate password
            else:
                # Validate password
                self.validate_password(email)
                # Set password
                user.set_password(self.code)
                user.is_password_autoset = False

            # Set user details
            first_name = self.user_data.get("user", {}).get("first_name", "")
            last_name = self.user_data.get("user", {}).get("last_name", "")
            user.first_name = first_name if first_name else ""
            user.last_name = last_name if last_name else ""

            user.save()

            # Download and upload avatar
            avatar = self.user_data.get("user", {}).get("avatar", "")
            if avatar:
                avatar_asset = self.download_and_upload_avatar(avatar_url=avatar, user=user)
                if avatar_asset:
                    user.avatar_asset = avatar_asset
                    user.avatar = avatar
                # If avatar upload fails, set the avatar to the original URL
                else:
                    user.avatar = avatar

            # Create profile
            Profile.objects.create(user=user)

        # Check if IDP sync is enabled and user is not signing up
        if self.check_sync_enabled() and not is_signup:
            user = self.sync_user_data(user=user)

        # Save user data
        user = self.save_user_data(user=user)

        # Call callback if present
        if self.callback:
            self.callback(user, is_signup, self.request)

        # Create or update account if token data is present
        if self.token_data:
            self.create_update_account(user=user)

        # Return user
        return user
