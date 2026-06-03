# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database models for workspace- and project-scoped issue type definitions.

Defines :class:`IssueType` (the workspace-scoped definition of an issue
category such as "Bug" or "Epic", marked via ``is_epic``) and
:class:`ProjectIssueType` (the per-project enablement join that activates a
workspace issue type in a given project).
"""

# Django imports
from django.db import models
from django.db.models import Q

# Module imports
from .project import ProjectBaseModel
from .base import BaseModel


class IssueType(BaseModel):
    """Workspace-scoped definition of an issue category (e.g., "Bug", "Task", "Epic").

    ``is_epic`` flags an issue type as the workspace's epic-tier item;
    ``is_default`` marks the default type used when no explicit type is set
    on a new issue. ``logo_props`` carries the icon metadata rendered in the
    type dropdown and ``level`` orders the type within the workspace's
    type-picker UI.
    """

    workspace = models.ForeignKey("db.Workspace", related_name="issue_types", on_delete=models.CASCADE)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    # INTENT UNCLEAR: type-icon metadata consumed by the type dropdown; shape varies per surface.
    logo_props = models.JSONField(default=dict)
    is_epic = models.BooleanField(default=False)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    level = models.FloatField(default=0)
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)

    class Meta:
        """Django metadata: ``issue_types`` table holding workspace-scoped issue type rows."""

        verbose_name = "Issue Type"
        verbose_name_plural = "Issue Types"
        db_table = "issue_types"

    def __str__(self):
        """Return the issue-type name for admin/debug rendering."""
        return self.name


class ProjectIssueType(ProjectBaseModel):
    """Per-project enablement of a workspace :class:`IssueType` with the project-scoped default and order."""

    issue_type = models.ForeignKey("db.IssueType", related_name="project_issue_types", on_delete=models.CASCADE)
    level = models.PositiveIntegerField(default=0)
    is_default = models.BooleanField(default=False)

    class Meta:
        """Django metadata for ``project_issue_types`` with per-project uniqueness on ``issue_type``."""

        unique_together = ["project", "issue_type", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "issue_type"],
                condition=Q(deleted_at__isnull=True),
                name="project_issue_type_unique_project_issue_type_when_deleted_at_null",
            )
        ]
        verbose_name = "Project Issue Type"
        verbose_name_plural = "Project Issue Types"
        db_table = "project_issue_types"
        ordering = ("project", "issue_type")

    def __str__(self):
        """Return the project + issue-type pair for admin/debug rendering."""
        return f"{self.project} - {self.issue_type}"
