# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database model for workspace-scoped saved analytics views.

This module defines :class:`AnalyticView`, a persistence record that captures a
user-saved analytics query payload along with a derived dictionary representation
for downstream rendering by analytics widgets and dashboards.
"""

# Django models
from django.db import models

from .base import BaseModel


class AnalyticView(BaseModel):
    """Persists a named, workspace-scoped analytics query for later replay.

    Each row captures a free-form analytics query payload (``query``) plus a
    structured dictionary representation (``query_dict``) so the analytics layer
    can re-render saved views without re-parsing the original query string.
    """

    workspace = models.ForeignKey("db.Workspace", related_name="analytics", on_delete=models.CASCADE)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    # INTENT UNCLEAR: free-form analytics query payload; shape determined by the analytics view consuming it.
    query = models.JSONField()
    # INTENT UNCLEAR: derived dictionary representation of ``query`` used by rendering helpers.
    query_dict = models.JSONField(default=dict)

    class Meta:
        """Django model metadata: human-readable labels, table name, and default ordering."""

        verbose_name = "Analytic"
        verbose_name_plural = "Analytics"
        db_table = "analytic_views"
        ordering = ("-created_at",)

    def __str__(self):
        """Return name of the analytic view."""
        return f"{self.name} <{self.workspace.name}>"
