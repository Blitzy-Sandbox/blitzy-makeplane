# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database model for the public deployment-board anchors used by ``apps/space``.

:class:`DeployBoard` carries the public URL anchor and feature flags for a
publicly deployed Plane entity (project / issue / module / cycle / page / view
/ intake). The legacy :class:`ProjectDeployBoard` in ``project.py`` is the
deprecated predecessor.
"""

# Python imports
from uuid import uuid4

# Django imports
from django.db import models

# Module imports
from .workspace import WorkspaceBaseModel


def get_anchor():
    """Return a hex UUID used as the default public-URL anchor for a deploy board."""
    return uuid4().hex


class DeployBoard(WorkspaceBaseModel):
    """Public-deployment anchor + feature toggles for a workspace entity.

    Each row publishes one workspace entity (project / issue / module / cycle /
    page / view / intake — distinguished by ``entity_name``) to the
    ``apps/space`` public surface under the unique ``anchor`` slug; the
    boolean flags toggle comments, reactions, voting, and activity timelines.
    """

    TYPE_CHOICES = (
        ("project", "Project"),
        ("issue", "Issue"),
        ("module", "Module"),
        ("cycle", "Task"),
        ("page", "Page"),
        ("view", "View"),
        ("intake", "Intake"),
    )

    entity_identifier = models.UUIDField(null=True)
    # Valid: TYPE_CHOICES — "project" | "issue" | "module" | "cycle" | "page" | "view" | "intake".
    entity_name = models.CharField(max_length=30, null=True, blank=True)
    anchor = models.CharField(max_length=255, default=get_anchor, unique=True, db_index=True)
    is_comments_enabled = models.BooleanField(default=False)
    is_reactions_enabled = models.BooleanField(default=False)
    intake = models.ForeignKey("db.Intake", related_name="publish_intake", on_delete=models.SET_NULL, null=True)
    is_votes_enabled = models.BooleanField(default=False)
    # INTENT UNCLEAR: deploy-board UI display props consumed by apps/space; shape varies per entity_name.
    view_props = models.JSONField(default=dict)
    is_activity_enabled = models.BooleanField(default=True)
    is_disabled = models.BooleanField(default=False)

    def __str__(self):
        """Return name of the deploy board."""
        return f"{self.entity_identifier} <{self.entity_name}>"

    class Meta:
        """Database table metadata for ``DeployBoard``."""

        unique_together = ["entity_name", "entity_identifier", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["entity_name", "entity_identifier"],
                condition=models.Q(deleted_at__isnull=True),
                name="deploy_board_unique_entity_name_entity_identifier_when_deleted_at_null",
            )
        ]
        verbose_name = "Deploy Board"
        verbose_name_plural = "Deploy Boards"
        db_table = "deploy_boards"
        ordering = ("-created_at",)
