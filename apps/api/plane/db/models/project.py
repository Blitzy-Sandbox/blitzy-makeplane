# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Project-domain ORM models for Plane.

Defines the ``Project`` aggregate root, the abstract ``ProjectBaseModel`` mixin
consumed by every project-scoped table, project membership and invitation
models, the project identifier registry, and the deprecated legacy
``ProjectDeployBoard``. A project belongs to exactly one ``Workspace`` and
serves as the primary container for issues, cycles, modules, pages, and
views.
"""

# Python imports
import pytz
from uuid import uuid4
from enum import Enum

# Django imports
from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q

# Module imports
from plane.db.mixins import AuditModel

from .base import BaseModel

# Valid: 5=Guest, 15=Member, 20=Admin
ROLE_CHOICES = ((20, "Admin"), (15, "Member"), (5, "Guest"))


class ROLE(Enum):
    """Numeric project role identifiers mirroring ``ROLE_CHOICES``.

    ADMIN=20 (full control), MEMBER=15 (read/write), GUEST=5 (read-only by default).
    """

    ADMIN = 20
    MEMBER = 15
    GUEST = 5


class ProjectNetwork(Enum):
    """Visibility levels for a ``Project`` within its parent workspace.

    SECRET=0 (private to explicit members), PUBLIC=2 (any workspace member can access).
    """

    SECRET = 0
    PUBLIC = 2

    @classmethod
    def choices(cls):
        """Return ``(value, name)`` tuples consumable by ``IntegerField.choices``."""
        return [(0, "Secret"), (2, "Public")]


def get_default_props():
    """Return the default ``view_props`` payload for a new ``ProjectMember``.

    Shape: ``{"filters": {...}, "display_filters": {...}, "display_properties": {...}}``
    matches the issue list view's persisted preferences contract.
    """
    return {
        "filters": {
            "priority": None,
            "state": None,
            "state_group": None,
            "assignees": None,
            "created_by": None,
            "labels": None,
            "start_date": None,
            "target_date": None,
            "subscriber": None,
        },
        "display_filters": {
            "group_by": None,
            "order_by": "-created_at",
            "type": None,
            "sub_issue": True,
            "show_empty_groups": True,
            "layout": "list",
            "calendar_date_range": "",
        },
    }


def get_default_preferences():
    """Return the default ``preferences`` payload for a new ``ProjectMember``.

    Shape: ``{"pages": {"block_display": bool}, "navigation": {...}}``.
    """
    return {"pages": {"block_display": True}, "navigation": {"default_tab": "work_items", "hide_in_more_menu": []}}


class Project(BaseModel):
    """Top-level organizational container scoped to a ``Workspace``.

    A project owns issues, cycles, modules, pages, views, and members. It carries
    a workspace-unique short ``identifier`` (e.g. ``"PLAN"``) used to format
    user-visible issue keys like ``PLAN-123``, a default assignee, a project
    lead, archive/close retention windows, and a per-project timezone that
    defaults to the parent workspace's timezone unless explicitly overridden
    at creation time.
    """

    # Valid: 0=Secret, 2=Public (matches ProjectNetwork enum)
    NETWORK_CHOICES = ((0, "Secret"), (2, "Public"))
    name = models.CharField(max_length=255, verbose_name="Project Name")
    description = models.TextField(verbose_name="Project Description", blank=True)
    # Shape: ProseMirror document JSON; mirrors description_html
    description_text = models.JSONField(verbose_name="Project Description RT", blank=True, null=True)
    # Shape: rendered HTML representation of description_text, persisted as JSON for client cache stability.
    description_html = models.JSONField(verbose_name="Project Description HTML", blank=True, null=True)
    # Valid: 0 (Secret — explicit members only) | 2 (Public — any workspace member); see NETWORK_CHOICES.
    network = models.PositiveSmallIntegerField(default=2, choices=NETWORK_CHOICES)
    workspace = models.ForeignKey("db.WorkSpace", on_delete=models.CASCADE, related_name="workspace_project")
    identifier = models.CharField(max_length=12, verbose_name="Project Identifier", db_index=True)
    default_assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="default_assignee",
        null=True,
        blank=True,
    )
    project_lead = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="project_lead",
        null=True,
        blank=True,
    )
    emoji = models.CharField(max_length=255, null=True, blank=True)
    # INTENT UNCLEAR: icon descriptor consumed by the project avatar renderer (emoji/icon/color tokens); shape varies per surface.
    icon_prop = models.JSONField(null=True)
    module_view = models.BooleanField(default=False)
    cycle_view = models.BooleanField(default=False)
    issue_views_view = models.BooleanField(default=False)
    page_view = models.BooleanField(default=True)
    intake_view = models.BooleanField(default=False)
    is_time_tracking_enabled = models.BooleanField(default=False)
    is_issue_type_enabled = models.BooleanField(default=False)
    guest_view_all_features = models.BooleanField(default=False)
    # Legacy URL field; superseded by cover_image_asset FK to FileAsset.
    cover_image = models.TextField(blank=True, null=True)
    cover_image_asset = models.ForeignKey(
        "db.FileAsset",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="project_cover_image",
    )
    estimate = models.ForeignKey("db.Estimate", on_delete=models.SET_NULL, related_name="projects", null=True)
    # Months after completion before stale issues auto-archive; 0 disables.
    archive_in = models.IntegerField(default=0, validators=[MinValueValidator(0), MaxValueValidator(12)])
    # Months after completion before issues auto-close; 0 disables.
    close_in = models.IntegerField(default=0, validators=[MinValueValidator(0), MaxValueValidator(12)])
    # INTENT UNCLEAR: emoji/icon/url descriptor consumed by frontend project logo renderer.
    logo_props = models.JSONField(default=dict)
    default_state = models.ForeignKey("db.State", on_delete=models.SET_NULL, null=True, related_name="default_state")
    archived_at = models.DateTimeField(null=True)
    # timezone
    TIMEZONE_CHOICES = tuple(zip(pytz.common_timezones, pytz.common_timezones))
    # Valid: any IANA timezone identifier shipped by pytz; defaults to UTC.
    timezone = models.CharField(max_length=255, default="UTC", choices=TIMEZONE_CHOICES)
    # external_id for imports
    # Set when project was imported from another tool (Jira, Linear, etc.).
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)

    def __init__(self, *args, **kwargs):
        """Track whether ``timezone`` was supplied by the caller.

        Sets ``self.is_timezone_provided`` so ``save()`` can decide whether to inherit
        the parent workspace's timezone (when ``False``) or preserve the explicit value.
        """
        # Track if timezone is provided, if so, don't override it with the workspace timezone when saving
        self.is_timezone_provided = kwargs.get("timezone") is not None
        super().__init__(*args, **kwargs)

    @property
    def cover_image_url(self):
        """Return the cover image URL preferring the modern ``FileAsset`` over the legacy URL field."""
        # Return cover image url
        if self.cover_image_asset:
            return self.cover_image_asset.asset_url

        # Return cover image url
        if self.cover_image:
            return self.cover_image

        return None

    def __str__(self):
        """Return name of the project."""
        return f"{self.name} <{self.workspace.name}>"

    # Identifier validation regex: rejects characters disallowed in URL-safe issue keys.
    FORBIDDEN_IDENTIFIER_CHARS_PATTERN = r"^.*[&+,:;$^}{*=?@#|'<>.()%!-].*$"

    class Meta:
        """Django model metadata for ``Project``."""

        unique_together = [
            ["identifier", "workspace", "deleted_at"],
            ["name", "workspace", "deleted_at"],
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["identifier", "workspace"],
                condition=Q(deleted_at__isnull=True),
                name="project_unique_identifier_workspace_when_deleted_at_null",
            ),
            models.UniqueConstraint(
                fields=["name", "workspace"],
                condition=Q(deleted_at__isnull=True),
                name="project_unique_name_workspace_when_deleted_at_null",
            ),
        ]
        verbose_name = "Project"
        verbose_name_plural = "Projects"
        db_table = "projects"
        ordering = ("-created_at",)

    def save(self, *args, **kwargs):
        """Normalize ``identifier`` and inherit ``workspace.timezone`` on creation.

        Strips and upper-cases ``identifier`` for stable issue-key formatting. When
        the row is being inserted and the caller did NOT supply a timezone, copies
        the parent workspace's timezone so legacy projects keep working without
        explicit configuration.
        """
        from plane.db.models import Workspace

        self.identifier = self.identifier.strip().upper()
        is_creating = self._state.adding

        if is_creating and not self.is_timezone_provided:
            workspace = Workspace.objects.get(id=self.workspace_id)
            self.timezone = workspace.timezone

        return super().save(*args, **kwargs)


class ProjectBaseModel(BaseModel):
    """Abstract mixin for any model that lives inside a ``Project``.

    Provides the ``project`` and ``workspace`` foreign keys with consistent
    ``related_name="project_%(class)s"`` / ``workspace_%(class)s`` reverse
    accessors. ``save()`` derives ``workspace`` from ``project.workspace`` so
    callers only need to set ``project``.
    """

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="project_%(class)s")
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="workspace_%(class)s")

    class Meta:
        """Marks this model as abstract; concrete subclasses inherit the FKs."""

        abstract = True

    def save(self, *args, **kwargs):
        """Auto-populate ``workspace`` from ``project.workspace`` then delegate to ``BaseModel.save``."""
        self.workspace = self.project.workspace
        super(ProjectBaseModel, self).save(*args, **kwargs)


class ProjectMemberInvite(ProjectBaseModel):
    """Pending invitation to join a ``Project`` at a given role.

    Created when an existing workspace member is invited to a project; the
    ``token`` column is consumed by the invite acceptance endpoint. ``role``
    defaults to ``5`` (Guest) per ``ROLE_CHOICES``.
    """

    email = models.CharField(max_length=255)
    accepted = models.BooleanField(default=False)
    token = models.CharField(max_length=255)
    message = models.TextField(null=True)
    responded_at = models.DateTimeField(null=True)
    # Valid: 5=Guest, 15=Member, 20=Admin
    role = models.PositiveSmallIntegerField(choices=ROLE_CHOICES, default=5)

    class Meta:
        """Django model metadata for ``ProjectMemberInvite``."""

        verbose_name = "Project Member Invite"
        verbose_name_plural = "Project Member Invites"
        db_table = "project_member_invites"
        ordering = ("-created_at",)

    def __str__(self):
        """Return invite email and project for admin/debug rendering."""
        return f"{self.project.name} {self.email} {self.accepted}"


class ProjectMember(ProjectBaseModel):
    """User membership in a ``Project`` carrying role, persisted UI prefs, and sort order.

    Auto-creates the companion ``ProjectUserProperty`` row on insert. The
    ``view_props``, ``default_props``, and ``preferences`` JSON columns hold
    per-user persisted UI state for the project (issue filters, page block
    display, etc.).
    """

    member = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="member_project",
    )
    comment = models.TextField(blank=True, null=True)
    # Valid: 5=Guest, 15=Member, 20=Admin
    role = models.PositiveSmallIntegerField(choices=ROLE_CHOICES, default=5)
    # Shape: {filters, display_filters, display_properties} — see get_default_props()
    view_props = models.JSONField(default=get_default_props)
    # Shape: same {filters, display_filters, display_properties} as view_props (see get_default_props);
    # holds the reset-to-default snapshot so the UI can restore view_props to a known baseline.
    default_props = models.JSONField(default=get_default_props)
    # Shape: {pages: {block_display}, navigation: {...}} — see get_default_preferences()
    preferences = models.JSONField(default=get_default_preferences)
    sort_order = models.FloatField(default=65535)
    is_active = models.BooleanField(default=True)

    def save(self, *args, **kwargs):
        """Persist membership and ensure a companion ``ProjectUserProperty`` exists.

        On insert, creates ``ProjectUserProperty`` for ``(project, user)`` if missing
        with a freshly allocated ``sort_order`` of ``min(existing sort_order) - 10000``
        (or ``65535`` when no rows exist yet). This keeps the user's newest projects
        at the top of an ascending-ordered list.
        """
        if self._state.adding and self.member:
            # Get the minimum sort_order for this member in the workspace
            min_sort_order_result = ProjectUserProperty.objects.filter(
                workspace_id=self.project.workspace_id, user=self.member
            ).aggregate(min_sort_order=models.Min("sort_order"))
            min_sort_order = min_sort_order_result.get("min_sort_order")

            # create project user property with project sort order
            ProjectUserProperty.objects.create(
                workspace_id=self.project.workspace_id,
                project=self.project,
                user=self.member,
                sort_order=(min_sort_order - 10000 if min_sort_order is not None else 65535),
            )

        super(ProjectMember, self).save(*args, **kwargs)

    class Meta:
        """Django model metadata for ``ProjectMember``."""

        unique_together = ["project", "member", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "member"],
                condition=Q(deleted_at__isnull=True),
                name="project_member_unique_project_member_when_deleted_at_null",
            )
        ]
        verbose_name = "Project Member"
        verbose_name_plural = "Project Members"
        db_table = "project_members"
        ordering = ("-created_at",)

    def __str__(self):
        """Return members of the project."""
        return f"{self.member.email} <{self.project.name}>"


# TODO: Remove workspace relation later
class ProjectIdentifier(AuditModel):
    """Reservation table enforcing workspace-wide uniqueness of project ``identifier`` keys.

    Decoupled from ``Project`` so an identifier remains reserved even if the
    project is soft-deleted, preventing collision when a new project tries to
    reuse a short key like ``"PLAN"``.
    """

    workspace = models.ForeignKey("db.Workspace", models.CASCADE, related_name="project_identifiers", null=True)
    project = models.OneToOneField(Project, on_delete=models.CASCADE, related_name="project_identifier")
    # Project short key (e.g. "PLAN", "ENG"); upper-cased + URL-safe by Project.save()
    name = models.CharField(max_length=12, db_index=True)

    class Meta:
        """Django model metadata for ``ProjectIdentifier``."""

        unique_together = ["name", "workspace", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["name", "workspace"],
                condition=Q(deleted_at__isnull=True),
                name="unique_name_workspace_when_deleted_at_null",
            )
        ]
        verbose_name = "Project Identifier"
        verbose_name_plural = "Project Identifiers"
        db_table = "project_identifiers"
        ordering = ("-created_at",)


def get_anchor():
    """Return a 32-character hex anchor used by the legacy ``ProjectDeployBoard``."""
    return uuid4().hex


def get_default_views():
    """Return the default ``views`` JSON for ``ProjectDeployBoard`` enabling all layouts."""
    return {
        "list": True,
        "kanban": True,
        "calendar": True,
        "gantt": True,
        "spreadsheet": True,
    }


# DEPRECATED TODO:
# used to get the old anchors for the project deploy boards
class ProjectDeployBoard(ProjectBaseModel):
    """DEPRECATED legacy public-deploy anchor; superseded by the polymorphic ``DeployBoard``.

    Retained for backward-compatible URL resolution of older public project
    pages. New code paths must register anchors via ``apps/api/plane/db/models/deploy_board.py``
    instead. The columns mirror the legacy public-page configuration: comment
    permission, reaction toggle, intake target, vote toggle, and per-layout
    visibility ``views`` JSON.
    """

    # 32-hex anchor identifier; see get_anchor().
    anchor = models.CharField(max_length=255, default=get_anchor, unique=True, db_index=True)
    comments = models.BooleanField(default=False)
    reactions = models.BooleanField(default=False)
    intake = models.ForeignKey("db.Intake", related_name="board_intake", on_delete=models.SET_NULL, null=True)
    votes = models.BooleanField(default=False)
    # Shape: {list, kanban, calendar, gantt, spreadsheet} booleans — see get_default_views()
    views = models.JSONField(default=get_default_views)

    class Meta:
        """Django model metadata for ``ProjectDeployBoard``."""

        unique_together = ["project", "anchor"]
        verbose_name = "Project Deploy Board"
        verbose_name_plural = "Project Deploy Boards"
        db_table = "project_deploy_boards"
        ordering = ("-created_at",)

    def __str__(self):
        """Return project and anchor."""
        return f"{self.anchor} <{self.project.name}>"


class ProjectPublicMember(ProjectBaseModel):
    """Tracks anonymous/external users who have accessed a public project deploy board.

    Used to scope identity to public-shared boards where the visitor is not a
    full workspace member.
    """

    member = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="public_project_members",
    )

    class Meta:
        """Django model metadata for ``ProjectPublicMember``."""

        unique_together = ["project", "member", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "member"],
                condition=models.Q(deleted_at__isnull=True),
                name="project_public_member_unique_project_member_when_deleted_at_null",
            )
        ]
        verbose_name = "Project Public Member"
        verbose_name_plural = "Project Public Members"
        db_table = "project_public_members"
        ordering = ("-created_at",)


class ProjectUserProperty(ProjectBaseModel):
    """Per-user persisted UI state for a project's issue list (filters, layout, sort).

    Auto-created by ``ProjectMember.save()``. The ``filters`` /
    ``display_filters`` / ``display_properties`` JSON columns are populated by
    helpers imported inline from ``.issue`` to avoid a circular import at
    module load time.
    """

    from .issue import get_default_filters, get_default_display_filters, get_default_display_properties

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="project_property_user",
    )
    # Shape: see .issue.get_default_filters() default.
    filters = models.JSONField(default=get_default_filters)
    # Shape: see .issue.get_default_display_filters() default.
    display_filters = models.JSONField(default=get_default_display_filters)
    # Shape: see .issue.get_default_display_properties() default.
    display_properties = models.JSONField(default=get_default_display_properties)
    # INTENT UNCLEAR: structured filter graph consumed by the rich-filter UI; shape varies per consumer.
    rich_filters = models.JSONField(default=dict)
    # INTENT UNCLEAR: free-form per-user project UI preferences blob.
    preferences = models.JSONField(default=get_default_preferences)
    sort_order = models.FloatField(default=65535)

    class Meta:
        """Django model metadata for ``ProjectUserProperty``."""

        verbose_name = "Project User Property"
        verbose_name_plural = "Project User Properties"
        db_table = "project_user_properties"
        ordering = ("-created_at",)
        unique_together = ["user", "project", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "project"],
                condition=Q(deleted_at__isnull=True),
                name="project_user_property_unique_user_project_when_deleted_at_null",
            )
        ]

    def __str__(self):
        """Return properties status of the project."""
        return str(self.user)
