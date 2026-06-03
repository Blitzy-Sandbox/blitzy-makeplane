# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database models for project-scoped modules (work-stream initiatives) and per-user module view preferences.

:class:`Module` groups issues into a work-stream with start/target dates, an
optional lead, and a status (:class:`ModuleStatus`); :class:`ModuleMember`,
:class:`ModuleIssue`, :class:`ModuleLink` carry the m2m joins;
:class:`ModuleUserProperties` carries per-user filter/layout overrides.
"""

# Django imports
from django.conf import settings
from django.db import models
from django.db.models import Q

# Module imports
from .project import ProjectBaseModel


def get_default_filters():
    """Return the default ``ModuleUserProperties.filters`` dict (all filter facets unset)."""
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
    """Return the default ``ModuleUserProperties.display_filters`` dict (list layout, newest-first ordering)."""
    return {
        "group_by": None,
        "order_by": "-created_at",
        "type": None,
        "sub_issue": True,
        "show_empty_groups": True,
        "layout": "list",
        "calendar_date_range": "",
    }


def get_default_display_properties():
    """Return the default ``ModuleUserProperties.display_properties`` dict (every issue column enabled)."""
    return {
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


class ModuleStatus(models.TextChoices):
    """Lifecycle phases of a :class:`Module` from backlog through cancelled."""

    BACKLOG = "backlog"
    PLANNED = "planned"
    IN_PROGRESS = "in-progress"
    PAUSED = "paused"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class Module(ProjectBaseModel):
    """Project-scoped work-stream initiative grouping related issues toward a target date.

    Carries an optional ``lead`` user, ``start_date``/``target_date``, a
    members many-to-many through :class:`ModuleMember`, and a ``status`` from
    :class:`ModuleStatus`. ``sort_order`` is allocated newest-first
    (``min - 10000`` per :meth:`save`).
    """

    name = models.CharField(max_length=255, verbose_name="Module Name")
    description = models.TextField(verbose_name="Module Description", blank=True)
    # INTENT UNCLEAR: legacy rich-text description structure; shape varies per editor migration era.
    description_text = models.JSONField(verbose_name="Module Description RT", blank=True, null=True)
    # INTENT UNCLEAR: legacy HTML body stored as JSON; shape varies per editor migration era.
    description_html = models.JSONField(verbose_name="Module Description HTML", blank=True, null=True)
    start_date = models.DateField(null=True)
    target_date = models.DateField(null=True)
    # Valid: ModuleStatus — "backlog" | "planned" | "in-progress" | "paused" | "completed" | "cancelled".
    status = models.CharField(
        choices=(
            ("backlog", "Backlog"),
            ("planned", "Planned"),
            ("in-progress", "In Progress"),
            ("paused", "Paused"),
            ("completed", "Completed"),
            ("cancelled", "Cancelled"),
        ),
        default="planned",
        max_length=20,
    )
    lead = models.ForeignKey("db.User", on_delete=models.SET_NULL, related_name="module_leads", null=True)
    members = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name="module_members",
        through="ModuleMember",
        through_fields=("module", "member"),
    )
    # INTENT UNCLEAR: module-page UI display props consumed by the module layout; shape varies per surface.
    view_props = models.JSONField(default=dict)
    sort_order = models.FloatField(default=65535)
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)
    archived_at = models.DateTimeField(null=True)
    # INTENT UNCLEAR: module logo/icon metadata consumed by the module dropdown; shape varies per surface.
    logo_props = models.JSONField(default=dict)

    class Meta:
        """Django model metadata for ``Module``."""

        unique_together = ["name", "project", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["name", "project"],
                condition=Q(deleted_at__isnull=True),
                name="module_unique_name_project_when_deleted_at_null",
            )
        ]
        verbose_name = "Module"
        verbose_name_plural = "Modules"
        db_table = "modules"
        ordering = ("-created_at",)

    def save(self, *args, **kwargs):
        """Allocate ``sort_order`` BEFORE the project's existing modules on insert.

        New modules land at ``min(existing) - 10000`` so the most recently
        created module sorts first when ordered by ascending ``sort_order``.
        """
        if self._state.adding:
            smallest_sort_order = Module.objects.filter(project=self.project).aggregate(
                smallest=models.Min("sort_order")
            )["smallest"]

            if smallest_sort_order is not None:
                self.sort_order = smallest_sort_order - 10000

        super(Module, self).save(*args, **kwargs)

    def __str__(self):
        """Return the module name + start/target dates for admin/debug rendering."""
        return f"{self.name} {self.start_date} {self.target_date}"


class ModuleMember(ProjectBaseModel):
    """Many-to-many join binding a user to a :class:`Module` as a member."""

    module = models.ForeignKey("db.Module", on_delete=models.CASCADE)
    member = models.ForeignKey("db.User", on_delete=models.CASCADE)

    class Meta:
        """Django model metadata for ``ModuleMember``."""

        unique_together = ["module", "member", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["module", "member"],
                condition=models.Q(deleted_at__isnull=True),
                name="module_member_unique_module_member_when_deleted_at_null",
            )
        ]
        verbose_name = "Module Member"
        verbose_name_plural = "Module Members"
        db_table = "module_members"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the module name + member for admin/debug rendering."""
        return f"{self.module.name} {self.member}"


class ModuleIssue(ProjectBaseModel):
    """Many-to-many join binding an :class:`Issue` to a :class:`Module`."""

    module = models.ForeignKey("db.Module", on_delete=models.CASCADE, related_name="issue_module")
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="issue_module")

    class Meta:
        """Django model metadata for ``ModuleIssue``."""

        unique_together = ["issue", "module", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "module"],
                condition=models.Q(deleted_at__isnull=True),
                name="module_issue_unique_issue_module_when_deleted_at_null",
            )
        ]
        verbose_name = "Module Issue"
        verbose_name_plural = "Module Issues"
        db_table = "module_issues"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the module name + issue name for admin/debug rendering."""
        return f"{self.module.name} {self.issue.name}"


class ModuleLink(ProjectBaseModel):
    """External resource link (URL + optional title + metadata) attached to a :class:`Module`."""

    title = models.CharField(max_length=255, blank=True, null=True)
    url = models.URLField()
    module = models.ForeignKey(Module, on_delete=models.CASCADE, related_name="link_module")
    # INTENT UNCLEAR: opaque per-link metadata (e.g., favicon, og-image); shape varies per link source.
    metadata = models.JSONField(default=dict)

    class Meta:
        """Django model metadata for ``ModuleLink``."""

        verbose_name = "Module Link"
        verbose_name_plural = "Module Links"
        db_table = "module_links"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the module name + URL for admin/debug rendering."""
        return f"{self.module.name} {self.url}"


class ModuleUserProperties(ProjectBaseModel):
    """Per-user × per-module view-preference overrides for filters and display layout.

    Defaults come from the module-level ``get_default_*`` helpers; ``rich_filters``
    is the additive layer for the newer filter-builder UI.
    """

    module = models.ForeignKey("db.Module", on_delete=models.CASCADE, related_name="module_user_properties")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="module_user_properties",
    )
    # Shape: raw user-authored filter dict (see get_default_filters); facet keys -> selected value(s) or None.
    filters = models.JSONField(default=get_default_filters)
    # Shape: display preferences dict (see get_default_display_filters); group_by/order_by/layout/etc.
    display_filters = models.JSONField(default=get_default_display_filters)
    # Shape: per-column visibility dict (see get_default_display_properties); column key -> bool.
    display_properties = models.JSONField(default=get_default_display_properties)
    # INTENT UNCLEAR: structured filter graph consumed by the rich-filter UI; shape varies per consumer.
    rich_filters = models.JSONField(default=dict)

    class Meta:
        """Django model metadata for ``ModuleUserProperties``."""

        unique_together = ["module", "user", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["module", "user"],
                condition=models.Q(deleted_at__isnull=True),
                name="module_user_properties_unique_module_user_when_deleted_at_null",
            )
        ]
        verbose_name = "Module User Property"
        verbose_name_plural = "Module User Property"
        db_table = "module_user_properties"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the module name + user email for admin/debug rendering."""
        return f"{self.module.name} {self.user.email}"
