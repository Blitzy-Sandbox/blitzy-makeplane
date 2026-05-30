# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database model for per-user recent-entity-visit tracking.

This module exposes :class:`EntityNameEnum` (the closed set of trackable
entities) and :class:`UserRecentVisit`, a polymorphic record consumed by the
workspace home dashboard to render each user's most recent activity.
"""

# Django imports
from django.db import models
from django.conf import settings

# Module imports
from .workspace import WorkspaceBaseModel


class EntityNameEnum(models.TextChoices):
    """Closed set of entity types that can appear in a user's recent-visit history."""

    VIEW = "VIEW", "View"
    PAGE = "PAGE", "Page"
    ISSUE = "ISSUE", "Issue"
    CYCLE = "CYCLE", "Cycle"
    MODULE = "MODULE", "Module"
    PROJECT = "PROJECT", "Project"


class UserRecentVisit(WorkspaceBaseModel):
    """Records the most recent visit by a user to a workspace entity.

    Polymorphic over ``entity_name`` (one of :class:`EntityNameEnum`); rows are
    upserted by the view-base mixin every time a user accesses a tracked
    entity, and are consumed by the home dashboard's "Recents" widget.
    """

    entity_identifier = models.UUIDField(null=True)
    # Valid: one of EntityNameEnum values — "VIEW" | "PAGE" | "ISSUE" | "CYCLE" | "MODULE" | "PROJECT".
    entity_name = models.CharField(max_length=30)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="user_recent_visit",
    )
    visited_at = models.DateTimeField(auto_now=True)

    class Meta:
        """Django model options: admin labels, table name, and default ordering."""

        verbose_name = "User Recent Visit"
        verbose_name_plural = "User Recent Visits"
        db_table = "user_recent_visits"
        ordering = ("-created_at",)

    def __str__(self):
        """Return entity name and visitor email for admin/debug rendering."""
        return f"{self.entity_name} {self.user.email}"
