# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database model for user social-login provider audit history.

:class:`SocialLoginConnection` records per-user social-login activity (Google,
GitHub, GitLab, Jira) for audit and login-history rendering. Active OAuth
token storage lives on :class:`plane.db.models.user.Account`, not here.
"""

# Django imports
from django.conf import settings
from django.db import models
from django.utils import timezone

# Module import
from .base import BaseModel


class SocialLoginConnection(BaseModel):
    """Records a user's last social-login activity for a given provider."""

    # Valid: "Google" | "Github" | "GitLab" | "Jira"
    medium = models.CharField(
        max_length=20,
        choices=(
            ("Google", "google"),
            ("Github", "github"),
            ("GitLab", "gitlab"),
            ("Jira", "jira"),
        ),
        default=None,
    )
    last_login_at = models.DateTimeField(default=timezone.now, null=True)
    last_received_at = models.DateTimeField(default=timezone.now, null=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="user_login_connections",
    )
    # INTENT UNCLEAR: provider-issued token payload (shape varies by provider — see Account model for active tokens).
    token_data = models.JSONField(null=True)
    # INTENT UNCLEAR: provider-specific auxiliary payload accompanying login (shape varies by provider).
    extra_data = models.JSONField(null=True)

    class Meta:
        """Django ORM metadata for the ``social_login_connections`` table."""

        verbose_name = "Social Login Connection"
        verbose_name_plural = "Social Login Connections"
        db_table = "social_login_connections"
        ordering = ("-created_at",)

    def __str__(self):
        """Return name of the user and medium."""
        return f"{self.medium} <{self.user.email}>"
