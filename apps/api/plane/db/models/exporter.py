# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database model for asynchronous data export job history.

Each :class:`ExporterHistory` row tracks one workspace-scoped export job
(issues or worklogs) emitted in JSON, CSV, or XLSX. The actual generation
runs asynchronously via Celery on RabbitMQ (see
``apps/api/plane/bgtasks/export_task.py`` and ``analytic_plot_export.py``);
this row carries the job status, the presigned S3/MinIO download URL, and
the audit trail required by the exporter ViewSets.
"""

import uuid

# Python imports
from uuid import uuid4

from django.conf import settings
from django.contrib.postgres.fields import ArrayField

# Django imports
from django.db import models

# Module imports
from .base import BaseModel


def generate_token():
    """Return a hex token used as the exporter row's unique lookup key."""
    return uuid4().hex


class ExporterHistory(BaseModel):
    """Records a single workspace-scoped data export job.

    Rows are created by the exporter ViewSets and updated by background
    Celery workers as the export progresses. Completed jobs expose a
    presigned download URL via the ``url`` field; ``key`` references the
    storage object directly.
    """

    name = models.CharField(max_length=255, verbose_name="Exporter Name", null=True, blank=True)
    # Valid: "issue_exports" | "issue_worklogs" — selects the data domain to serialize.
    type = models.CharField(
        max_length=50,
        default="issue_exports",
        choices=(
            ("issue_exports", "Issue Exports"),
            ("issue_worklogs", "Issue Worklogs"),
        ),
    )
    workspace = models.ForeignKey("db.WorkSpace", on_delete=models.CASCADE, related_name="workspace_exporters")
    project = ArrayField(models.UUIDField(default=uuid.uuid4), blank=True, null=True)
    # Valid: "json" | "csv" | "xlsx" — output file format produced by the export task.
    provider = models.CharField(max_length=50, choices=(("json", "json"), ("csv", "csv"), ("xlsx", "xlsx")))
    # Valid: "queued" | "processing" | "completed" | "failed" — Celery worker advances this through the lifecycle.
    status = models.CharField(
        max_length=50,
        choices=(
            ("queued", "Queued"),
            ("processing", "Processing"),
            ("completed", "Completed"),
            ("failed", "Failed"),
        ),
        default="queued",
    )
    reason = models.TextField(blank=True)
    key = models.TextField(blank=True)
    url = models.URLField(max_length=800, blank=True, null=True)
    token = models.CharField(max_length=255, default=generate_token, unique=True)
    initiated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="workspace_exporters",
    )
    # Shape: issue-filter payload (priority/state/assignees/labels/date predicates) consumed by export_task.
    filters = models.JSONField(blank=True, null=True)
    # INTENT UNCLEAR: extended-filter payload using the same grammar as ``filters``; superset semantics undocumented.
    rich_filters = models.JSONField(default=dict, blank=True, null=True)

    class Meta:
        """Database table metadata for ``ExporterHistory`` (``exporters`` table, newest-first)."""

        verbose_name = "Exporter"
        verbose_name_plural = "Exporters"
        db_table = "exporters"
        ordering = ("-created_at",)

    def __str__(self):
        """Return name of the service."""
        return f"{self.provider} <{self.workspace.name}>"
