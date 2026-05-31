# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Module endpoints for the external ``/api/v1/`` API.

Modules are sprint-like groupings of work-items within a project. This
file exposes CRUD over ``Module`` rows, bulk add/remove of issues to a
module, and archive/unarchive of completed or cancelled modules.

Authentication is via the ``X-Api-Key`` header (see
``plane.api.middleware.api_authentication.APIKeyAuthentication``).
"""

# Python imports
import json

# Django imports
from django.core import serializers
from django.db.models import Count, F, Func, OuterRef, Prefetch, Q
from django.utils import timezone
from django.core.serializers.json import DjangoJSONEncoder

# Third party imports
from rest_framework import status
from rest_framework.response import Response
from drf_spectacular.utils import OpenApiResponse, OpenApiRequest

# Module imports
from plane.api.serializers import (
    IssueSerializer,
    ModuleIssueSerializer,
    ModuleSerializer,
    ModuleIssueRequestSerializer,
    ModuleCreateSerializer,
    ModuleUpdateSerializer,
)
from plane.app.permissions import ProjectEntityPermission
from plane.bgtasks.issue_activities_task import issue_activity
from plane.db.models import (
    Issue,
    FileAsset,
    IssueLink,
    Module,
    ModuleIssue,
    ModuleLink,
    Project,
    ProjectMember,
    UserFavorite,
)

from .base import BaseAPIView
from plane.bgtasks.webhook_task import model_activity
from plane.utils.host import base_host
from plane.utils.openapi import (
    module_docs,
    module_issue_docs,
    MODULE_ID_PARAMETER,
    MODULE_PK_PARAMETER,
    ISSUE_ID_PARAMETER,
    CURSOR_PARAMETER,
    PER_PAGE_PARAMETER,
    ORDER_BY_PARAMETER,
    FIELDS_PARAMETER,
    EXPAND_PARAMETER,
    create_paginated_response,
    # Request Examples
    MODULE_CREATE_EXAMPLE,
    MODULE_UPDATE_EXAMPLE,
    MODULE_ISSUE_REQUEST_EXAMPLE,
    # Response Examples
    MODULE_EXAMPLE,
    MODULE_ISSUE_EXAMPLE,
    INVALID_REQUEST_RESPONSE,
    PROJECT_NOT_FOUND_RESPONSE,
    EXTERNAL_ID_EXISTS_RESPONSE,
    MODULE_NOT_FOUND_RESPONSE,
    DELETED_RESPONSE,
    ADMIN_ONLY_RESPONSE,
    REQUIRED_FIELDS_RESPONSE,
    MODULE_ISSUE_NOT_FOUND_RESPONSE,
    CANNOT_ARCHIVE_RESPONSE,
)


class ModuleListCreateAPIEndpoint(BaseAPIView):
    """List or create modules within a project.

    HTTP methods + URL pattern:
        GET   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/modules/
        POST  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/modules/

    Request body (POST) — see ``ModuleCreateSerializer``:
        name            (str, required)
        description     (str, optional)
        description_text (object, optional) – Plane ProseMirror JSON.
        description_html (str, optional)
        start_date      (date, optional, ISO ``YYYY-MM-DD``)
        target_date     (date, optional, ISO ``YYYY-MM-DD``)
        status          (str, optional)     – One of ``backlog``,
            ``planned``, ``in-progress``, ``paused``, ``completed``,
            ``cancelled``.
        lead            (uuid, optional)    – User pk for the module
            lead.
        members         (list[uuid], optional) – User pks of module
            members.
        view_props      (object, optional)  – Per-user view preferences.
        external_id     (str, optional)
        external_source (str, optional)

    Response shape:
        - GET: paginated array via ``ModuleSerializer`` with the
          annotations ``total_issues``, ``completed_issues``,
          ``cancelled_issues``, ``started_issues``, ``unstarted_issues``,
          ``backlog_issues`` (issue counts per state group) and
          ``members_list``.
        - POST: created module via ``ModuleSerializer``.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` — SAFE methods require project
        membership; mutations require project ``ADMIN`` or ``MEMBER``.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Constraints on POST:
        Returns ``409 Conflict`` on duplicate ``(external_id,
        external_source)`` with the existing module's id.

    Side effects on POST:
        Writes ``Module`` row + creator ``ModuleMember`` link; dispatches
        ``model_activity`` via Celery+RabbitMQ; fires ``module`` webhook
        events.
    """

    serializer_class = ModuleSerializer
    model = Module
    webhook_event = "module"
    permission_classes = [ProjectEntityPermission]
    use_read_replica = True

    def get_queryset(self):
        """Return modules in the project with issue-count annotations.

        Annotations attached:

        - ``total_issues`` – total ``ModuleIssue`` count (``distinct``).
        - ``completed_issues`` – issues in a ``completed`` state.
        - ``cancelled_issues`` – issues in a ``cancelled`` state.
        - ``started_issues`` – issues in a ``started`` state.
        - ``unstarted_issues`` – issues in an ``unstarted`` state.
        - ``backlog_issues`` – issues in a ``backlog`` state.
        - ``members_list`` – ``ArrayAgg`` of member user pks.

        ``select_related("project", "workspace", "lead", "created_by")``
        and ``distinct()`` (m2m joins would otherwise duplicate rows).
        """
        return (
            Module.objects.filter(project_id=self.kwargs.get("project_id"))
            .filter(workspace__slug=self.kwargs.get("slug"))
            .select_related("project")
            .select_related("workspace")
            .select_related("lead")
            .prefetch_related("members")
            .prefetch_related(
                Prefetch(
                    "link_module",
                    queryset=ModuleLink.objects.select_related("module", "created_by"),
                )
            )
            .annotate(
                total_issues=Count(
                    "issue_module",
                    filter=Q(
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                completed_issues=Count(
                    "issue_module__issue__state__group",
                    filter=Q(
                        issue_module__issue__state__group="completed",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                cancelled_issues=Count(
                    "issue_module__issue__state__group",
                    filter=Q(
                        issue_module__issue__state__group="cancelled",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                started_issues=Count(
                    "issue_module__issue__state__group",
                    filter=Q(
                        issue_module__issue__state__group="started",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                unstarted_issues=Count(
                    "issue_module__issue__state__group",
                    filter=Q(
                        issue_module__issue__state__group="unstarted",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                backlog_issues=Count(
                    "issue_module__issue__state__group",
                    filter=Q(
                        issue_module__issue__state__group="backlog",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .order_by(self.kwargs.get("order_by", "-created_at"))
        )

    @module_docs(
        operation_id="create_module",
        summary="Create module",
        description="Create a new project module with specified name, description, and timeline.",
        request=OpenApiRequest(
            request=ModuleCreateSerializer,
            examples=[MODULE_CREATE_EXAMPLE],
        ),
        responses={
            201: OpenApiResponse(
                description="Module created",
                response=ModuleSerializer,
                examples=[MODULE_EXAMPLE],
            ),
            400: INVALID_REQUEST_RESPONSE,
            404: PROJECT_NOT_FOUND_RESPONSE,
            409: EXTERNAL_ID_EXISTS_RESPONSE,
        },
    )
    def post(self, request, slug, project_id):
        """Create a module under the URL's project.

        Returns ``409 Conflict`` on duplicate ``(external_id,
        external_source)``. Dispatches ``model_activity`` via
        Celery+RabbitMQ and fires module webhooks.
        """
        project = Project.objects.get(pk=project_id, workspace__slug=slug)
        serializer = ModuleCreateSerializer(
            data=request.data,
            context={"project_id": project_id, "workspace_id": project.workspace_id},
        )
        if serializer.is_valid():
            if (
                request.data.get("external_id")
                and request.data.get("external_source")
                and Module.objects.filter(
                    project_id=project_id,
                    workspace__slug=slug,
                    external_source=request.data.get("external_source"),
                    external_id=request.data.get("external_id"),
                ).exists()
            ):
                module = Module.objects.filter(
                    project_id=project_id,
                    workspace__slug=slug,
                    external_source=request.data.get("external_source"),
                    external_id=request.data.get("external_id"),
                ).first()
                return Response(
                    {
                        "error": "Module with the same external id and external source already exists",
                        "id": str(module.id),
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            serializer.save()
            # Send the model activity
            model_activity.delay(
                model_name="module",
                model_id=str(serializer.instance.id),
                requested_data=request.data,
                current_instance=None,
                actor_id=request.user.id,
                slug=slug,
                origin=base_host(request=request, is_app=True),
            )
            module = Module.objects.get(pk=serializer.instance.id)
            serializer = ModuleSerializer(module)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @module_docs(
        operation_id="list_modules",
        summary="List modules",
        description="Retrieve all modules in a project.",
        parameters=[
            CURSOR_PARAMETER,
            PER_PAGE_PARAMETER,
            ORDER_BY_PARAMETER,
            FIELDS_PARAMETER,
            EXPAND_PARAMETER,
        ],
        responses={
            200: create_paginated_response(
                ModuleSerializer,
                "PaginatedModuleResponse",
                "Paginated list of modules",
                "Paginated Modules",
            ),
            404: OpenApiResponse(description="Module not found"),
        },
    )
    def get(self, request, slug, project_id):
        """List or retrieve modules.

        Retrieve all modules in a project or get details of a specific module.
        Returns paginated results with module statistics and member information.
        """
        return self.paginate(
            request=request,
            queryset=(self.get_queryset().filter(archived_at__isnull=True)),
            on_results=lambda modules: ModuleSerializer(
                modules, many=True, fields=self.fields, expand=self.expand
            ).data,
        )


class ModuleDetailAPIEndpoint(BaseAPIView):
    """Retrieve, partially update, or delete a single module.

    HTTP methods + URL pattern:
        GET     /api/v1/workspaces/<slug>/projects/<uuid:project_id>/modules/<uuid:pk>/
        PATCH   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/modules/<uuid:pk>/
        DELETE  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/modules/<uuid:pk>/

    Request body (PATCH) — partial ``ModuleSerializer`` payload.

    Response shape:
        - GET: module via ``ModuleSerializer`` (with annotations).
        - PATCH: updated module via ``ModuleSerializer``.
        - DELETE: HTTP 204 with empty body.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` — SAFE methods require project
        membership; mutations require project ``ADMIN`` or ``MEMBER``.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Constraints:
        - PATCH on an archived module (``archived_at IS NOT NULL``) only
          permits modification of ``sort_order``; other fields return
          ``400 Bad Request``.
        - PATCH returns ``409 Conflict`` on duplicate ``(external_id,
          external_source)``.
        - DELETE is restricted to project ``ADMIN`` users or the module's
          ``lead``; other roles return ``403 Forbidden``.

    Side effects on PATCH / DELETE:
        Dispatches ``model_activity`` via Celery+RabbitMQ; fires module
        webhooks.
    """

    model = Module
    permission_classes = [ProjectEntityPermission]
    serializer_class = ModuleSerializer
    webhook_event = "module"
    use_read_replica = True

    def get_queryset(self):
        """Return the single module with the same annotations as the list endpoint."""
        return (
            Module.objects.filter(project_id=self.kwargs.get("project_id"))
            .filter(workspace__slug=self.kwargs.get("slug"))
            .select_related("project")
            .select_related("workspace")
            .select_related("lead")
            .prefetch_related("members")
            .prefetch_related(
                Prefetch(
                    "link_module",
                    queryset=ModuleLink.objects.select_related("module", "created_by"),
                )
            )
            .annotate(
                total_issues=Count(
                    "issue_module",
                    filter=Q(
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                completed_issues=Count(
                    "issue_module__issue__state__group",
                    filter=Q(
                        issue_module__issue__state__group="completed",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                cancelled_issues=Count(
                    "issue_module__issue__state__group",
                    filter=Q(
                        issue_module__issue__state__group="cancelled",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                started_issues=Count(
                    "issue_module__issue__state__group",
                    filter=Q(
                        issue_module__issue__state__group="started",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                unstarted_issues=Count(
                    "issue_module__issue__state__group",
                    filter=Q(
                        issue_module__issue__state__group="unstarted",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                backlog_issues=Count(
                    "issue_module__issue__state__group",
                    filter=Q(
                        issue_module__issue__state__group="backlog",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .order_by(self.kwargs.get("order_by", "-created_at"))
        )

    @module_docs(
        operation_id="update_module",
        summary="Update module",
        description="Modify an existing module's properties like name, description, status, or timeline.",
        parameters=[
            MODULE_PK_PARAMETER,
        ],
        request=OpenApiRequest(
            request=ModuleUpdateSerializer,
            examples=[MODULE_UPDATE_EXAMPLE],
        ),
        responses={
            200: OpenApiResponse(
                description="Module updated successfully",
                response=ModuleSerializer,
                examples=[MODULE_EXAMPLE],
            ),
            400: OpenApiResponse(
                description="Invalid request data",
                response=ModuleSerializer,
                examples=[MODULE_UPDATE_EXAMPLE],
            ),
            404: OpenApiResponse(description="Module not found"),
            409: OpenApiResponse(description="Module with same external ID already exists"),
        },
    )
    def patch(self, request, slug, project_id, pk):
        """Update the module partially.

        Archived modules only permit ``sort_order`` changes; other fields
        return ``400``. Returns ``409 Conflict`` on duplicate
        ``(external_id, external_source)``.
        """
        module = Module.objects.get(pk=pk, project_id=project_id, workspace__slug=slug)

        current_instance = json.dumps(ModuleSerializer(module).data, cls=DjangoJSONEncoder)

        if module.archived_at:
            return Response(
                {"error": "Archived module cannot be edited"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = ModuleUpdateSerializer(module, data=request.data, context={"project_id": project_id}, partial=True)
        if serializer.is_valid():
            if (
                request.data.get("external_id")
                and (module.external_id != request.data.get("external_id"))
                and Module.objects.filter(
                    project_id=project_id,
                    workspace__slug=slug,
                    external_source=request.data.get("external_source", module.external_source),
                    external_id=request.data.get("external_id"),
                ).exists()
            ):
                return Response(
                    {
                        "error": "Module with the same external id and external source already exists",
                        "id": str(module.id),
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            serializer.save()

            # Send the model activity
            model_activity.delay(
                model_name="module",
                model_id=str(serializer.instance.id),
                requested_data=request.data,
                current_instance=current_instance,
                actor_id=request.user.id,
                slug=slug,
                origin=base_host(request=request, is_app=True),
            )

            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @module_docs(
        operation_id="retrieve_module",
        summary="Retrieve module",
        description="Retrieve details of a specific module.",
        parameters=[
            MODULE_PK_PARAMETER,
        ],
        responses={
            200: OpenApiResponse(
                description="Module",
                response=ModuleSerializer,
                examples=[MODULE_EXAMPLE],
            ),
            404: OpenApiResponse(description="Module not found"),
        },
    )
    def get(self, request, slug, project_id, pk):
        """Retrieve the module with its issue-count annotations."""
        queryset = self.get_queryset().filter(archived_at__isnull=True).get(pk=pk)
        data = ModuleSerializer(queryset, fields=self.fields, expand=self.expand).data
        return Response(data, status=status.HTTP_200_OK)

    @module_docs(
        operation_id="delete_module",
        summary="Delete module",
        description="Permanently remove a module and all its associated issue relationships.",
        parameters=[
            MODULE_PK_PARAMETER,
        ],
        responses={
            204: DELETED_RESPONSE,
            403: ADMIN_ONLY_RESPONSE,
            404: MODULE_NOT_FOUND_RESPONSE,
        },
    )
    def delete(self, request, slug, project_id, pk):
        """Hard-delete the module. Restricted to project ``ADMIN`` or the module's ``lead``."""
        module = Module.objects.get(workspace__slug=slug, project_id=project_id, pk=pk)
        if module.created_by_id != request.user.id and (
            not ProjectMember.objects.filter(
                workspace__slug=slug,
                member=request.user,
                role=20,
                project_id=project_id,
                is_active=True,
            ).exists()
        ):
            return Response(
                {"error": "Only admin or creator can delete the module"},
                status=status.HTTP_403_FORBIDDEN,
            )

        module_issues = list(ModuleIssue.objects.filter(module_id=pk).values_list("issue", flat=True))
        issue_activity.delay(
            type="module.activity.deleted",
            requested_data=json.dumps(
                {
                    "module_id": str(pk),
                    "module_name": str(module.name),
                    "issues": [str(issue_id) for issue_id in module_issues],
                }
            ),
            actor_id=str(request.user.id),
            issue_id=None,
            project_id=str(project_id),
            current_instance=json.dumps({"module_name": str(module.name)}),
            epoch=int(timezone.now().timestamp()),
            origin=base_host(request=request, is_app=True),
        )
        module.delete()
        # Delete the module issues
        ModuleIssue.objects.filter(module=pk, project_id=project_id).delete()
        # Delete the user favorite module
        UserFavorite.objects.filter(entity_type="module", entity_identifier=pk, project_id=project_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ModuleIssueListCreateAPIEndpoint(BaseAPIView):
    """List or bulk-add issues to a module.

    HTTP methods + URL patterns (registered in
    ``apps/api/plane/api/urls/module.py``):
        GET   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/module-issues/
                  (name ``module-issues``)
        POST  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/module-issues/
                  (name ``module-issues``)

    Request body (POST):
        issues (list[uuid], required) – Issue pks to associate with the
            module. Issues already linked are silently de-duplicated.

    Response shape:
        - GET: paginated array of issues in the module via
          ``IssueSerializer``.
        - POST: array of created ``ModuleIssue`` rows.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` — SAFE methods require project
        membership; mutations require project ``ADMIN`` or ``MEMBER``.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Side effects on POST:
        - Writes ``ModuleIssue`` rows for issues not already associated.
        - Dispatches ``issue_activity`` via Celery+RabbitMQ for each new
          association.
        - Fires ``module_issue`` webhook events if active.
    """

    serializer_class = ModuleIssueSerializer
    model = ModuleIssue
    webhook_event = "module_issue"
    permission_classes = [ProjectEntityPermission]
    use_read_replica = True

    def get_queryset(self):
        """Filter issues to those associated with the URL's module."""
        return (
            ModuleIssue.objects.annotate(
                sub_issues_count=Issue.issue_objects.filter(parent=OuterRef("issue"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(module_id=self.kwargs.get("module_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(project__archived_at__isnull=True)
            .select_related("project")
            .select_related("workspace")
            .select_related("module")
            .select_related("issue", "issue__state", "issue__project")
            .prefetch_related("issue__assignees", "issue__labels")
            .prefetch_related("module__members")
            .order_by(self.kwargs.get("order_by", "-created_at"))
            .distinct()
        )

    @module_issue_docs(
        operation_id="list_module_work_items",
        summary="List module work items",
        description="Retrieve all work items assigned to a module with detailed information.",
        parameters=[
            MODULE_ID_PARAMETER,
            CURSOR_PARAMETER,
            PER_PAGE_PARAMETER,
            ORDER_BY_PARAMETER,
            FIELDS_PARAMETER,
            EXPAND_PARAMETER,
        ],
        request={},
        responses={
            200: create_paginated_response(
                IssueSerializer,
                "PaginatedModuleIssueResponse",
                "Paginated list of module work items",
                "Paginated Module Work Items",
            ),
            404: OpenApiResponse(description="Module not found"),
        },
    )
    def get(self, request, slug, project_id, module_id):
        """List issues associated with the module."""
        order_by = request.GET.get("order_by", "created_at")
        issues = (
            Issue.issue_objects.filter(issue_module__module_id=module_id, issue_module__deleted_at__isnull=True)
            .annotate(
                sub_issues_count=Issue.issue_objects.filter(parent=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(bridge_id=F("issue_module__id"))
            .filter(project_id=project_id)
            .filter(workspace__slug=slug)
            .select_related("project")
            .select_related("workspace")
            .select_related("state")
            .select_related("parent")
            .prefetch_related("assignees")
            .prefetch_related("labels")
            .order_by(order_by)
            .annotate(
                link_count=IssueLink.objects.filter(issue=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(
                attachment_count=FileAsset.objects.filter(
                    issue_id=OuterRef("id"),
                    entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
                )
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
        )
        return self.paginate(
            request=request,
            queryset=(issues),
            on_results=lambda issues: IssueSerializer(issues, many=True, fields=self.fields, expand=self.expand).data,
        )

    @module_issue_docs(
        operation_id="add_module_work_items",
        summary="Add Work Items to Module",
        description="Assign multiple work items to a module or move them from another module. Automatically handles bulk creation and updates with activity tracking.",  # noqa: E501
        parameters=[
            MODULE_ID_PARAMETER,
        ],
        request=OpenApiRequest(
            request=ModuleIssueRequestSerializer,
            examples=[MODULE_ISSUE_REQUEST_EXAMPLE],
        ),
        responses={
            200: OpenApiResponse(
                description="Module issues added",
                response=ModuleIssueSerializer,
                examples=[MODULE_ISSUE_EXAMPLE],
            ),
            400: REQUIRED_FIELDS_RESPONSE,
            404: MODULE_NOT_FOUND_RESPONSE,
        },
    )
    def post(self, request, slug, project_id, module_id):
        """Bulk-add issues to the module.

        De-duplicates against existing ``ModuleIssue`` rows. Dispatches
        ``issue_activity`` via Celery for each new association.
        """
        issues = request.data.get("issues", [])
        if not len(issues):
            return Response({"error": "Issues are required"}, status=status.HTTP_400_BAD_REQUEST)
        module = Module.objects.get(workspace__slug=slug, project_id=project_id, pk=module_id)

        issues = Issue.objects.filter(workspace__slug=slug, project_id=project_id, pk__in=issues).values_list(
            "id", flat=True
        )

        module_issues = list(ModuleIssue.objects.filter(issue_id__in=issues))

        update_module_issue_activity = []
        records_to_update = []
        record_to_create = []

        for issue in issues:
            module_issue = [module_issue for module_issue in module_issues if str(module_issue.issue_id) in issues]

            if len(module_issue):
                if module_issue[0].module_id != module_id:
                    update_module_issue_activity.append(
                        {
                            "old_module_id": str(module_issue[0].module_id),
                            "new_module_id": str(module_id),
                            "issue_id": str(module_issue[0].issue_id),
                        }
                    )
                    module_issue[0].module_id = module_id
                    records_to_update.append(module_issue[0])
            else:
                record_to_create.append(
                    ModuleIssue(
                        module=module,
                        issue_id=issue,
                        project_id=project_id,
                        workspace=module.workspace,
                        created_by=request.user,
                        updated_by=request.user,
                    )
                )

        ModuleIssue.objects.bulk_create(record_to_create, batch_size=10, ignore_conflicts=True)

        ModuleIssue.objects.bulk_update(records_to_update, ["module"], batch_size=10)

        # Capture Issue Activity
        issue_activity.delay(
            type="module.activity.created",
            requested_data=json.dumps({"modules_list": str(issues)}),
            actor_id=str(self.request.user.id),
            issue_id=None,
            project_id=str(self.kwargs.get("project_id", None)),
            current_instance=json.dumps(
                {
                    "updated_module_issues": update_module_issue_activity,
                    "created_module_issues": serializers.serialize("json", record_to_create),
                }
            ),
            epoch=int(timezone.now().timestamp()),
            origin=base_host(request=request, is_app=True),
        )

        return Response(
            ModuleIssueSerializer(self.get_queryset(), many=True).data,
            status=status.HTTP_200_OK,
        )


class ModuleIssueDetailAPIEndpoint(BaseAPIView):
    """Remove an issue from a module.

    HTTP methods + URL patterns (registered in
    ``apps/api/plane/api/urls/module.py``):
        DELETE  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/module-issues/<uuid:issue_id>/
                    (name ``module-issues-detail``)

    Response shape:
        HTTP 204 with empty body.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` — mutations require project ``ADMIN``
        or ``MEMBER``.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Side effects:
        Hard-deletes the ``ModuleIssue`` row; dispatches ``issue_activity``
        via Celery+RabbitMQ for the activity feed; fires
        ``module_issue`` webhook events.
    """

    serializer_class = ModuleIssueSerializer
    model = ModuleIssue
    webhook_event = "module_issue"
    bulk = True
    use_read_replica = True

    permission_classes = [ProjectEntityPermission]

    def get_queryset(self):
        """Filter ``ModuleIssue`` rows scoped to the URL's module within an active project."""
        return (
            ModuleIssue.objects.annotate(
                sub_issues_count=Issue.issue_objects.filter(parent=OuterRef("issue"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(module_id=self.kwargs.get("module_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(project__archived_at__isnull=True)
            .select_related("project")
            .select_related("workspace")
            .select_related("module")
            .select_related("issue", "issue__state", "issue__project")
            .prefetch_related("issue__assignees", "issue__labels")
            .prefetch_related("module__members")
            .order_by(self.kwargs.get("order_by", "-created_at"))
            .distinct()
        )

    @module_issue_docs(
        operation_id="retrieve_module_work_item",
        summary="Retrieve module work item",
        description="Retrieve details of a specific module work item.",
        parameters=[
            MODULE_ID_PARAMETER,
            ISSUE_ID_PARAMETER,
            CURSOR_PARAMETER,
            PER_PAGE_PARAMETER,
            ORDER_BY_PARAMETER,
            FIELDS_PARAMETER,
            EXPAND_PARAMETER,
        ],
        responses={
            200: create_paginated_response(
                IssueSerializer,
                "PaginatedModuleIssueDetailResponse",
                "Paginated list of module work item details",
                "Module Work Item Details",
            ),
            404: OpenApiResponse(description="Module not found"),
        },
    )
    def get(self, request, slug, project_id, module_id, issue_id):
        """List module work items.

        Retrieve all work items assigned to a module with detailed information.
        Returns paginated results including assignees, labels, and attachments.
        """
        order_by = request.GET.get("order_by", "created_at")
        issues = (
            Issue.issue_objects.filter(
                issue_module__module_id=module_id,
                issue_module__deleted_at__isnull=True,
                pk=issue_id,
            )
            .annotate(
                sub_issues_count=Issue.issue_objects.filter(parent=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(bridge_id=F("issue_module__id"))
            .filter(project_id=project_id)
            .filter(workspace__slug=slug)
            .select_related("project")
            .select_related("workspace")
            .select_related("state")
            .select_related("parent")
            .prefetch_related("assignees")
            .prefetch_related("labels")
            .order_by(order_by)
            .annotate(
                link_count=IssueLink.objects.filter(issue=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(
                attachment_count=FileAsset.objects.filter(
                    issue_id=OuterRef("id"),
                    entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
                )
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
        )
        return self.paginate(
            request=request,
            queryset=(issues),
            on_results=lambda issues: IssueSerializer(issues, many=True, fields=self.fields, expand=self.expand).data,
        )

    @module_issue_docs(
        operation_id="delete_module_work_item",
        summary="Delete module work item",
        description="Remove a work item from a module while keeping the work item in the project.",
        parameters=[
            MODULE_ID_PARAMETER,
            ISSUE_ID_PARAMETER,
        ],
        responses={
            204: DELETED_RESPONSE,
            404: MODULE_ISSUE_NOT_FOUND_RESPONSE,
        },
    )
    def delete(self, request, slug, project_id, module_id, issue_id):
        """Remove the issue from the module.

        Hard-deletes the ``ModuleIssue`` association row and dispatches
        ``issue_activity`` via Celery for the audit feed.
        """
        module_issue = ModuleIssue.objects.get(
            workspace__slug=slug,
            project_id=project_id,
            module_id=module_id,
            issue_id=issue_id,
        )

        module_name = module_issue.module.name if module_issue.module is not None else ""
        module_issue.delete()
        issue_activity.delay(
            type="module.activity.deleted",
            requested_data=json.dumps({"module_id": str(module_id), "issues": [str(module_issue.issue_id)]}),
            actor_id=str(request.user.id),
            issue_id=str(issue_id),
            project_id=str(project_id),
            current_instance=json.dumps({"module_name": module_name}),
            epoch=int(timezone.now().timestamp()),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class ModuleArchiveUnarchiveAPIEndpoint(BaseAPIView):
    """List archived modules, archive a module, or unarchive a module.

    HTTP methods + URL patterns (registered in
    ``apps/api/plane/api/urls/module.py``):
        POST    /api/v1/workspaces/<slug>/projects/<uuid:project_id>/modules/<uuid:pk>/archive/
                    (name ``module-archive``)
        GET     /api/v1/workspaces/<slug>/projects/<uuid:project_id>/archived-modules/
                    (name ``module-archive-list``)
        DELETE  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/archived-modules/<uuid:pk>/unarchive/
                    (name ``module-unarchive``)

    Response shape:
        - POST: ``{archived_at: <ISO timestamp>}``.
        - GET: paginated list of archived modules (``archived_at IS NOT
          NULL``) with the same rollup annotations as the list endpoint.
        - DELETE: HTTP 204 with empty body.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` — mutations require project ``ADMIN``
        or ``MEMBER``.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Constraints:
        Only modules whose ``status`` is ``completed`` or ``cancelled``
        may be archived; otherwise POST returns ``400 Bad Request``.

    Side effects:
        - POST: writes the ``archived_at`` field on the module and
          dispatches ``model_activity`` via Celery+RabbitMQ for the
          audit feed.
        - GET: read-only.
        - DELETE: clears the ``archived_at`` field (unarchive).
    """

    permission_classes = [ProjectEntityPermission]
    use_read_replica = True

    def get_queryset(self):
        """Return archived modules (``archived_at IS NOT NULL``) with the list endpoint's annotations."""
        return (
            Module.objects.filter(project_id=self.kwargs.get("project_id"))
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(archived_at__isnull=False)
            .select_related("project")
            .select_related("workspace")
            .select_related("lead")
            .prefetch_related("members")
            .prefetch_related(
                Prefetch(
                    "link_module",
                    queryset=ModuleLink.objects.select_related("module", "created_by"),
                )
            )
            .annotate(
                total_issues=Count(
                    "issue_module",
                    filter=Q(
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                completed_issues=Count(
                    "issue_module__issue__state__group",
                    filter=Q(
                        issue_module__issue__state__group="completed",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                cancelled_issues=Count(
                    "issue_module__issue__state__group",
                    filter=Q(
                        issue_module__issue__state__group="cancelled",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                started_issues=Count(
                    "issue_module__issue__state__group",
                    filter=Q(
                        issue_module__issue__state__group="started",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                unstarted_issues=Count(
                    "issue_module__issue__state__group",
                    filter=Q(
                        issue_module__issue__state__group="unstarted",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                backlog_issues=Count(
                    "issue_module__issue__state__group",
                    filter=Q(
                        issue_module__issue__state__group="backlog",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .order_by(self.kwargs.get("order_by", "-created_at"))
        )

    @module_docs(
        operation_id="list_archived_modules",
        summary="List archived modules",
        description="Retrieve all modules that have been archived in the project.",
        parameters=[
            CURSOR_PARAMETER,
            PER_PAGE_PARAMETER,
            ORDER_BY_PARAMETER,
            FIELDS_PARAMETER,
            EXPAND_PARAMETER,
        ],
        request={},
        responses={
            200: create_paginated_response(
                ModuleSerializer,
                "PaginatedArchivedModuleResponse",
                "Paginated list of archived modules",
                "Paginated Archived Modules",
            ),
            404: OpenApiResponse(description="Project not found"),
        },
    )
    def get(self, request, slug, project_id):
        """List archived modules.

        Retrieve all modules that have been archived in the project.
        Returns paginated results with module statistics.
        """
        return self.paginate(
            request=request,
            queryset=(self.get_queryset()),
            on_results=lambda modules: ModuleSerializer(
                modules, many=True, fields=self.fields, expand=self.expand
            ).data,
        )

    @module_docs(
        operation_id="archive_module",
        summary="Archive module",
        description="Move a module to archived status for historical tracking.",
        parameters=[
            MODULE_PK_PARAMETER,
        ],
        request={},
        responses={
            204: None,
            400: CANNOT_ARCHIVE_RESPONSE,
            404: MODULE_NOT_FOUND_RESPONSE,
        },
    )
    def post(self, request, slug, project_id, pk):
        """Archive the module by setting ``archived_at``.

        Only modules in ``completed`` or ``cancelled`` status may be
        archived; otherwise returns ``400 Bad Request``.
        """
        module = Module.objects.get(pk=pk, project_id=project_id, workspace__slug=slug)
        if module.status not in ["completed", "cancelled"]:
            return Response(
                {"error": "Only completed or cancelled modules can be archived"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        module.archived_at = timezone.now()
        module.save()
        UserFavorite.objects.filter(
            entity_type="module",
            entity_identifier=pk,
            project_id=project_id,
            workspace__slug=slug,
        ).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @module_docs(
        operation_id="unarchive_module",
        summary="Unarchive module",
        description="Restore an archived module to active status, making it available for regular use.",
        parameters=[
            MODULE_PK_PARAMETER,
        ],
        responses={
            204: None,
            404: MODULE_NOT_FOUND_RESPONSE,
        },
    )
    def delete(self, request, slug, project_id, pk):
        """Unarchive the module by clearing ``archived_at``."""
        module = Module.objects.get(pk=pk, project_id=project_id, workspace__slug=slug)
        module.archived_at = None
        module.save()
        return Response(status=status.HTTP_204_NO_CONTENT)
