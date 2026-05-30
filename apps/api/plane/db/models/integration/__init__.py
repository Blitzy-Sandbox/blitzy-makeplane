# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Integration subpackage re-exporting third-party provider ORM models.

Exposes the workspace-level integration definitions (:class:`Integration`,
:class:`WorkspaceIntegration` from :mod:`plane.db.models.integration.base`)
plus the GitHub sync models (:class:`GithubRepository`,
:class:`GithubRepositorySync`, :class:`GithubIssueSync`,
:class:`GithubCommentSync` from :mod:`plane.db.models.integration.github`)
and the Slack sync model (:class:`SlackProjectSync` from
:mod:`plane.db.models.integration.slack`) at the package root so callers
can import via ``from plane.db.models.integration import Integration``.

Importing this package registers these ORM models with Django's app
registry, so the ``migrator`` container must have completed schema
migrations (``integrations``, ``workspace_integrations``,
``github_*_syncs``, ``slack_project_syncs`` tables) before the API
service imports it. Any background sync triggered by these models is
dispatched via Celery on RabbitMQ — Redis is caching/session only and
is never the task broker.
"""

from .base import Integration, WorkspaceIntegration
from .github import (
    GithubRepository,
    GithubRepositorySync,
    GithubIssueSync,
    GithubCommentSync,
)
from .slack import SlackProjectSync
