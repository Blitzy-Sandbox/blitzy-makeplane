# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database model for workspace- or project-scoped issue labels.

Defines :class:`Label`, a self-referential model supporting parent/child label
hierarchies; uniqueness is enforced separately for workspace-global labels
(``project IS NULL``) and project-scoped labels via two partial unique
constraints that honor soft-delete.
"""

from django.db import models
from django.db.models import Q

from .workspace import WorkspaceBaseModel


class Label(WorkspaceBaseModel):
    """Workspace- or project-scoped issue label.

    Labels with ``project IS NULL`` are workspace-global; labels with a non-null
    project are scoped to that project. The ``parent`` foreign key supports
    nested label hierarchies. ``sort_order`` is auto-allocated at the end of
    the existing label list on insert.
    """

    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="parent_label",
    )
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    color = models.CharField(max_length=255, blank=True)
    sort_order = models.FloatField(default=65535)
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)

    class Meta:
        """Django model metadata: soft-delete-aware partial unique constraints, table name, and ordering."""

        constraints = [
            # Enforce uniqueness of name when project is NULL and deleted_at is NULL
            models.UniqueConstraint(
                fields=["name"],
                condition=Q(project__isnull=True, deleted_at__isnull=True),
                name="unique_name_when_project_null_and_not_deleted",
            ),
            # Enforce uniqueness of project and name when project is not NULL and deleted_at is NULL
            models.UniqueConstraint(
                fields=["project", "name"],
                condition=Q(project__isnull=False, deleted_at__isnull=True),
                name="unique_project_name_when_not_deleted",
            ),
        ]
        verbose_name = "Label"
        verbose_name_plural = "Labels"
        db_table = "labels"
        ordering = ("-created_at",)

    def save(self, *args, **kwargs):
        """Allocate the next ``sort_order`` slot (max + 10000) when inserting a new label."""
        if self._state.adding:
            # Get the maximum sequence value from the database
            last_id = Label.objects.filter(project=self.project).aggregate(largest=models.Max("sort_order"))["largest"]
            # if last_id is not None
            if last_id is not None:
                self.sort_order = last_id + 10000

        super(Label, self).save(*args, **kwargs)

    def __str__(self):
        """Return the label name for admin/debug rendering."""
        return str(self.name)
