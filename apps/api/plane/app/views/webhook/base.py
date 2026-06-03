# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace webhook subscription management endpoints.

Provides class-based DRF views for CRUD on ``Webhook`` rows, rotation of
their HMAC signing secrets, and read access to ``WebhookLog`` delivery
history. All endpoints are workspace-scoped (``/api/workspaces/<slug>/``)
and gated to workspace administrators via ``@allow_permission(
allowed_roles=[ROLE.ADMIN], level="WORKSPACE")``.

This module manages subscriptions only. Webhook delivery itself runs in
``plane.bgtasks.webhook_task`` (Celery via RabbitMQ — Redis is used for
caching/session only) and applies HMAC-SHA256 signing with five retries
of exponential backoff before auto-deactivating the webhook. See tech
spec §4.5 WEBHOOK DELIVERY WORKFLOW and §5.2.10 for the wire contract.
"""

# Django imports
from django.db import IntegrityError

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.db.models import Webhook, WebhookLog, Workspace
from plane.db.models.webhook import generate_token
from ..base import BaseAPIView
from plane.app.permissions import allow_permission, ROLE
from plane.app.serializers import WebhookSerializer, WebhookLogSerializer


class WebhookEndpoint(BaseAPIView):
    """CRUD endpoint for workspace-scoped webhook subscriptions.

    Routes (all under ``/api/`` per ``plane/urls.py``):
        - ``GET    /workspaces/<slug>/webhooks/``               — list
        - ``POST   /workspaces/<slug>/webhooks/``               — create
        - ``GET    /workspaces/<slug>/webhooks/<uuid:pk>/``     — retrieve
        - ``PATCH  /workspaces/<slug>/webhooks/<uuid:pk>/``     — partial update
        - ``DELETE /workspaces/<slug>/webhooks/<uuid:pk>/``     — destroy

    Request body (``POST`` / ``PATCH``) — see ``WebhookSerializer`` for
    full validation including SSRF guards:
        - ``url`` (URL, required): HTTP/HTTPS only; localhost/127.0.0.1
          blocked by ``validate_domain``; further restricted via
          ``settings.WEBHOOK_ALLOWED_IPS`` / ``WEBHOOK_ALLOWED_HOSTS`` /
          ``WEBHOOK_DISALLOWED_DOMAINS``.
        - ``is_active`` (bool, default ``True``).
        - ``project`` / ``issue`` / ``cycle`` / ``module`` /
          ``issue_comment`` (bool, default ``False``): per-resource event
          subscription flags.

    Response shape on list/retrieve/patch — projected field set:
    ``id``, ``url``, ``is_active``, ``created_at``, ``updated_at``,
    ``project``, ``issue``, ``cycle``, ``module``, ``issue_comment``.
    The ``secret_key`` is deliberately excluded from this projection;
    callers obtain it on ``POST`` (full serializer output) or via
    ``WebhookSecretRegenerateEndpoint``.

    Permissions: workspace admin only — every handler is decorated with
    ``@allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")``.
    """

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def post(self, request, slug):
        """Create a webhook subscription for the workspace.

        Returns ``201 CREATED`` with the full serialized webhook
        (including ``secret_key`` — caller must persist it immediately
        as subsequent reads omit it from the projection). Returns
        ``409 CONFLICT`` when the workspace already has a webhook with
        the same URL (DB unique constraint
        ``webhook_url_unique_url_when_deleted_at_null``).
        """
        workspace = Workspace.objects.get(slug=slug)
        try:
            serializer = WebhookSerializer(data=request.data, context={"request": request})
            if serializer.is_valid():
                serializer.save(workspace_id=workspace.id)
                return Response(serializer.data, status=status.HTTP_201_CREATED)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError as e:
            if "already exists" in str(e):
                return Response(
                    {"error": "URL already exists for the workspace"},
                    status=status.HTTP_409_CONFLICT,
                )
            raise IntegrityError

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def get(self, request, slug, pk=None):
        """List or retrieve webhook subscriptions for the workspace.

        Without ``pk``, returns all webhooks for the workspace. With
        ``pk``, returns the single webhook scoped to the workspace.
        Both paths project the same 10-field public view that excludes
        ``secret_key`` — secret rotation goes through
        ``WebhookSecretRegenerateEndpoint``.
        """
        if pk is None:
            webhooks = Webhook.objects.filter(workspace__slug=slug)
            serializer = WebhookSerializer(
                webhooks,
                fields=(
                    "id",
                    "url",
                    "is_active",
                    "created_at",
                    "updated_at",
                    "project",
                    "issue",
                    "cycle",
                    "module",
                    "issue_comment",
                ),
                many=True,
            )
            return Response(serializer.data, status=status.HTTP_200_OK)
        else:
            webhook = Webhook.objects.get(workspace__slug=slug, pk=pk)
            serializer = WebhookSerializer(
                webhook,
                fields=(
                    "id",
                    "url",
                    "is_active",
                    "created_at",
                    "updated_at",
                    "project",
                    "issue",
                    "cycle",
                    "module",
                    "issue_comment",
                ),
            )
            return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def patch(self, request, slug, pk):
        """Update a webhook's URL, active flag, or event filters (partial PATCH).

        Uses the same 10-field projection as the read endpoints, so
        ``secret_key`` cannot be set or returned through this handler;
        callers must use ``WebhookSecretRegenerateEndpoint`` to rotate
        the signing secret.
        """
        webhook = Webhook.objects.get(workspace__slug=slug, pk=pk)
        serializer = WebhookSerializer(
            webhook,
            data=request.data,
            context={request: request},
            partial=True,
            fields=(
                "id",
                "url",
                "is_active",
                "created_at",
                "updated_at",
                "project",
                "issue",
                "cycle",
                "module",
                "issue_comment",
            ),
        )
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def delete(self, request, slug, pk):
        """Soft-delete the webhook and return ``204 NO CONTENT``.

        Removal goes through ``Webhook.delete()`` which inherits Plane's
        soft-delete semantics (``deleted_at`` set on ``BaseModel``);
        the row remains on disk but is excluded from default querysets
        and frees the ``(workspace, url)`` partial unique constraint
        for re-use.
        """
        webhook = Webhook.objects.get(pk=pk, workspace__slug=slug)
        webhook.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class WebhookSecretRegenerateEndpoint(BaseAPIView):
    """Rotate a webhook's HMAC signing secret.

    Route: ``POST /api/workspaces/<slug>/webhooks/<uuid:pk>/regenerate/``.

    Generates a fresh token via ``generate_token()`` (``"plane_wh_" +
    uuid4().hex``) and replaces ``Webhook.secret_key`` atomically.
    The new secret is returned exactly once in the response — there is
    no separate "show secret" endpoint, so the previous secret is
    invalidated and unrecoverable as soon as ``webhook.save()`` commits.

    Request body:
        None (the action is taken on the URL-identified webhook).

    Permissions: workspace admin only — ``@allow_permission(
    allowed_roles=[ROLE.ADMIN], level="WORKSPACE")``.

    Cross-references:
        * Serializer: ``WebhookSerializer`` in
          ``apps/api/plane/app/serializers/webhook.py``.
        * Model: ``Webhook`` in
          ``apps/api/plane/db/models/webhook.py``.
        * Permissions: ``allow_permission`` decorator in
          ``apps/api/plane/app/permissions/base.py``.
        * Celery task (delivery worker that consumes the rotated
          secret): ``apps/api/plane/bgtasks/webhook_task.py`` (queued
          via RabbitMQ).
        * URL registration: ``apps/api/plane/app/urls/webhook.py``.
    """

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def post(self, request, slug, pk):
        """Regenerate ``secret_key`` and return the refreshed webhook.

        Persisting the new secret immediately invalidates any in-flight
        signatures computed by ``plane.bgtasks.webhook_task`` against
        the prior value — by design, since the rotation endpoint exists
        precisely to revoke a compromised secret.
        """
        webhook = Webhook.objects.get(workspace__slug=slug, pk=pk)
        webhook.secret_key = generate_token()
        webhook.save()
        serializer = WebhookSerializer(webhook)
        return Response(serializer.data, status=status.HTTP_200_OK)


class WebhookLogsEndpoint(BaseAPIView):
    """Read-only access to a webhook's delivery history.

    Route: ``GET /api/workspaces/<slug>/webhook-logs/<uuid:webhook_id>/``.

    Returns the workspace-scoped list of ``WebhookLog`` rows for the
    given ``webhook_id`` (note: ``WebhookLog.webhook`` is a plain
    ``UUIDField``, not a foreign key, so the filter is
    ``webhook=webhook_id``). Each row captures request method/headers/
    body and response status/headers/body as written by
    ``plane.bgtasks.webhook_task`` after each attempted delivery,
    including failed attempts during the 5-retry exponential backoff.

    Request body:
        None (GET only); ``webhook_id`` is supplied as a URL parameter.

    Permissions: workspace admin only — ``@allow_permission(
    allowed_roles=[ROLE.ADMIN], level="WORKSPACE")``.

    Cross-references:
        * Serializer: ``WebhookLogSerializer`` in
          ``apps/api/plane/app/serializers/webhook.py``.
        * Model: ``WebhookLog`` in
          ``apps/api/plane/db/models/webhook.py``.
        * Permissions: ``allow_permission`` decorator in
          ``apps/api/plane/app/permissions/base.py``.
        * Celery task (delivery worker that writes these logs):
          ``apps/api/plane/bgtasks/webhook_task.py`` (queued via
          RabbitMQ).
        * URL registration: ``apps/api/plane/app/urls/webhook.py``.
    """

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def get(self, request, slug, webhook_id):
        """Return all delivery log rows for the webhook in the workspace.

        Results are not paginated at this layer — pagination, if any,
        is applied by ``BaseAPIView``'s caller chain. The response is
        ordered by ``WebhookLog`` model default (creation timestamp
        descending via ``BaseModel.Meta``).
        """
        webhook_logs = WebhookLog.objects.filter(workspace__slug=slug, webhook=webhook_id)
        serializer = WebhookLogSerializer(webhook_logs, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)
