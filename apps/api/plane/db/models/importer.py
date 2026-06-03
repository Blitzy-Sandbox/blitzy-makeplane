# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database model for third-party data import job history.

Each :class:`Importer` row tracks one external-system import (GitHub, Jira) into
a Plane project. The actual data ingestion runs asynchronously via Celery on
RabbitMQ; this row is the persistence and status record consumed by the
importer ViewSets and the project UI.
"""

# Django imports
from django.conf import settings
from django.db import models

# Module imports
from .project import ProjectBaseModel


class Importer(ProjectBaseModel):
    """Records a single third-party import job into a Plane project.

    The row is created when a workspace admin initiates an import and is updated
    by background Celery workers as the job progresses through its lifecycle.
    """

    # Valid: "github" | "jira"
    service = models.CharField(max_length=50, choices=(("github", "GitHub"), ("jira", "Jira")))
    # Valid: "queued" | "processing" | "completed" | "failed"
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
    initiated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="imports")
    # INTENT UNCLEAR: provider-specific metadata payload; shape varies by service.
    metadata = models.JSONField(default=dict)
    # INTENT UNCLEAR: provider-specific connection/config payload; shape varies by service.
    config = models.JSONField(default=dict)
    # INTENT UNCLEAR: raw import payload submitted by the initiator; shape varies by service.
    data = models.JSONField(default=dict)
    token = models.ForeignKey("db.APIToken", on_delete=models.CASCADE, related_name="importer")
    # INTENT UNCLEAR: stores the processed import result for auditing; shape varies by service.
    imported_data = models.JSONField(null=True)

    class Meta:
        """Database table metadata for ``Importer`` (``importers`` table, newest-first)."""

        verbose_name = "Importer"
        verbose_name_plural = "Importers"
        db_table = "importers"
        ordering = ("-created_at",)

    def __str__(self):
        """Return name of the service."""
        return f"{self.service} <{self.project.name}>"
