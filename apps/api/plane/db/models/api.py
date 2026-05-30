# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database models for API authentication tokens and per-request audit logs.

Defines :class:`APIToken` (the per-user/per-workspace bearer tokens consumed by
the external ``/api/v1/`` surface and bot-driven integrations) and
:class:`APIActivityLog` (the request-level audit trail populated by the API
log middleware in ``apps/api/plane/middleware``).
"""

# Python imports
from uuid import uuid4

# Django imports
from django.db import models
from django.conf import settings

from .base import BaseModel


def generate_label_token():
    """Return a hex token used as the default human-readable label for a new APIToken."""
    return uuid4().hex


def generate_token():
    """Return a new bearer token in the ``plane_api_<hex>`` format required by API authentication."""
    return "plane_api_" + uuid4().hex


class APIToken(BaseModel):
    """Per-user (or per-bot) API bearer token used by external clients.

    Tokens are prefixed ``plane_api_`` for visual identification; ``is_service``
    marks server-to-server tokens, ``is_active`` is the soft-revoke flag, and
    ``allowed_rate_limit`` overrides the default throttle scope when set.
    """

    # Meta information
    label = models.CharField(max_length=255, default=generate_label_token)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    last_used = models.DateTimeField(null=True)

    # Token
    token = models.CharField(max_length=255, unique=True, default=generate_token, db_index=True)

    # User Information
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="bot_tokens")
    # Valid: 0 (Human) | 1 (Bot)
    user_type = models.PositiveSmallIntegerField(choices=((0, "Human"), (1, "Bot")), default=0)
    workspace = models.ForeignKey("db.Workspace", related_name="api_tokens", on_delete=models.CASCADE, null=True)
    expired_at = models.DateTimeField(blank=True, null=True)
    is_service = models.BooleanField(default=False)
    allowed_rate_limit = models.CharField(max_length=255, default="60/min")

    class Meta:
        """Django model metadata: maps to ``api_tokens`` table, newest-first ordering."""

        verbose_name = "API Token"
        verbose_name_plural = "API Tokems"
        db_table = "api_tokens"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the owning user's UUID for admin/debug rendering."""
        return str(self.user.id)


class APIActivityLog(BaseModel):
    """Request-level audit log for an authenticated API call.

    One row per request reaching the external API surface; populated by the
    API log middleware and consumed by admin debugging tools and rate-limit
    forensics.
    """

    token_identifier = models.CharField(max_length=255)

    # Request Info
    path = models.CharField(max_length=255)
    method = models.CharField(max_length=10)
    query_params = models.TextField(null=True, blank=True)
    headers = models.TextField(null=True, blank=True)
    body = models.TextField(null=True, blank=True)

    # Response info
    response_code = models.PositiveIntegerField()
    response_body = models.TextField(null=True, blank=True)

    # Meta information
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=512, null=True, blank=True)

    class Meta:
        """Django model metadata: maps to ``api_activity_logs`` table, newest-first ordering."""

        verbose_name = "API Activity Log"
        verbose_name_plural = "API Activity Logs"
        db_table = "api_activity_logs"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the token identifier for admin/debug rendering."""
        return str(self.token_identifier)
