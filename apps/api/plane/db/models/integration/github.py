# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database models for the bidirectional Plane↔GitHub issue and comment sync.

Defines four project-scoped models forming the Plane↔GitHub mirror chain:
:class:`GithubRepository` (cached GitHub repository metadata) →
:class:`GithubRepositorySync` (per-project sync anchor with credentials
and parent :class:`WorkspaceIntegration`) → :class:`GithubIssueSync`
(per-issue Plane↔GitHub id mapping) → :class:`GithubCommentSync`
(per-comment Plane↔GitHub id mapping). All four use 64-bit integer
columns for the GitHub-side identifiers because GitHub assigns 64-bit
IDs.

Webhook-driven inbound writes and Plane→GitHub mirror updates triggered
by these models run as Celery tasks on RabbitMQ — Redis is caching and
session only. The four tables (``github_repositories``,
``github_repository_syncs``, ``github_issue_syncs``,
``github_comment_syncs``) must exist (migrator container completed)
before the API service imports this module.
"""

# Python imports

# Django imports
from django.db import models

# Module imports
from plane.db.models.project import ProjectBaseModel


class GithubRepository(ProjectBaseModel):
    """Cached metadata snapshot of a GitHub repository owned by a Plane project.

    Stores the GitHub-side primary key (``repository_id`` — 64-bit per
    GitHub's id space), the owner login, the repo URL, and an opaque
    provider-specific configuration payload. Acts as the parent record
    for :class:`GithubRepositorySync`.
    """

    name = models.CharField(max_length=500)
    url = models.URLField(null=True)
    # INTENT UNCLEAR: opaque GitHub repository configuration payload (e.g., default branch,
    # webhook secret); shape varies per GitHub API response.
    config = models.JSONField(default=dict)
    # GitHub-assigned 64-bit primary key for the repository; mirrors GitHub's id space.
    repository_id = models.BigIntegerField()
    owner = models.CharField(max_length=500)

    def __str__(self):
        """Return the repo name."""
        return f"{self.name}"

    class Meta:
        """Database table configuration for cached GitHub repository metadata."""

        verbose_name = "Repository"
        verbose_name_plural = "Repositories"
        db_table = "github_repositories"
        ordering = ("-created_at",)


class GithubRepositorySync(ProjectBaseModel):
    """Per-project anchor that activates a :class:`GithubRepository` for two-way sync.

    Carries the credentials used to call the GitHub API, the bot ``actor``
    that authors mirrored writes, the parent :class:`WorkspaceIntegration`
    whose deletion cascades to this row, and an optional default
    :class:`Label` applied to issues mirrored in from GitHub. Uniqueness
    on ``(project, repository)`` prevents duplicate sync rows for the
    same project/repository pair.
    """

    repository = models.OneToOneField("db.GithubRepository", on_delete=models.CASCADE, related_name="syncs")
    # INTENT UNCLEAR: GitHub API credentials payload (e.g., installation token, refresh token);
    # persisted plain at the DB level — shape varies per GitHub App / OAuth flow.
    credentials = models.JSONField(default=dict)
    # Bot user
    actor = models.ForeignKey("db.User", related_name="user_syncs", on_delete=models.CASCADE)
    workspace_integration = models.ForeignKey(
        "db.WorkspaceIntegration", related_name="github_syncs", on_delete=models.CASCADE
    )
    label = models.ForeignKey("db.Label", on_delete=models.SET_NULL, null=True, related_name="repo_syncs")

    def __str__(self):
        """Return the repo sync."""
        return f"{self.repository.name} <{self.project.name}>"

    class Meta:
        """Database table configuration with ``(project, repository)`` sync-uniqueness enforced."""

        unique_together = ["project", "repository"]
        verbose_name = "Github Repository Sync"
        verbose_name_plural = "Github Repository Syncs"
        db_table = "github_repository_syncs"
        ordering = ("-created_at",)


class GithubIssueSync(ProjectBaseModel):
    """Per-issue mirror row linking a Plane :class:`Issue` to one GitHub issue.

    Stores both GitHub identifiers — ``repo_issue_id`` (the per-repository
    issue number that appears in URLs) and ``github_issue_id`` (the global
    GitHub primary key) — plus the public ``issue_url``. Cascades from
    its parent :class:`GithubRepositorySync`; uniqueness on
    ``(repository_sync, issue)`` prevents duplicate mirror rows for the
    same Plane issue under the same sync.
    """

    # GitHub-assigned per-repository issue number that appears in the public URL
    # (e.g., the "123" in ``/owner/repo/issues/123``).
    repo_issue_id = models.BigIntegerField()
    # GitHub-assigned 64-bit global primary key for the issue (distinct from ``repo_issue_id``
    # which is per-repository).
    github_issue_id = models.BigIntegerField()
    issue_url = models.URLField(blank=False)
    issue = models.ForeignKey("db.Issue", related_name="github_syncs", on_delete=models.CASCADE)
    repository_sync = models.ForeignKey("db.GithubRepositorySync", related_name="issue_syncs", on_delete=models.CASCADE)

    def __str__(self):
        """Return the github issue sync."""
        return f"{self.repository.name}-{self.project.name}-{self.issue.name}"

    class Meta:
        """Database table configuration with ``(repository_sync, issue)`` mirror-uniqueness enforced."""

        unique_together = ["repository_sync", "issue"]
        verbose_name = "Github Issue Sync"
        verbose_name_plural = "Github Issue Syncs"
        db_table = "github_issue_syncs"
        ordering = ("-created_at",)


class GithubCommentSync(ProjectBaseModel):
    """Per-comment mirror row linking a Plane :class:`IssueComment` to one GitHub issue comment.

    Stores the GitHub comment's primary key (``repo_comment_id`` — 64-bit)
    and cascades from its parent :class:`GithubIssueSync`. Uniqueness on
    ``(issue_sync, comment)`` prevents duplicate mirror rows for the
    same Plane comment under the same issue sync.
    """

    # GitHub-assigned 64-bit primary key for the issue comment; mirrors GitHub's id space.
    repo_comment_id = models.BigIntegerField()
    comment = models.ForeignKey("db.IssueComment", related_name="comment_syncs", on_delete=models.CASCADE)
    issue_sync = models.ForeignKey("db.GithubIssueSync", related_name="comment_syncs", on_delete=models.CASCADE)

    def __str__(self):
        """Return the github issue sync."""
        return f"{self.comment.id}"

    class Meta:
        """Database table configuration with ``(issue_sync, comment)`` mirror-uniqueness enforced."""

        unique_together = ["issue_sync", "comment"]
        verbose_name = "Github Comment Sync"
        verbose_name_plural = "Github Comment Syncs"
        db_table = "github_comment_syncs"
        ordering = ("-created_at",)
