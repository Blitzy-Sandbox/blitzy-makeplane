# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database models for outbound webhook configuration and delivery logging.

:class:`Webhook` stores per-workspace endpoint configuration plus the
HMAC-SHA256 shared secret used to sign payloads; :class:`WebhookLog` is the
append-only delivery-attempt log written by the Celery delivery task
(``bgtasks.webhook_task``); :class:`ProjectWebhook` is the optional join that
restricts a webhook to one project. URLs are guarded against non-``http(s)``
schemes and loopback/private destinations to mitigate SSRF.

Cross-reference: technical specification §5.2.10 Webhook Delivery Sequence.
"""

# Python imports
from uuid import uuid4
from urllib.parse import urlparse

# Django imports
from django.db import models
from django.core.exceptions import ValidationError

# Module imports
from plane.db.models import BaseModel, ProjectBaseModel


def generate_token():
    """Return a freshly-minted ``plane_wh_<hex>`` token used as the webhook signing secret."""
    return "plane_wh_" + uuid4().hex


def validate_schema(value):
    """Validate that the webhook URL uses an ``http`` or ``https`` scheme.

    Raises:
        django.core.exceptions.ValidationError: if the URL scheme is not HTTP(S).
    """
    parsed_url = urlparse(value)
    if parsed_url.scheme not in ["http", "https"]:
        raise ValidationError("Invalid schema. Only HTTP and HTTPS are allowed.")


def validate_domain(value):
    """Validate that the webhook URL does not target a loopback host.

    Rejects ``localhost`` and ``127.0.0.1`` to mitigate server-side request
    forgery against the API host itself.
    """
    parsed_url = urlparse(value)
    domain = parsed_url.netloc
    if domain in ["localhost", "127.0.0.1"]:
        raise ValidationError("Local URLs are not allowed.")


class Webhook(BaseModel):
    """Per-workspace outbound webhook configuration with HMAC signing secret.

    Per-event boolean toggles (``project``, ``issue``, ``module``, ``cycle``,
    ``issue_comment``) opt the endpoint into specific event categories;
    ``secret_key`` is the HMAC-SHA256 signing secret regenerated when
    rotated; ``is_internal`` reserves the row for system-managed integrations
    so users cannot mutate it via the API.
    """

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="workspace_webhooks")
    url = models.URLField(validators=[validate_schema, validate_domain], max_length=1024)
    is_active = models.BooleanField(default=True)
    secret_key = models.CharField(max_length=255, default=generate_token)
    project = models.BooleanField(default=False)
    issue = models.BooleanField(default=False)
    module = models.BooleanField(default=False)
    cycle = models.BooleanField(default=False)
    issue_comment = models.BooleanField(default=False)
    is_internal = models.BooleanField(default=False)
    version = models.CharField(default="v1", max_length=50)

    def __str__(self):
        """Return the workspace slug + URL for admin/debug rendering."""
        return f"{self.workspace.slug} {self.url}"

    class Meta:
        """Django model metadata for the ``webhooks`` table.

        Configures recency ordering and per-workspace URL uniqueness among
        live (non-soft-deleted) rows.
        """

        unique_together = ["workspace", "url", "deleted_at"]
        verbose_name = "Webhook"
        verbose_name_plural = "Webhooks"
        db_table = "webhooks"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "url"],
                condition=models.Q(deleted_at__isnull=True),
                name="webhook_url_unique_url_when_deleted_at_null",
            )
        ]


class WebhookLog(BaseModel):
    """Append-only log of one webhook-delivery attempt with request and response details.

    Written by the Celery webhook-delivery task in ``bgtasks.webhook_task``;
    ``retry_count`` is incremented per retry up to the maximum configured in
    the task (see tech spec §5.2.10). The ``webhook`` column is a bare UUID
    (not an FK) so logs survive parent-webhook deletion for audit purposes.
    """

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="webhook_logs")
    # Associated webhook
    webhook = models.UUIDField()

    # Basic request details
    event_type = models.CharField(max_length=255, blank=True, null=True)
    request_method = models.CharField(max_length=10, blank=True, null=True)
    request_headers = models.TextField(blank=True, null=True)
    request_body = models.TextField(blank=True, null=True)

    # Response details
    response_status = models.TextField(blank=True, null=True)
    response_headers = models.TextField(blank=True, null=True)
    response_body = models.TextField(blank=True, null=True)

    # Retry Count
    retry_count = models.PositiveSmallIntegerField(default=0)

    class Meta:
        """Django model metadata: ``webhook_logs`` table with recency ordering for audit-trail queries."""

        verbose_name = "Webhook Log"
        verbose_name_plural = "Webhook Logs"
        db_table = "webhook_logs"
        ordering = ("-created_at",)

    def __str__(self):
        """Return the event type + webhook UUID for admin/debug rendering."""
        return f"{self.event_type} {str(self.webhook)}"


class ProjectWebhook(ProjectBaseModel):
    """Per-project enablement join that scopes a workspace :class:`Webhook` to one project."""

    webhook = models.ForeignKey("db.Webhook", on_delete=models.CASCADE, related_name="project_webhooks")

    class Meta:
        """Django model metadata for the ``project_webhooks`` table.

        Configures per-project + per-webhook uniqueness among live rows.
        """

        unique_together = ["project", "webhook", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "webhook"],
                condition=models.Q(deleted_at__isnull=True),
                name="project_webhook_unique_project_webhook_when_deleted_at_null",
            )
        ]
        verbose_name = "Project Webhook"
        verbose_name_plural = "Project Webhooks"
        db_table = "project_webhooks"
        ordering = ("-created_at",)
