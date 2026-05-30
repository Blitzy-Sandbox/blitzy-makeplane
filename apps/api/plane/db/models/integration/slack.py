# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database model for the project-to-Slack-channel notification binding.

Defines :class:`SlackProjectSync`, the per-project binding that links a Plane
project to a Slack workspace/team for outbound notification delivery. The
row carries the Slack bot's access token, requested OAuth scopes, target
webhook URL, and the parent :class:`WorkspaceIntegration` whose lifetime
controls cascade deletion of this binding.

Outbound Slack message delivery triggered by Plane events is dispatched
via Celery on RabbitMQ — Redis is caching/session only. The
``slack_project_syncs`` table must exist (migrator container completed)
before the API service imports this module.
"""

# Python imports

# Django imports
from django.db import models

# Module imports
from plane.db.models.project import ProjectBaseModel


class SlackProjectSync(ProjectBaseModel):
    """Per-project binding linking a Plane project to a Slack workspace for notification delivery.

    Persists the Slack OAuth access token, granted ``scopes``, identifying
    ``team_id``/``team_name``, the incoming-webhook URL, and the parent
    :class:`WorkspaceIntegration` whose deletion cascades to this row.
    Uniqueness on ``(team_id, project)`` prevents duplicate sync rows for
    the same Slack team and project.
    """

    # Slack OAuth access token used to authenticate outbound Web API calls; persisted
    # plain at the DB level — no encryption-at-rest layer is declared in this module.
    access_token = models.CharField(max_length=300)
    # Comma-separated list of Slack OAuth scopes granted to ``access_token`` (e.g., "chat:write,channels:read").
    scopes = models.TextField()
    bot_user_id = models.CharField(max_length=50)
    # Slack incoming-webhook URL used as the default channel destination for outbound notification messages.
    webhook_url = models.URLField(max_length=1000)
    # INTENT UNCLEAR: opaque Slack OAuth response payload preserved at install time; shape varies per Slack API version.
    data = models.JSONField(default=dict)
    team_id = models.CharField(max_length=30)
    team_name = models.CharField(max_length=300)
    workspace_integration = models.ForeignKey(
        "db.WorkspaceIntegration", related_name="slack_syncs", on_delete=models.CASCADE
    )

    def __str__(self):
        """Return the repo name."""
        return f"{self.project.name}"

    class Meta:
        """Database table configuration with ``(team_id, project)`` sync-uniqueness enforced."""

        unique_together = ["team_id", "project"]
        verbose_name = "Slack Project Sync"
        verbose_name_plural = "Slack Project Syncs"
        db_table = "slack_project_syncs"
        ordering = ("-created_at",)
