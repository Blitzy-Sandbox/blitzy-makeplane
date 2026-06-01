# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django ORM models for Plane instance identity, admin membership, configuration, and changelog.

Defines four database-backed models that describe a self-hosted Plane deployment:

    * ``Instance`` -- singleton-style deployment identity record.
    * ``InstanceAdmin`` -- user-to-instance administrative membership.
    * ``InstanceConfiguration`` -- encrypted-at-rest key/value config storage.
    * ``ChangeLog`` -- release notes / version history.

The migrator container applies the migrations in ``plane/license/migrations/`` before any
API service that imports this module starts, so importing this module assumes the four
backing tables (``instances``, ``instance_admins``, ``instance_configurations``,
``changelogs``) already exist.

Values stored on ``InstanceConfiguration`` rows with ``is_encrypted=True`` round-trip
through ``plane.license.utils.encryption.encrypt_data`` and ``decrypt_data`` (Fernet, key
derived from ``settings.SECRET_KEY``).
"""

# Python imports
from enum import Enum

# Django imports
from django.db import models
from django.conf import settings

# Module imports
from plane.db.models import BaseModel

# Integer-keyed choices tuple for :attr:`InstanceAdmin.role`; currently only the
# value ``20`` ("Admin") is defined.
ROLE_CHOICES = ((20, "Admin"),)


class InstanceEdition(Enum):
    """Enumeration of Plane instance editions surfaced through :attr:`Instance.edition`.

    Currently only ``PLANE_COMMUNITY`` is defined; community edition is the default
    written into ``Instance.edition`` for newly registered deployments.
    """

    # INTENT UNCLEAR: Stored value is the literal string "PLANE_COMMUNITY" (identical to
    # the member name) rather than a slug like "plane-ce"; downstream consumers compare
    # against this exact string.
    PLANE_COMMUNITY = "PLANE_COMMUNITY"


class Instance(BaseModel):
    """Singleton-style record of self-hosted Plane deployment identity, version, and toggles.

    Captures the operator-facing name, registered identifier, current and latest version
    strings, edition, domain, and telemetry / setup booleans for a single Plane install.
    Inherits audit fields from :class:`plane.db.models.BaseModel`: ``id`` (UUID primary
    key), ``created_at``, ``updated_at``, ``created_by``, ``updated_by``, and
    ``deleted_at`` for soft delete (see ``plane/db/models/base.py`` and
    ``plane/db/mixins.py``).

    Fields (declaration order):
        instance_name: Operator-facing human-readable name of the deployment.
        whitelist_emails: Free-form text column for allowed signup emails; see the
            ``INTENT UNCLEAR`` flag on the field for delimiter semantics.
        instance_id: Globally unique deployment identifier set during the
            ``register_instance`` flow (see ``plane/license/api/views/admin.py``).
        current_version: Running Plane version string set by ``register_instance``.
        latest_version: Latest available version polled from an external version check;
            nullable until the first check completes.
        edition: Active edition string; defaults to
            ``InstanceEdition.PLANE_COMMUNITY.value`` (literal ``"PLANE_COMMUNITY"`` --
            see the ``INTENT UNCLEAR`` flag on :class:`InstanceEdition`).
        domain: Primary domain string for the deployment; stored as
            ``TextField(blank=True)`` so it can be empty (no ``null=True``).
        last_checked_at: Timestamp of the most recent ``latest_version`` refresh.
        namespace: License namespace identifier; nullable / blank because community
            editions do not require one.
        is_telemetry_enabled: Gates the periodic ``instance_traces`` Celery task (see
            ``plane/license/bgtasks/tracer.py``); reaches the worker via RabbitMQ.
        is_support_required: Operator opt-in for support telemetry.
        is_setup_done: Set ``True`` once at least one :class:`InstanceAdmin` has been
            provisioned.
        is_signup_screen_visited: First-paint bookkeeping for the onboarding flow.
        is_verified: Instance-level verification flag.
        is_test: Marks CI / test deployments so dashboards and metrics can exclude them.
        is_current_version_deprecated: Set ``True`` when ``current_version`` falls
            outside the supported window; gates the upgrade banner in the web UI.

    Meta:
        verbose_name = ``"Instance"``, verbose_name_plural = ``"Instances"``,
        db_table = ``"instances"``, ordering = ``("-created_at",)``.
    """

    # General information
    instance_name = models.CharField(max_length=255)
    # INTENT UNCLEAR: Free-form text column; no validator enforces a delimiter, but
    # views/utils treat the value as comma- or newline-separated email addresses.
    whitelist_emails = models.TextField(blank=True, null=True)
    instance_id = models.CharField(max_length=255, unique=True)
    current_version = models.CharField(max_length=255)
    latest_version = models.CharField(max_length=255, null=True, blank=True)
    edition = models.CharField(max_length=255, default=InstanceEdition.PLANE_COMMUNITY.value)
    domain = models.TextField(blank=True)
    # Instance specifics
    last_checked_at = models.DateTimeField()
    namespace = models.CharField(max_length=255, blank=True, null=True)
    # telemetry and support
    is_telemetry_enabled = models.BooleanField(default=True)
    is_support_required = models.BooleanField(default=True)
    # is setup done
    is_setup_done = models.BooleanField(default=False)
    # signup screen
    is_signup_screen_visited = models.BooleanField(default=False)
    is_verified = models.BooleanField(default=False)
    is_test = models.BooleanField(default=False)
    # field for validating if the current version is deprecated
    is_current_version_deprecated = models.BooleanField(default=False)

    class Meta:
        """Django model metadata for :class:`Instance` (table ``instances``, newest-first ordering)."""

        verbose_name = "Instance"
        verbose_name_plural = "Instances"
        db_table = "instances"
        ordering = ("-created_at",)


class InstanceAdmin(BaseModel):
    """Membership record linking an authenticated user to a Plane :class:`Instance` with an admin role.

    Inherits audit fields from :class:`plane.db.models.BaseModel`.

    Fields:
        user: ``ForeignKey`` to ``settings.AUTH_USER_MODEL`` with
            ``on_delete=SET_NULL`` and ``null=True``; the membership row survives a
            user deletion with ``user_id = NULL`` rather than cascading.
            ``related_name="instance_owner"``.
        instance: ``ForeignKey`` to :class:`Instance` with ``on_delete=CASCADE``;
            deleting an :class:`Instance` removes its admin rows.
            ``related_name="admins"``.
        role: ``PositiveIntegerField(choices=ROLE_CHOICES, default=20)``. Choices are
            INTEGER-keyed (not string-keyed) and only ``20`` ("Admin") is currently
            defined; see :data:`ROLE_CHOICES`.
        is_verified: Set ``True`` once the admin membership has been verified (e.g.,
            via the magic-link or signup confirmation flow in
            ``plane/license/api/views/admin.py``).

    Meta:
        unique_together = ``["instance", "user"]`` enforces one membership row per
        (instance, user) pair. verbose_name = ``"Instance Admin"``,
        verbose_name_plural = ``"Instance Admins"``, db_table = ``"instance_admins"``,
        ordering = ``("-created_at",)``.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="instance_owner",
    )
    instance = models.ForeignKey(Instance, on_delete=models.CASCADE, related_name="admins")
    role = models.PositiveIntegerField(choices=ROLE_CHOICES, default=20)
    is_verified = models.BooleanField(default=False)

    class Meta:
        """Django model metadata for :class:`InstanceAdmin` (table ``instance_admins``, unique on instance+user)."""

        unique_together = ["instance", "user"]
        verbose_name = "Instance Admin"
        verbose_name_plural = "Instance Admins"
        db_table = "instance_admins"
        ordering = ("-created_at",)


class InstanceConfiguration(BaseModel):
    """Durable, instance-scoped key/value configuration storage with optional Fernet encryption at rest.

    Values stored with ``is_encrypted=True`` are Fernet-encrypted via
    ``plane.license.utils.encryption.encrypt_data`` BEFORE persistence and decrypted via
    ``decrypt_data`` on read (see ``plane/license/utils/instance_value.py`` for the read
    path). The Fernet key is derived from ``settings.SECRET_KEY`` using PBKDF2-HMAC-SHA256
    with a fixed salt; rotating ``SECRET_KEY`` will render previously encrypted values
    undecryptable.

    Fields:
        key: ``CharField(max_length=100, unique=True)``. Globally unique configuration
            key (max length 100, not 255).
        value: ``TextField(null=True, blank=True, default=None)``. Stored value;
            Fernet-encrypted ciphertext when ``is_encrypted=True``, plain text
            otherwise.
        category: ``TextField()`` (required -- no ``blank=True``, no default). Grouping
            label such as ``"SMTP"`` or ``"OAUTH_GOOGLE"`` used to bucket related
            configs in the admin UI.
        is_encrypted: Toggles the Fernet encrypt-on-write / decrypt-on-read round-trip
            applied to ``value``.

    Meta:
        verbose_name = ``"Instance Configuration"``,
        verbose_name_plural = ``"Instance Configurations"``,
        db_table = ``"instance_configurations"``, ordering = ``("-created_at",)``.
    """

    # The instance configuration variables
    key = models.CharField(max_length=100, unique=True)
    value = models.TextField(null=True, blank=True, default=None)
    category = models.TextField()
    is_encrypted = models.BooleanField(default=False)

    class Meta:
        """Django model metadata for :class:`InstanceConfiguration` (table ``instance_configurations``)."""

        verbose_name = "Instance Configuration"
        verbose_name_plural = "Instance Configurations"
        db_table = "instance_configurations"
        ordering = ("-created_at",)


class ChangeLog(BaseModel):
    """Release-notes / version-history records surfaced to instance admins in the upgrade feed.

    Stores release changelogs published with the application; consumers render the entries
    in the admin upgrade banner and release feed in ``apps/web/``.

    Fields:
        title: Release title.
        description: Release notes body (Markdown / plain text; rendering is
            consumer-side -- see ``apps/web/``).
        version: Version string the changelog describes.
        tags: ``JSONField(default=list)`` -- the default value is an empty list.
            Element schema is not declared on the model; see the ``INTENT UNCLEAR``
            flag on the field.
        release_date: ``DateTimeField(null=True)`` (note: ``DateTimeField`` not
            ``DateField``; only ``null=True``, no ``blank=True``). Release publication
            timestamp; nullable for draft / unreleased entries.
        is_release_candidate: ``True`` for pre-release builds (RC) that should be
            visually distinguished from stable releases.

    Meta:
        verbose_name = ``"Change Log"``, verbose_name_plural = ``"Change Logs"``,
        db_table = ``"changelogs"``, ordering = ``("-created_at",)``.
    """

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    version = models.CharField(max_length=255)
    # INTENT UNCLEAR: JSONField stores a list (default []); element schema is not
    # declared on the model -- producers in plane/license/* may store free-form
    # string tags.
    tags = models.JSONField(default=list)
    release_date = models.DateTimeField(null=True)
    is_release_candidate = models.BooleanField(default=False)

    class Meta:
        """Django model metadata for :class:`ChangeLog` (table ``changelogs``)."""

        verbose_name = "Change Log"
        verbose_name_plural = "Change Logs"
        db_table = "changelogs"
        ordering = ("-created_at",)
