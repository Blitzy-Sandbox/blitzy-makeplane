# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""HTTP endpoint for initiating issue exports and retrieving export history.

Defines :class:`ExportIssuesEndpoint`, mounted at
``/api/workspaces/<slug>/export-issues/``, which both queues a new export
job (POST) and lists prior export jobs for a workspace (GET).

The endpoint itself does no file generation: it persists an
:class:`plane.db.models.ExporterHistory` row with ``status="queued"`` and
enqueues :func:`plane.bgtasks.export_task.issue_export_task` via
Celery / RabbitMQ. The worker generates the CSV / XLSX / JSON artifact,
uploads it to the asset store, and updates the row's ``url`` and
``status``. Per-row expiry cleanup runs daily via Celery Beat in
:mod:`plane.bgtasks.exporter_expired_task`.

See tech spec §4.10 EXPORT PIPELINE WORKFLOW for the end-to-end sequence.
"""

# Third Party imports
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import allow_permission, ROLE
from plane.app.serializers import ExporterHistorySerializer
from plane.bgtasks.export_task import issue_export_task
from plane.db.models import ExporterHistory, Project, Workspace

# Module imports
from .. import BaseAPIView


class ExportIssuesEndpoint(BaseAPIView):
    """Initiate workspace-scoped issue exports (POST) and list export history (GET).

    HTTP methods + URL patterns:
        POST /api/workspaces/<slug>/export-issues/
        GET  /api/workspaces/<slug>/export-issues/

    Request body (POST):
        provider (str, required): One of ``"csv"``, ``"xlsx"``, ``"json"``.
            Any other value yields HTTP 400 ``{"error": "Provider '<x>' not found."}``.
        project (list[UUID-str], optional): Project IDs to include in the
            export. When omitted or empty, the endpoint resolves the
            requesting user's active, non-archived projects in the
            workspace via :class:`plane.db.models.Project`.
        multiple (bool, optional, default ``False``): Forwarded to the
            Celery worker; controls whether multi-file packaging is
            applied during export generation.

    Response shape (POST):
        HTTP 200 ``{"message": "Once the export is ready you will be able to download it"}``.
        The freshly-created :class:`plane.db.models.ExporterHistory` row
        (``status="queued"``, auto-generated ``token``) is NOT returned in
        the response body -- clients poll the GET endpoint to observe
        progress and obtain the final ``url``.

    Response shape (GET, paginated):
        Cursor-paginated list of :class:`plane.app.serializers.ExporterHistorySerializer`
        rows. Every serializer field is read-only:
        ``id``, ``created_at``, ``updated_at``, ``project`` (list of UUID
        strings), ``provider``, ``status`` (``"queued"`` / ``"processing"``
        / ``"completed"`` / ``"failed"``), ``url`` (the downloadable artifact
        once ``status="completed"``), ``initiated_by``, ``initiated_by_detail``
        (nested :class:`plane.app.serializers.UserLiteSerializer`), ``token``,
        ``created_by``, ``updated_by``.

    Response shape (GET, missing pagination):
        HTTP 400 ``{"error": "per_page and cursor are required"}``. Both
        ``?per_page=`` and ``?cursor=`` query params MUST be supplied.

    Permissions:
        ``permission_classes = [IsAuthenticated]`` (inherited from
        :class:`plane.app.views.base.BaseAPIView`) plus the
        :func:`plane.app.permissions.allow_permission` decorator on each
        method requiring workspace-level membership in
        ``[ROLE.ADMIN, ROLE.MEMBER]``. Guests are denied.

    Queryset filter logic (GET):
        ``ExporterHistory.objects.filter(workspace__slug=slug,
        type="issue_exports").select_related("workspace", "initiated_by")``.
        Ordering defaults to ``-created_at``; overridable via
        ``?order_by=<field>``.

    Cross-references:
        * Permission decorator: :func:`plane.app.permissions.allow_permission`
          (``apps/api/plane/app/permissions/base.py``)
        * Serializers: :class:`plane.app.serializers.ExporterHistorySerializer`,
          :class:`plane.app.serializers.UserLiteSerializer`
          (``apps/api/plane/app/serializers/exporter.py``,
          ``apps/api/plane/app/serializers/user.py``)
        * Models: :class:`plane.db.models.ExporterHistory`,
          :class:`plane.db.models.Project`
          (``apps/api/plane/db/models/exporter.py``,
          ``apps/api/plane/db/models/project.py``)
        * Celery task: :func:`plane.bgtasks.export_task.issue_export_task`
          (``apps/api/plane/bgtasks/export_task.py``)
        * URL: ``apps/api/plane/app/urls/exporter.py``
    """

    model = ExporterHistory
    serializer_class = ExporterHistorySerializer

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug):
        """Queue a new issue export job for the workspace.

        Persists an :class:`plane.db.models.ExporterHistory` row with
        ``status="queued"`` and ``type="issue_exports"``, then enqueues
        :func:`plane.bgtasks.export_task.issue_export_task` via Celery /
        RabbitMQ (Redis is caching/session only, not the task broker).
        When ``project`` is omitted from the payload, the active
        non-archived projects the requesting user belongs to in the
        workspace are selected automatically. Idempotency: NON-idempotent
        -- each POST creates a new history row and dispatches a new
        Celery task.
        """
        # Get the workspace
        workspace = Workspace.objects.get(slug=slug)

        provider = request.data.get("provider", False)
        multiple = request.data.get("multiple", False)
        project_ids = request.data.get("project", [])

        if provider in ["csv", "xlsx", "json"]:
            if not project_ids:
                project_ids = Project.objects.filter(
                    workspace__slug=slug,
                    project_projectmember__member=request.user,
                    project_projectmember__is_active=True,
                    archived_at__isnull=True,
                ).values_list("id", flat=True)
                project_ids = [str(project_id) for project_id in project_ids]

            exporter = ExporterHistory.objects.create(
                workspace=workspace,
                project=project_ids,
                initiated_by=request.user,
                provider=provider,
                type="issue_exports",
            )

            issue_export_task.delay(
                provider=exporter.provider,
                workspace_id=workspace.id,
                project_ids=project_ids,
                token_id=exporter.token,
                multiple=multiple,
                slug=slug,
            )
            return Response(
                {"message": "Once the export is ready you will be able to download it"},
                status=status.HTTP_200_OK,
            )
        else:
            return Response(
                {"error": f"Provider '{provider}' not found."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        """List paginated issue-export history rows for the workspace (cursor pagination is mandatory)."""
        exporter_history = ExporterHistory.objects.filter(workspace__slug=slug, type="issue_exports").select_related(
            "workspace", "initiated_by"
        )

        if request.GET.get("per_page", False) and request.GET.get("cursor", False):
            return self.paginate(
                order_by=request.GET.get("order_by", "-created_at"),
                request=request,
                queryset=exporter_history,
                on_results=lambda exporter_history: ExporterHistorySerializer(exporter_history, many=True).data,
            )
        else:
            return Response(
                {"error": "per_page and cursor are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
