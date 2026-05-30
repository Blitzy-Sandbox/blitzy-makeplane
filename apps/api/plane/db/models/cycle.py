# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database models for project-scoped cycles (sprints) and per-user cycle view preferences.

:class:`Cycle` is a time-boxed iteration owned by a project; :class:`CycleIssue`
is the issue-to-cycle join; :class:`CycleUserProperties` carries the
per-user filter/layout overrides shown when a user opens a cycle.
"""

# Python imports
import pytz

# Django imports
from django.conf import settings
from django.db import models

# Module imports
from .project import ProjectBaseModel


def get_default_filters():
    """Return the default ``CycleUserProperties.filters`` dict (all filter facets unset)."""
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
    """Return the default ``CycleUserProperties.display_filters`` dict (list layout, newest-first ordering)."""
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
    """Return the default ``CycleUserProperties.display_properties`` dict (every issue column enabled)."""
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


class Cycle(ProjectBaseModel):
    """Time-boxed iteration (sprint) in a project's planning cadence.

    Owned by a single user (``owned_by``) and bounded by ``start_date``/``end_date``
    in the cycle's own ``timezone``. ``progress_snapshot`` captures completion
    metrics frozen at archive time so historical cycles render without
    re-running aggregations.
    """

    name = models.CharField(max_length=255, verbose_name="Cycle Name")
    description = models.TextField(verbose_name="Cycle Description", blank=True)
    start_date = models.DateTimeField(verbose_name="Start Date", blank=True, null=True)
    end_date = models.DateTimeField(verbose_name="End Date", blank=True, null=True)
    owned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="owned_by_cycle",
    )
    # INTENT UNCLEAR: cycle-page UI display props consumed by the cycle layout; shape varies per surface.
    view_props = models.JSONField(default=dict)
    sort_order = models.FloatField(default=65535)
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)
    # Shape: frozen completion-metric aggregate captured at archive time (counts by state group, assignee, etc.).
    progress_snapshot = models.JSONField(default=dict)
    archived_at = models.DateTimeField(null=True)
    # INTENT UNCLEAR: cycle logo/icon metadata consumed by the cycle dropdown; shape varies per surface.
    logo_props = models.JSONField(default=dict)
    # timezone
    TIMEZONE_CHOICES = tuple(zip(pytz.common_timezones, pytz.common_timezones))
    # Valid: any pytz.common_timezones member (TIMEZONE_CHOICES = zip(common_timezones, common_timezones)).
    timezone = models.CharField(max_length=255, default="UTC", choices=TIMEZONE_CHOICES)
    version = models.IntegerField(default=1)

    class Meta:
        """Django model metadata for ``Cycle``."""

        verbose_name = "Cycle"
        verbose_name_plural = "Cycles"
        db_table = "cycles"
        ordering = ("-created_at",)

    def save(self, *args, **kwargs):
        """Allocate ``sort_order`` BEFORE the project's existing cycles on insert.

        New cycles land at ``min(existing) - 10000`` so the most recently
        created cycle sorts first when ordered by ascending ``sort_order``.
        """
        if self._state.adding:
            smallest_sort_order = Cycle.objects.filter(project=self.project).aggregate(
                smallest=models.Min("sort_order")
            )["smallest"]

            if smallest_sort_order is not None:
                self.sort_order = smallest_sort_order - 10000

        super(Cycle, self).save(*args, **kwargs)

    def __str__(self):
        """Return name of the cycle."""
        return f"{self.name} <{self.project.name}>"


class CycleIssue(ProjectBaseModel):
    """Join row binding one :class:`Issue` to one :class:`Cycle` within a project."""

    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="issue_cycle")
    cycle = models.ForeignKey(Cycle, on_delete=models.CASCADE, related_name="issue_cycle")

    class Meta:
        """Django model metadata for ``CycleIssue``."""

        unique_together = ["issue", "cycle", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["cycle", "issue"],
                condition=models.Q(deleted_at__isnull=True),
                name="cycle_issue_when_deleted_at_null",
            )
        ]
        verbose_name = "Cycle Issue"
        verbose_name_plural = "Cycle Issues"
        db_table = "cycle_issues"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the parent cycle's stringification for admin/debug rendering."""
        return f"{self.cycle}"


class CycleUserProperties(ProjectBaseModel):
    """Per-user × per-cycle view-preference overrides for filters and display layout.

    Defaults come from the module-level ``get_default_*`` helpers; ``rich_filters``
    is an additive layer for the newer filter-builder UI (see the rich-filter
    refactor in the cycle layout components).
    """

    cycle = models.ForeignKey("db.Cycle", on_delete=models.CASCADE, related_name="cycle_user_properties")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="cycle_user_properties",
    )
    filters = models.JSONField(default=get_default_filters)
    display_filters = models.JSONField(default=get_default_display_filters)
    display_properties = models.JSONField(default=get_default_display_properties)
    rich_filters = models.JSONField(default=dict)

    class Meta:
        """Django model metadata for ``CycleUserProperties``."""

        unique_together = ["cycle", "user", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["cycle", "user"],
                condition=models.Q(deleted_at__isnull=True),
                name="cycle_user_properties_unique_cycle_user_when_deleted_at_null",
            )
        ]
        verbose_name = "Cycle User Property"
        verbose_name_plural = "Cycle User Properties"
        db_table = "cycle_user_properties"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the cycle name + user email for admin/debug rendering."""
        return f"{self.cycle.name} {self.user.email}"
