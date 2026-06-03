# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace-domain ORM models for Plane.

Defines the top-level ``Workspace`` tenant container, the abstract
``WorkspaceBaseModel`` consumed by workspace-scoped tables that may also
reference a project, membership and invitation models, teams, themes, and the
per-user workspace preference tables that power the workspace home page and
sidebar customization. Workspace slugs are reserved against
``RESTRICTED_WORKSPACE_SLUGS`` and are mangled on soft delete so the slug can
be reused by a fresh workspace.
"""

# Python imports
import pytz
from typing import Optional, Any

# Django imports
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

# Module imports
from .base import BaseModel
from plane.utils.constants import RESTRICTED_WORKSPACE_SLUGS
from plane.utils.color import get_random_color

ROLE_CHOICES = ((20, "Admin"), (15, "Member"), (5, "Guest"))


def get_default_props():
    """Return the default ``view_props`` and ``default_props`` payload for ``WorkspaceMember``.

    Shape: ``{"filters": {...}, "display_filters": {...}, "display_properties": {...}}``
    matches the workspace issue list view's persisted preferences contract.
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
        "display_properties": {
            "assignee": True,
            "attachment_count": True,
            "created_on": True,
            "due_date": True,
            "estimate": True,
            "key": True,
            "labels": True,
            "link": True,
            "priority": True,
            "start_date": True,
            "state": True,
            "sub_issue_count": True,
            "updated_on": True,
        },
    }


def get_default_filters():
    """Return the default ``filters`` JSON for ``WorkspaceUserProperties``."""
    return {
        "priority": None,
        "state": None,
        "state_group": None,
        "assignees": None,
        "created_by": None,
        "labels": None,
        "start_date": None,
        "target_date": None,
        "subscriber": None,
    }


def get_default_display_filters():
    """Return the default ``display_filters`` JSON for ``WorkspaceUserProperties``."""
    return {
        "display_filters": {
            "group_by": None,
            "order_by": "-created_at",
            "type": None,
            "sub_issue": True,
            "show_empty_groups": True,
            "layout": "list",
            "calendar_date_range": "",
        }
    }


def get_default_display_properties():
    """Return the default ``display_properties`` JSON for ``WorkspaceUserProperties``."""
    return {
        "display_properties": {
            "assignee": True,
            "attachment_count": True,
            "created_on": True,
            "due_date": True,
            "estimate": True,
            "key": True,
            "labels": True,
            "link": True,
            "priority": True,
            "start_date": True,
            "state": True,
            "sub_issue_count": True,
            "updated_on": True,
        }
    }


def get_issue_props():
    """Return the default per-member ``issue_props`` payload for the workspace issue UI."""
    return {"subscribed": True, "assigned": True, "created": True, "all_issues": True}


def slug_validator(value):
    """Reject workspace slugs that collide with reserved app routes.

    Raises ``ValidationError`` when ``value`` is in ``RESTRICTED_WORKSPACE_SLUGS``
    (e.g., ``"admin"``, ``"login"``) to prevent URL ambiguity between tenant
    paths and app-level routes.
    """
    if value in RESTRICTED_WORKSPACE_SLUGS:
        raise ValidationError("Slug is not valid")


class Workspace(BaseModel):
    """Top-level multi-tenant container that owns projects, members, and configuration.

    A workspace carries a globally unique URL ``slug`` (validated against the
    reserved list and partial-indexed on soft-delete), a single ``owner`` user,
    a per-workspace ``timezone`` inherited by member projects unless explicitly
    overridden, a ``background_color`` for the UI shell, and dual logo storage
    (legacy ``logo`` TextField + modern ``logo_asset`` FK to ``FileAsset``).
    """

    TIMEZONE_CHOICES = tuple(zip(pytz.common_timezones, pytz.common_timezones))

    name = models.CharField(max_length=80, verbose_name="Workspace Name")  # Display name shown in workspace switcher.
    # Legacy URL or data-URI; superseded by logo_asset FK to FileAsset.
    logo = models.TextField(verbose_name="Logo", blank=True, null=True)
    logo_asset = models.ForeignKey(
        "db.FileAsset",
        on_delete=models.SET_NULL,
        related_name="workspace_logo",
        blank=True,
        null=True,
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="owner_workspace",
    )
    # Globally unique URL identifier; validated against RESTRICTED_WORKSPACE_SLUGS.
    slug = models.SlugField(max_length=48, db_index=True, unique=True, validators=[slug_validator])
    # INTENT UNCLEAR: free-text size bucket (e.g., "1-10", "11-50") captured during onboarding.
    organization_size = models.CharField(max_length=20, blank=True, null=True)
    # Valid: any IANA timezone identifier shipped by pytz; inherited by member projects.
    timezone = models.CharField(max_length=255, default="UTC", choices=TIMEZONE_CHOICES)
    # Hex color with leading '#'; seeded randomly via get_random_color.
    background_color = models.CharField(max_length=255, default=get_random_color)

    def __str__(self):
        """Return the workspace name."""
        return self.name

    @property
    def logo_url(self):
        """Return the logo URL preferring the modern ``FileAsset`` over the legacy ``logo`` field."""
        # Return the logo asset url if it exists
        if self.logo_asset:
            return self.logo_asset.asset_url

        # Return the logo url if it exists
        if self.logo:
            return self.logo
        return None

    def delete(self, using: Optional[str] = None, soft: bool = True, *args: Any, **kwargs: Any):
        """
        Override the delete method to append epoch timestamp to the slug when soft deleting.

        Args:
            using: The database alias to use for the deletion.
            soft: Whether to perform a soft delete (True) or hard delete (False).
            *args: Additional positional arguments.
            **kwargs: Additional keyword arguments.
        """
        # Call the parent class's delete method first
        result = super().delete(using=using, soft=soft, *args, **kwargs)

        # If it's a soft delete and the model still exists (not hard deleted)
        if soft and hasattr(self, "deleted_at") and self.deleted_at:
            # Use the deleted_at timestamp to update the slug
            deletion_timestamp: int = int(self.deleted_at.timestamp())
            self.slug = f"{self.slug}__{deletion_timestamp}"
            self.save(update_fields=["slug"])

        return result

    class Meta:
        """Database table metadata for ``Workspace``."""

        verbose_name = "Workspace"
        verbose_name_plural = "Workspaces"
        db_table = "workspaces"
        ordering = ("-created_at",)


class WorkspaceBaseModel(BaseModel):
    """Abstract mixin for workspace-scoped models that may also belong to a project.

    Provides the required ``workspace`` FK and an OPTIONAL ``project`` FK. When
    a caller sets ``project``, ``save()`` derives ``workspace`` from
    ``project.workspace`` to keep the two columns consistent. Distinct from
    ``ProjectBaseModel`` (in ``project.py``) which requires both FKs and always
    derives workspace from project.
    """

    workspace = models.ForeignKey("db.Workspace", models.CASCADE, related_name="workspace_%(class)s")
    project = models.ForeignKey("db.Project", models.CASCADE, related_name="project_%(class)s", null=True)

    class Meta:
        """Mark ``WorkspaceBaseModel`` as an abstract base so no DB table is created."""

        abstract = True

    def save(self, *args, **kwargs):
        """Derive ``workspace`` from ``project.workspace`` when a project is attached."""
        if self.project:
            self.workspace = self.project.workspace
        super(WorkspaceBaseModel, self).save(*args, **kwargs)


class WorkspaceMember(BaseModel):
    """User membership in a ``Workspace`` carrying role, persisted UI prefs, and onboarding state.

    The ``role`` field uses the same ``ROLE_CHOICES`` (5/15/20) as ``ProjectMember``.
    ``getting_started_checklist``, ``tips``, and ``explored_features`` JSON
    columns persist per-user onboarding progress so the UI can dismiss already-
    completed prompts. Soft-delete-aware uniqueness is enforced via the
    ``workspace_member_unique_workspace_member_when_deleted_at_null`` partial
    index.
    """

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="workspace_member")
    member = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="member_workspace",
    )
    role = models.PositiveSmallIntegerField(choices=ROLE_CHOICES, default=5)  # Valid: 5=Guest, 15=Member, 20=Admin
    company_role = models.TextField(null=True, blank=True)  # Free-text job title captured at onboarding; not enforced.
    # Shape: {filters, display_filters, display_properties} — see get_default_props().
    view_props = models.JSONField(default=get_default_props)
    # Shape: same {filters, display_filters, display_properties} as view_props (see get_default_props);
    # holds the reset-to-default snapshot so the UI can restore view_props to a known baseline.
    default_props = models.JSONField(default=get_default_props)
    # Shape: per-tab issue visibility bools (see get_issue_props): {subscribed, assigned, created, all_issues}.
    issue_props = models.JSONField(default=get_issue_props)
    is_active = models.BooleanField(default=True)
    # Shape: per-user map of onboarding step keys to completion bool/timestamp.
    getting_started_checklist = models.JSONField(default=dict)
    tips = models.JSONField(default=dict)  # INTENT UNCLEAR: dismissed in-app tip keys.
    # INTENT UNCLEAR: feature discovery telemetry consumed by the UI.
    explored_features = models.JSONField(default=dict)

    class Meta:
        """Database table metadata for ``WorkspaceMember``."""

        unique_together = ["workspace", "member", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "member"],
                condition=models.Q(deleted_at__isnull=True),
                name="workspace_member_unique_workspace_member_when_deleted_at_null",
            )
        ]
        verbose_name = "Workspace Member"
        verbose_name_plural = "Workspace Members"
        db_table = "workspace_members"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the member email and workspace name for admin/debug rendering."""
        return f"{self.member.email} <{self.workspace.name}>"


class WorkspaceMemberInvite(BaseModel):
    """Pending invitation to join a ``Workspace`` at a given role.

    Created when an admin emails an invite link. The ``token`` column is
    consumed by the workspace invite acceptance endpoint and ``accepted`` flips
    to ``True`` on redemption. ``role`` defaults to ``5`` (Guest).
    """

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="workspace_member_invite")
    email = models.CharField(max_length=255)
    accepted = models.BooleanField(default=False)
    token = models.CharField(max_length=255)
    message = models.TextField(null=True)
    responded_at = models.DateTimeField(null=True)
    role = models.PositiveSmallIntegerField(choices=ROLE_CHOICES, default=5)  # Valid: 5=Guest, 15=Member, 20=Admin

    class Meta:
        """Database table metadata for ``WorkspaceMemberInvite``."""

        unique_together = ["email", "workspace", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["email", "workspace"],
                condition=models.Q(deleted_at__isnull=True),
                name="workspace_member_invite_unique_email_workspace_when_deleted_at_null",
            )
        ]
        verbose_name = "Workspace Member Invite"
        verbose_name_plural = "Workspace Member Invites"
        db_table = "workspace_member_invites"
        ordering = ("-created_at",)

    def __str__(self):
        """Return invite identity for admin/debug rendering."""
        return f"{self.workspace.name} {self.email} {self.accepted}"


class Team(BaseModel):
    """Named grouping of workspace members for assignment and notification fan-out.

    A team aggregates members for use as a shorthand assignee/notifiable in
    issue automations and notifications. The ``logo_props`` JSON drives the
    team avatar rendering on the frontend.
    """

    name = models.CharField(max_length=255, verbose_name="Team Name")
    description = models.TextField(verbose_name="Team Description", blank=True)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="workspace_team")
    # INTENT UNCLEAR: emoji/icon/color descriptor consumed by frontend team avatar renderer.
    logo_props = models.JSONField(default=dict)

    def __str__(self):
        """Return the team name and workspace name for admin/debug rendering."""
        return f"{self.name} <{self.workspace.name}>"

    class Meta:
        """Database table metadata for ``Team``."""

        unique_together = ["name", "workspace", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["name", "workspace"],
                condition=models.Q(deleted_at__isnull=True),
                name="team_unique_name_workspace_when_deleted_at_null",
            )
        ]
        verbose_name = "Team"
        verbose_name_plural = "Teams"
        db_table = "teams"
        ordering = ("-created_at",)


class WorkspaceTheme(BaseModel):
    """User-saved color theme scoped to a single workspace.

    Each ``actor`` (the creating user) can save multiple named themes per
    workspace; the ``colors`` JSON holds the palette consumed by the UI's CSS
    custom-property loader.
    """

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="themes")
    name = models.CharField(max_length=300)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="themes")
    # Shape: {primary, background, text, sidebar, ...} hex color tokens consumed by the CSS variable loader.
    colors = models.JSONField(default=dict)

    def __str__(self):
        """Return theme name and creator email for admin/debug rendering."""
        return str(self.name) + str(self.actor.email)

    class Meta:
        """Database table metadata for ``WorkspaceTheme``."""

        unique_together = ["workspace", "name", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "name"],
                condition=models.Q(deleted_at__isnull=True),
                name="workspace_theme_unique_workspace_name_when_deleted_at_null",
            )
        ]
        verbose_name = "Workspace Theme"
        verbose_name_plural = "Workspace Themes"
        db_table = "workspace_themes"
        ordering = ("-created_at",)


class WorkspaceUserProperties(BaseModel):
    """Per-user persisted UI state for the workspace-level issue list and navigation.

    Holds filters, display filters, display properties, and rich filters for
    workspace-scoped issue views, plus the ``navigation_project_limit`` and
    ``navigation_control_preference`` controlling the sidebar project list
    rendering. One row per (workspace, user) is enforced via a soft-delete-
    aware partial unique constraint.
    """

    class NavigationControlPreference(models.TextChoices):
        """Workspace sidebar navigation rendering mode.

        ACCORDION (default) collapses project nav into expandable sections;
        TABBED renders project nav as a flat tab strip.
        """

        ACCORDION = "ACCORDION", "Accordion"
        TABBED = "TABBED", "Tabbed"

    workspace = models.ForeignKey(
        "db.Workspace",
        on_delete=models.CASCADE,
        related_name="workspace_user_properties",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="workspace_user_properties",
    )
    filters = models.JSONField(default=get_default_filters)  # Shape: see get_default_filters() default.
    # Shape: see get_default_display_filters() default.
    display_filters = models.JSONField(default=get_default_display_filters)
    # Shape: see get_default_display_properties() default.
    display_properties = models.JSONField(default=get_default_display_properties)
    # INTENT UNCLEAR: structured filter graph consumed by the rich-filter UI; shape varies per consumer.
    rich_filters = models.JSONField(default=dict)
    # Maximum project entries shown in the sidebar before "Show more" collapses the list.
    navigation_project_limit = models.IntegerField(default=10)
    # Valid: "ACCORDION" | "TABBED" — see NavigationControlPreference.
    navigation_control_preference = models.CharField(
        max_length=25,
        choices=NavigationControlPreference.choices,
        default=NavigationControlPreference.ACCORDION,
    )

    class Meta:
        """Database table metadata for ``WorkspaceUserProperties``."""

        unique_together = ["workspace", "user", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "user"],
                condition=models.Q(deleted_at__isnull=True),
                name="workspace_user_properties_unique_workspace_user_when_deleted_at_null",
            )
        ]
        verbose_name = "Workspace User Property"
        verbose_name_plural = "Workspace User Property"
        db_table = "workspace_user_properties"
        ordering = ("-created_at",)

    def __str__(self):
        """Return workspace and user email for admin/debug rendering."""
        return f"{self.workspace.name} {self.user.email}"


class WorkspaceUserLink(WorkspaceBaseModel):
    """User-saved external link pinned in the workspace sidebar.

    The ``metadata`` JSON typically carries OpenGraph-style preview data
    (favicon, title) when present; the link belongs to ``owner`` (the creating
    user) and may optionally be project-scoped via the inherited ``project``
    FK from ``WorkspaceBaseModel``.
    """

    title = models.CharField(max_length=255, null=True, blank=True)
    url = models.TextField()
    # Shape: {title, favicon, description} OpenGraph preview tokens; may be empty.
    metadata = models.JSONField(default=dict)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="owner_workspace_user_link",
    )

    class Meta:
        """Database table metadata for ``WorkspaceUserLink``."""

        verbose_name = "Workspace User Link"
        verbose_name_plural = "Workspace User Links"
        db_table = "workspace_user_links"
        ordering = ("-created_at",)

    def __str__(self):
        """Return workspace id and link URL for admin/debug rendering."""
        return f"{self.workspace.id} {self.url}"


class WorkspaceHomePreference(BaseModel):
    """Per-user enable/order preferences for the workspace home page widgets.

    Each row pins one ``HomeWidgetKeys`` entry to a user's home page with a
    ``sort_order`` and an ``is_enabled`` toggle; the ``config`` JSON holds the
    widget's per-instance configuration if any.
    """

    class HomeWidgetKeys(models.TextChoices):
        """Enum of widgets that can be pinned to the workspace home page.

        QUICK_LINKS, RECENTS, MY_STICKIES, NEW_AT_PLANE, QUICK_TUTORIAL — each
        keyed value is consumed by the workspace home page widget registry.
        """

        QUICK_LINKS = "quick_links", "Quick Links"
        RECENTS = "recents", "Recents"
        MY_STICKIES = "my_stickies", "My Stickies"
        NEW_AT_PLANE = "new_at_plane", "New at Plane"
        QUICK_TUTORIAL = "quick_tutorial", "Quick Tutorial"

    workspace = models.ForeignKey(
        "db.Workspace",
        on_delete=models.CASCADE,
        related_name="workspace_user_home_preferences",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="workspace_user_home_preferences",
    )
    # Valid: any HomeWidgetKeys value (declared as free-text CharField, not enforced at DB level).
    key = models.CharField(max_length=255)
    is_enabled = models.BooleanField(default=True)
    # INTENT UNCLEAR: per-widget instance configuration; shape depends on the widget key.
    config = models.JSONField(default=dict)
    # Lower values render earlier; default 65535 places new widgets at the bottom.
    sort_order = models.FloatField(default=65535)

    class Meta:
        """Database table metadata for ``WorkspaceHomePreference``."""

        unique_together = ["workspace", "user", "key", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "user", "key"],
                condition=models.Q(deleted_at__isnull=True),
                name="workspace_user_home_preferences_unique_workspace_user_key_when_deleted_at_null",
            )
        ]
        verbose_name = "Workspace Home Preference"
        verbose_name_plural = "Workspace Home Preferences"
        db_table = "workspace_home_preferences"
        ordering = ("-created_at",)

    def __str__(self):
        """Return workspace, user, and widget key for admin/debug rendering."""
        return f"{self.workspace.name} {self.user.email} {self.key}"


class WorkspaceUserPreference(BaseModel):
    """Per-user pinned/sorted preference for top-level workspace navigation entries.

    Distinct from ``WorkspaceHomePreference`` (which controls home-page
    widgets), this table controls pinning and order of major workspace
    sections in the sidebar (Views, Active Cycles, Analytics, Drafts, Your
    Work, Archives, Stickies) per ``UserPreferenceKeys``.
    """

    class UserPreferenceKeys(models.TextChoices):
        """Enum of sidebar navigation entries that can be pinned/sorted per user."""

        VIEWS = "views", "Views"
        ACTIVE_CYCLES = "active_cycles", "Active Cycles"
        ANALYTICS = "analytics", "Analytics"
        DRAFTS = "drafts", "Drafts"
        YOUR_WORK = "your_work", "Your Work"
        ARCHIVES = "archives", "Archives"
        STICKIES = "stickies", "Stickies"

    workspace = models.ForeignKey(
        "db.Workspace",
        on_delete=models.CASCADE,
        related_name="workspace_user_preferences",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="workspace_user_preferences",
    )
    # Valid: any UserPreferenceKeys value (declared as free-text CharField, not enforced at DB level).
    key = models.CharField(max_length=255)
    # When True, entry appears in the pinned section above unpinned entries.
    is_pinned = models.BooleanField(default=False)
    # Lower values render earlier; default 65535 places new entries at the bottom.
    sort_order = models.FloatField(default=65535)

    class Meta:
        """Database table metadata for ``WorkspaceUserPreference``."""

        unique_together = ["workspace", "user", "key", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "user", "key"],
                condition=models.Q(deleted_at__isnull=True),
                name="workspace_user_preferences_unique_workspace_user_key_when_deleted_at_null",
            )
        ]
        verbose_name = "Workspace User Preference"
        verbose_name_plural = "Workspace User Preferences"
        db_table = "workspace_user_preferences"
        ordering = ("-created_at",)
