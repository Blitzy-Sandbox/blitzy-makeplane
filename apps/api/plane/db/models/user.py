# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database models for the custom AUTH_USER_MODEL and its profile/account/onboarding state.

:class:`User` is Plane's custom Django auth user (``AUTH_USER_MODEL = "db.User"``);
authentication is by email (``USERNAME_FIELD = "email"``). :class:`Profile`
carries per-user UI / onboarding / language state; :class:`Account` carries
the active OAuth-provider connections (Google / GitHub / GitLab —
historical audit lives in :class:`SocialLoginConnection`).

:func:`create_user_notification` is a ``post_save`` signal handler that
seeds the default :class:`UserNotificationPreference` row inline (not via
Celery) when a new non-bot user is created — the row depends on the
``user_notification_preferences`` table which the ``migrator`` container
must have created before API startup.
"""

# Python imports
import random
import string
import uuid

import pytz
from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin, UserManager

# Django imports
from django.db import models
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

# Module imports
from plane.db.models import FileAsset
from ..mixins import TimeAuditModel
from plane.utils.color import get_random_color


def get_default_onboarding():
    """Return the default :attr:`Profile.onboarding_step` dict (four boolean steps unset)."""
    return {
        "profile_complete": False,
        "workspace_create": False,
        "workspace_invite": False,
        "workspace_join": False,
    }


def get_mobile_default_onboarding():
    """Return the default :attr:`Profile.mobile_onboarding_step` dict (three boolean steps unset)."""
    return {
        "profile_complete": False,
        "workspace_create": False,
        "workspace_join": False,
    }


def get_default_product_tour():
    """Return the default :attr:`Profile.product_tour` dict (five tour steps unset)."""
    return {
        "work_items": False,
        "cycles": False,
        "modules": False,
        "intake": False,
        "pages": False,
    }


class BotTypeEnum(models.TextChoices):
    """Discriminator for system-created bot :class:`User` rows.

    Currently only ``WORKSPACE_SEED`` is defined (the bot that owns workspace
    seed data); additional values can be added without migration since
    :attr:`User.bot_type` is a free-text :class:`CharField`.
    """

    WORKSPACE_SEED = "WORKSPACE_SEED", "Workspace Seed"


class User(AbstractBaseUser, PermissionsMixin):
    """Plane's custom ``AUTH_USER_MODEL`` — authentication by email with avatar/cover assets.

    Authentication uses :attr:`email` (``USERNAME_FIELD = "email"``);
    :attr:`username` is retained for legacy compatibility. Visual assets
    (avatar, cover image) are dual-stored as a legacy URL field plus a FK
    to :class:`FileAsset` — :attr:`avatar_url` and :attr:`cover_image_url`
    resolve the FK first, falling back to the legacy URL.

    Authentication and authorization flags:
        - :attr:`password` is inherited from
          :class:`~django.contrib.auth.models.AbstractBaseUser` and stores
          the hashed credential produced by Django's ``set_password()`` /
          ``PASSWORD_HASHERS`` pipeline. Raw password text is never
          persisted on this model; equality checks go through
          ``check_password()``.
        - :attr:`is_active` gates authentication: ``False`` blocks login
          for the row regardless of credential validity (used by the
          deactivation flow).
        - :attr:`is_superuser` grants every Django permission via
          :class:`~django.contrib.auth.models.PermissionsMixin` and is
          force-coupled to :attr:`is_staff` by :meth:`save` (a
          superuser is always staff).
        - :attr:`is_staff` is the gatekeeper for the Django admin UI;
          it does not affect API permissions, which are governed by
          DRF permission classes in ``plane.app.permissions``.
        - :attr:`is_email_verified`, :attr:`is_password_autoset`, and
          :attr:`is_password_reset_required` drive onboarding /
          reset flows; they do not directly grant or revoke access.
    """

    id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True)
    username = models.CharField(max_length=128, unique=True)
    # user fields
    mobile_number = models.CharField(max_length=255, blank=True, null=True)
    email = models.CharField(max_length=255, null=True, blank=True, unique=True)

    # identity
    display_name = models.CharField(max_length=255, default="")
    first_name = models.CharField(max_length=255, blank=True)
    last_name = models.CharField(max_length=255, blank=True)
    # avatar
    avatar = models.TextField(blank=True)
    avatar_asset = models.ForeignKey(
        FileAsset,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="user_avatar",
    )
    # cover image
    cover_image = models.URLField(blank=True, null=True, max_length=800)
    cover_image_asset = models.ForeignKey(
        FileAsset,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="user_cover_image",
    )

    # tracking metrics
    date_joined = models.DateTimeField(auto_now_add=True, verbose_name="Created At")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Created At")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Last Modified At")
    last_location = models.CharField(max_length=255, blank=True)
    created_location = models.CharField(max_length=255, blank=True)

    # the is' es
    is_superuser = models.BooleanField(default=False)
    is_managed = models.BooleanField(default=False)
    is_password_expired = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    is_email_verified = models.BooleanField(default=False)
    is_password_autoset = models.BooleanField(default=False)
    is_password_reset_required = models.BooleanField(default=False)
    # random token generated
    token = models.CharField(max_length=64, blank=True)

    last_active = models.DateTimeField(default=timezone.now, null=True)
    last_login_time = models.DateTimeField(null=True)
    last_logout_time = models.DateTimeField(null=True)
    last_login_ip = models.CharField(max_length=255, blank=True)
    last_logout_ip = models.CharField(max_length=255, blank=True)
    last_login_medium = models.CharField(max_length=20, default="email")
    last_login_uagent = models.TextField(blank=True)
    token_updated_at = models.DateTimeField(null=True)
    # my_issues_prop = models.JSONField(null=True)

    is_bot = models.BooleanField(default=False)
    # Valid: BotTypeEnum — "WORKSPACE_SEED"; declared as free-text CharField (no choices=)
    # so additional bot types can be added without migration.
    bot_type = models.CharField(max_length=30, verbose_name="Bot Type", blank=True, null=True)

    # timezone
    USER_TIMEZONE_CHOICES = tuple(zip(pytz.common_timezones, pytz.common_timezones))
    # Valid: any pytz.common_timezones member (USER_TIMEZONE_CHOICES = zip(common_timezones, common_timezones)).
    user_timezone = models.CharField(max_length=255, default="UTC", choices=USER_TIMEZONE_CHOICES)

    # email validation
    is_email_valid = models.BooleanField(default=False)

    # masking
    masked_at = models.DateTimeField(null=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["username"]

    objects = UserManager()

    class Meta:
        """Django model metadata for the ``users`` table (verbose names + default ordering)."""

        verbose_name = "User"
        verbose_name_plural = "Users"
        db_table = "users"
        ordering = ("-created_at",)

    def __str__(self):
        """Return ``username <email>`` for admin/debug rendering."""
        return f"{self.username} <{self.email}>"

    @property
    def avatar_url(self):
        """Return the resolved avatar URL — :class:`FileAsset` URL preferred, legacy URL fallback."""
        # Return the logo asset url if it exists
        if self.avatar_asset:
            return self.avatar_asset.asset_url

        # Return the logo url if it exists
        if self.avatar:
            return self.avatar
        return None

    @property
    def cover_image_url(self):
        """Return the resolved cover-image URL — :class:`FileAsset` URL preferred, legacy URL fallback."""
        # Return the logo asset url if it exists
        if self.cover_image_asset:
            return self.cover_image_asset.asset_url

        # Return the logo url if it exists
        if self.cover_image:
            return self.cover_image
        return None

    @property
    def full_name(self):
        """Return user's full name (first + last)."""
        return f"{self.first_name} {self.last_name}".strip()

    def save(self, *args, **kwargs):
        """Normalize email, refresh token when rotated, derive display name, and align staff flag with superuser.

        - Lowercases and strips ``email``.
        - Regenerates ``token`` (concatenated 64-hex string) and bumps
          ``token_updated_at`` to now when a token-rotation request set
          ``token_updated_at`` to a non-null value before save.
        - Derives ``display_name`` from the email prefix when blank (or a
          random 6-letter string if email is unparsable).
        - Force-sets ``is_staff=True`` when ``is_superuser=True``.
        """
        self.email = self.email.lower().strip()
        self.mobile_number = self.mobile_number

        if self.token_updated_at is not None:
            self.token = uuid.uuid4().hex + uuid.uuid4().hex
            self.token_updated_at = timezone.now()

        if not self.display_name:
            self.display_name = (
                self.email.split("@")[0]
                if len(self.email.split("@"))
                else "".join(random.choice(string.ascii_letters) for _ in range(6))
            )

        if self.is_superuser:
            self.is_staff = True

        super(User, self).save(*args, **kwargs)

    @classmethod
    def get_display_name(cls, email):
        """Return a display name derived from ``email`` (prefix before ``@``) or a random 6-letter fallback."""
        if not email:
            return "".join(random.choice(string.ascii_letters) for _ in range(6))
        return (
            email.split("@")[0]
            if len(email.split("@")) == 2
            else "".join(random.choice(string.ascii_letters) for _ in range(6))
        )


class Profile(TimeAuditModel):
    """Per-user UI / onboarding / language / theme / billing-address state.

    One-to-one with :class:`User`. Holds the four-step onboarding progress
    dict (``onboarding_step``), the three-step mobile-onboarding dict
    (``mobile_onboarding_step``), the five-step product-tour dict
    (``product_tour``), the user's preferred locale, start-of-week, and the
    nested :class:`NotificationViewMode` choice.
    """

    SUNDAY = 0
    MONDAY = 1
    TUESDAY = 2
    WEDNESDAY = 3
    THURSDAY = 4
    FRIDAY = 5
    SATURDAY = 6

    class NotificationViewMode(models.TextChoices):
        """User's preferred notification-list density (``full`` row layout vs ``compact`` row layout)."""

        FULL = "full", "Full"
        COMPACT = "compact", "Compact"

    START_OF_THE_WEEK_CHOICES = (
        (SUNDAY, "Sunday"),
        (MONDAY, "Monday"),
        (TUESDAY, "Tuesday"),
        (WEDNESDAY, "Wednesday"),
        (THURSDAY, "Thursday"),
        (FRIDAY, "Friday"),
        (SATURDAY, "Saturday"),
    )

    id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True)
    # User
    user = models.OneToOneField("db.User", on_delete=models.CASCADE, related_name="profile")
    # General
    # INTENT UNCLEAR: user UI theme overrides (colors, accent, etc.); shape varies per theme version.
    theme = models.JSONField(default=dict)
    is_app_rail_docked = models.BooleanField(default=True)
    # Onboarding
    is_tour_completed = models.BooleanField(default=False)
    # Shape: see get_default_onboarding (e.g., {"profile_complete": bool, "workspace_create": bool, ...}).
    onboarding_step = models.JSONField(default=get_default_onboarding)
    use_case = models.TextField(blank=True, null=True)
    role = models.CharField(max_length=300, null=True, blank=True)  # job role
    is_onboarded = models.BooleanField(default=False)
    # Last visited workspace
    last_workspace_id = models.UUIDField(null=True)
    # address data
    billing_address_country = models.CharField(max_length=255, default="INDIA")
    # INTENT UNCLEAR: structured billing-address payload consumed by billing flow; shape varies per region.
    billing_address = models.JSONField(null=True)
    has_billing_address = models.BooleanField(default=False)
    company_name = models.CharField(max_length=255, blank=True)
    # Valid: NotificationViewMode — "full" (default; spacious rows) | "compact" (dense rows).
    notification_view_mode = models.CharField(
        max_length=255, choices=NotificationViewMode.choices, default=NotificationViewMode.FULL
    )
    is_smooth_cursor_enabled = models.BooleanField(default=False)
    # mobile
    is_mobile_onboarded = models.BooleanField(default=False)
    # Shape: see get_mobile_default_onboarding (3 boolean steps).
    mobile_onboarding_step = models.JSONField(default=get_mobile_default_onboarding)
    mobile_timezone_auto_set = models.BooleanField(default=False)
    # language
    language = models.CharField(max_length=255, default="en")
    # Valid: START_OF_THE_WEEK_CHOICES — 0 (Sunday) | 1 (Monday) | 2 (Tuesday) | 3 (Wednesday)
    # | 4 (Thursday) | 5 (Friday) | 6 (Saturday).
    start_of_the_week = models.PositiveSmallIntegerField(choices=START_OF_THE_WEEK_CHOICES, default=SUNDAY)
    # INTENT UNCLEAR: user-stated workspace goals collected at signup; shape varies per signup flow.
    goals = models.JSONField(default=dict)
    background_color = models.CharField(max_length=255, default=get_random_color)

    # navigation tour
    is_navigation_tour_completed = models.BooleanField(default=False)

    # marketing
    has_marketing_email_consent = models.BooleanField(default=False)
    is_subscribed_to_changelog = models.BooleanField(default=False)
    # Shape: see get_default_product_tour (5 boolean tour steps).
    product_tour = models.JSONField(default=get_default_product_tour)

    class Meta:
        """Django model metadata for the ``profiles`` table (verbose names + default ordering)."""

        verbose_name = "Profile"
        verbose_name_plural = "Profiles"
        db_table = "profiles"
        ordering = ("-created_at",)


class Account(TimeAuditModel):
    """Active OAuth-provider connection for a :class:`User` (one row per provider).

    Stores the live access + refresh tokens for Google / GitHub / GitLab
    sign-in; rotation timestamps support refresh-token flows. Historical
    audit of OAuth events lives separately in
    :class:`SocialLoginConnection`.

    Sensitive storage contract: :attr:`access_token`, :attr:`refresh_token`,
    and :attr:`id_token` are plain :class:`TextField` columns that persist
    the credential strings as returned by the provider. No hashing,
    encryption-at-rest, or KMS wrapping is declared on this model; the
    ``accounts`` table must be treated as sensitive at rest.
    # INTENT UNCLEAR: whether an external column-encryption layer (DB-level
    # encryption, KMS, disk-level) is expected to wrap these columns.
    """

    PROVIDER_CHOICES = (
        ("google", "Google"),
        ("github", "Github"),
        ("gitlab", "GitLab"),
    )

    id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True)
    user = models.ForeignKey("db.User", on_delete=models.CASCADE, related_name="accounts")
    provider_account_id = models.CharField(max_length=255)
    # Valid: PROVIDER_CHOICES — "google" | "github" | "gitlab".
    provider = models.CharField(choices=PROVIDER_CHOICES)
    # Sensitive: plain TextField persisting the provider-issued OAuth access token in cleartext.
    access_token = models.TextField()
    access_token_expired_at = models.DateTimeField(null=True)
    # Sensitive: plain TextField persisting the provider-issued OAuth refresh token in cleartext.
    refresh_token = models.TextField(null=True, blank=True)
    refresh_token_expired_at = models.DateTimeField(null=True)
    last_connected_at = models.DateTimeField(default=timezone.now)
    # Sensitive: plain TextField persisting the provider-issued OAuth ID token (signed JWT) in cleartext.
    id_token = models.TextField(blank=True)
    # INTENT UNCLEAR: opaque per-provider metadata (e.g., scopes granted, provider-specific
    # user payload); shape varies per provider.
    metadata = models.JSONField(default=dict)

    class Meta:
        """Django model metadata for the ``accounts`` table (unique provider+id, verbose names, default ordering)."""

        unique_together = ["provider", "provider_account_id"]
        verbose_name = "Account"
        verbose_name_plural = "Accounts"
        db_table = "accounts"
        ordering = ("-created_at",)


@receiver(post_save, sender=User)
def create_user_notification(sender, instance, created, **kwargs):
    """Seed default :class:`UserNotificationPreference` row inline when a new non-bot user is created.

    Connected to Django's ``post_save`` signal on :class:`User`. Runs in the
    request thread (synchronous) — does NOT enqueue a Celery task. Skips
    bots (``instance.is_bot=True``) so seeded service accounts do not
    accumulate notification rows.
    """
    # create preferences
    if created and not instance.is_bot:
        # Module imports
        from plane.db.models import UserNotificationPreference

        UserNotificationPreference.objects.create(
            user=instance,
            property_change=True,
            state_change=True,
            comment=True,
            mention=True,
            issue_completed=True,
        )
