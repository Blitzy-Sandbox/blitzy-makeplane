# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database models for the global integration provider catalogue and per-workspace installations.

Defines the two foundational integration models that anchor every
per-provider sync table in :mod:`plane.db.models.integration`:

- :class:`Integration` — the GLOBAL provider catalogue row (one per
  provider definition, e.g., GitHub / Slack / GitLab) carrying the
  provider identifier, OAuth redirect URL, webhook signing secret,
  and visibility (private vs. public network).
- :class:`WorkspaceIntegration` — the per-workspace installation row
  linking one :class:`Integration` to one workspace plus the
  installing :class:`User` and the :class:`APIToken` consumed by
  background sync tasks.

The provider-specific tables in :mod:`plane.db.models.integration.github`
and :mod:`plane.db.models.integration.slack` cascade from the
``WorkspaceIntegration`` row. Outbound provider calls (GitHub webhook
delivery, Slack message dispatch, etc.) are dispatched via Celery on
RabbitMQ — Redis is caching/session only.

The ``integrations`` and ``workspace_integrations`` tables must exist
(``migrator`` container completed) before the API service imports
this module.
"""

# Python imports
import uuid

# Django imports
from django.db import models

# Module imports
from plane.db.models import BaseModel
from plane.db.mixins import AuditModel


class Integration(AuditModel):
    """Global integration provider catalogue entry (one row per supported third-party provider).

    Defines a provider definition reusable across all workspaces (e.g.,
    GitHub, Slack, GitLab). ``provider`` is the unique key used by code
    paths to dispatch provider-specific logic; ``network`` discriminates
    private (admin-installable only) from public providers; ``verified``
    flags first-party-vetted providers in the marketplace UI;
    ``webhook_url``, ``webhook_secret``, and ``redirect_url`` carry the
    OAuth and webhook contract data shared by every workspace that
    installs the provider.
    """

    id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True)
    title = models.CharField(max_length=400)
    # Unique provider identifier (e.g., "github", "slack", "gitlab"); declared as free-text
    # CharField (no choices=) so new providers can be added without migration.
    provider = models.CharField(max_length=400, unique=True)
    # Valid: 1 (Private — admin-installable only) | 2 (Public — marketplace-visible).
    network = models.PositiveIntegerField(default=1, choices=((1, "Private"), (2, "Public")))
    # INTENT UNCLEAR: provider description payload (e.g., marketing copy, feature flags); shape varies per provider.
    description = models.JSONField(default=dict)
    author = models.CharField(max_length=400, blank=True)
    webhook_url = models.TextField(blank=True)
    # HMAC signing secret shared with the provider for inbound webhook verification; persisted
    # plain at the DB level — no encryption-at-rest layer is declared in this module.
    webhook_secret = models.TextField(blank=True)
    redirect_url = models.TextField(blank=True)
    # INTENT UNCLEAR: provider-level static metadata (e.g., OAuth scopes required, marketplace
    # tags); shape varies per provider.
    metadata = models.JSONField(default=dict)
    verified = models.BooleanField(default=False)
    avatar_url = models.TextField(blank=True, null=True)

    def __str__(self):
        """Return provider of the integration."""
        return f"{self.provider}"

    class Meta:
        """Database table configuration for the ``integrations`` provider catalogue."""

        verbose_name = "Integration"
        verbose_name_plural = "Integrations"
        db_table = "integrations"
        ordering = ("-created_at",)


class WorkspaceIntegration(BaseModel):
    """Per-workspace installation row linking a workspace to one :class:`Integration` provider.

    Carries the installing ``actor`` user, the parent :class:`Integration`
    provider, and the :class:`APIToken` consumed by background sync
    tasks. Provider-specific tables (e.g., :class:`GithubRepositorySync`,
    :class:`SlackProjectSync`) cascade from this row; uniqueness on
    ``(workspace, integration)`` ensures a workspace installs any given
    provider at most once.
    """

    workspace = models.ForeignKey("db.Workspace", related_name="workspace_integrations", on_delete=models.CASCADE)
    # Bot user
    actor = models.ForeignKey("db.User", related_name="integrations", on_delete=models.CASCADE)
    integration = models.ForeignKey("db.Integration", related_name="integrated_workspaces", on_delete=models.CASCADE)
    api_token = models.ForeignKey("db.APIToken", related_name="integrations", on_delete=models.CASCADE)
    # INTENT UNCLEAR: per-workspace install metadata (e.g., OAuth grant timestamp, provider-issued
    # workspace id); shape varies per provider.
    metadata = models.JSONField(default=dict)

    # INTENT UNCLEAR: per-workspace provider configuration overrides (e.g., default notification
    # channel, allowed event types); shape varies per provider.
    config = models.JSONField(default=dict)

    def __str__(self):
        """Return name of the integration and workspace."""
        return f"{self.workspace.name} <{self.integration.provider}>"

    class Meta:
        """Database table configuration with ``(workspace, integration)`` install-uniqueness enforced."""

        unique_together = ["workspace", "integration"]
        verbose_name = "Workspace Integration"
        verbose_name_plural = "Workspace Integrations"
        db_table = "workspace_integrations"
        ordering = ("-created_at",)
