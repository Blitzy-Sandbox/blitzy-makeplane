# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""Work-item (issue) endpoints for the external ``/api/v1/`` API.

This is the largest endpoint surface in the public API and covers:

- Work-item CRUD (list/create/detail/upsert) and workspace-level
  retrieve by ``project_identifier-issue_identifier``.
- Project labels (list/create/detail).
- Issue links with asynchronous title crawling.
- Issue comments and webhook fan-out.
- Issue activity feed (read-only).
- Issue attachments backed by S3 presigned uploads.
- Cross-issue search.
- Issue relations (blocking, duplicate, relates-to, scheduling
  predecessors).

URL paths exist in both the legacy ``/issues/`` form and the modern
``/work-items/`` alias for backwards compatibility.

Authentication is via the ``X-Api-Key`` header (see
``plane.api.middleware.api_authentication.APIKeyAuthentication``).
"""

# Python imports
import json
import uuid
import re

# Django imports
from django.core.serializers.json import DjangoJSONEncoder
from django.http import HttpResponseRedirect
from django.db import IntegrityError
from django.db.models import (
    Case,
    CharField,
    Exists,
    F,
    Func,
    Max,
    OuterRef,
    Q,
    Value,
    When,
    Subquery,
)

from django.utils import timezone
from django.conf import settings

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# drf-spectacular imports
from drf_spectacular.utils import (
    extend_schema,
    OpenApiResponse,
    OpenApiExample,
    OpenApiRequest,
)

# Module imports
from plane.api.serializers import (
    IssueAttachmentSerializer,
    IssueActivitySerializer,
    IssueCommentSerializer,
    IssueLinkSerializer,
    IssueRelationCreateSerializer,
    IssueRelationResponseSerializer,
    IssueRelationSerializer,
    IssueSerializer,
    LabelSerializer,
    IssueAttachmentUploadSerializer,
    IssueSearchSerializer,
    IssueCommentCreateSerializer,
    IssueLinkCreateSerializer,
    IssueLinkUpdateSerializer,
    LabelCreateUpdateSerializer,
    RelatedIssueSerializer,
)
from plane.app.permissions import (
    ProjectEntityPermission,
    ProjectLitePermission,
    ProjectMemberPermission,
)
from plane.bgtasks.issue_activities_task import issue_activity
from plane.db.models import (
    Issue,
    IssueActivity,
    FileAsset,
    IssueComment,
    IssueLink,
    IssueRelation,
    Label,
    Project,
    ProjectMember,
    CycleIssue,
    Workspace,
)
from plane.settings.storage import S3Storage
from plane.utils.path_validator import sanitize_filename
from plane.bgtasks.storage_metadata_task import get_asset_object_metadata
from .base import BaseAPIView
from plane.utils.host import base_host
from plane.utils.issue_relation_mapper import get_actual_relation
from plane.bgtasks.webhook_task import model_activity
from plane.app.permissions import ROLE
from plane.utils.openapi import (
    work_item_docs,
    work_item_relation_docs,
    label_docs,
    issue_link_docs,
    issue_comment_docs,
    issue_activity_docs,
    issue_attachment_docs,
    WORKSPACE_SLUG_PARAMETER,
    PROJECT_IDENTIFIER_PARAMETER,
    ISSUE_IDENTIFIER_PARAMETER,
    PROJECT_ID_PARAMETER,
    ISSUE_ID_PARAMETER,
    LABEL_ID_PARAMETER,
    COMMENT_ID_PARAMETER,
    LINK_ID_PARAMETER,
    ATTACHMENT_ID_PARAMETER,
    ACTIVITY_ID_PARAMETER,
    PROJECT_ID_QUERY_PARAMETER,
    CURSOR_PARAMETER,
    PER_PAGE_PARAMETER,
    EXTERNAL_ID_PARAMETER,
    EXTERNAL_SOURCE_PARAMETER,
    ORDER_BY_PARAMETER,
    SEARCH_PARAMETER_REQUIRED,
    LIMIT_PARAMETER,
    WORKSPACE_SEARCH_PARAMETER,
    FIELDS_PARAMETER,
    EXPAND_PARAMETER,
    create_paginated_response,
    # Request Examples
    ISSUE_CREATE_EXAMPLE,
    ISSUE_UPDATE_EXAMPLE,
    ISSUE_UPSERT_EXAMPLE,
    LABEL_CREATE_EXAMPLE,
    LABEL_UPDATE_EXAMPLE,
    ISSUE_LINK_CREATE_EXAMPLE,
    ISSUE_LINK_UPDATE_EXAMPLE,
    ISSUE_COMMENT_CREATE_EXAMPLE,
    ISSUE_COMMENT_UPDATE_EXAMPLE,
    ISSUE_ATTACHMENT_UPLOAD_EXAMPLE,
    ATTACHMENT_UPLOAD_CONFIRM_EXAMPLE,
    # Response Examples
    ISSUE_EXAMPLE,
    LABEL_EXAMPLE,
    ISSUE_LINK_EXAMPLE,
    ISSUE_COMMENT_EXAMPLE,
    ISSUE_ATTACHMENT_EXAMPLE,
    ISSUE_ATTACHMENT_NOT_UPLOADED_EXAMPLE,
    ISSUE_SEARCH_EXAMPLE,
    WORK_ITEM_NOT_FOUND_RESPONSE,
    ISSUE_NOT_FOUND_RESPONSE,
    PROJECT_NOT_FOUND_RESPONSE,
    EXTERNAL_ID_EXISTS_RESPONSE,
    DELETED_RESPONSE,
    ADMIN_ONLY_RESPONSE,
    LABEL_NOT_FOUND_RESPONSE,
    LABEL_NAME_EXISTS_RESPONSE,
    INVALID_REQUEST_RESPONSE,
    LINK_NOT_FOUND_RESPONSE,
    COMMENT_NOT_FOUND_RESPONSE,
    ATTACHMENT_NOT_FOUND_RESPONSE,
    BAD_SEARCH_REQUEST_RESPONSE,
    UNAUTHORIZED_RESPONSE,
    FORBIDDEN_RESPONSE,
    WORKSPACE_NOT_FOUND_RESPONSE,
)
from plane.bgtasks.work_item_link_task import crawl_work_item_link_title


def user_has_issue_permission(user_id, project_id, issue=None, allowed_roles=None, allow_creator=True):
    """Return ``True`` if the user can access the issue, otherwise ``False``.

    Used to gate fine-grained issue-level operations such as attachment
    upload/download/deletion. The user is granted permission when either:

    - ``allow_creator=True`` AND ``issue.created_by_id == user_id``, OR
    - the user is an active ``ProjectMember`` whose role is in
      ``allowed_roles`` (or any role when ``allowed_roles`` is ``None``).
    """
    if allow_creator and issue is not None and user_id == issue.created_by_id:
        return True

    qs = ProjectMember.objects.filter(
        project_id=project_id,
        member_id=user_id,
        is_active=True,
    )
    if allowed_roles is not None:
        qs = qs.filter(role__in=allowed_roles)

    return qs.exists()


class WorkspaceIssueAPIEndpoint(BaseAPIView):
    """Retrieve a single issue by its workspace-level human identifier.

    This viewset provides ``retrieveByIssueId`` on workspace level.

    HTTP methods + URL pattern:
        GET  /api/v1/workspaces/<slug>/issues/<str:project_identifier>-<str:issue_identifier>/
        GET  /api/v1/workspaces/<slug>/work-items/<str:project_identifier>-<str:issue_identifier>/

    Path parameters:
        project_identifier (str) – The project's short identifier
            (e.g. ``ENG``).
        issue_identifier   (str) – The issue's sequence number within
            its project (e.g. ``42``).

    Response shape:
        Single issue serialized via ``IssueSerializer``.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` — supplies a ``project_identifier``
        attribute on the view so the permission class can resolve the
        target project from the URL slug-pair.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Side effects:
        Read-only.
    """

    model = Issue
    webhook_event = "issue"
    permission_classes = [ProjectEntityPermission]
    serializer_class = IssueSerializer
    use_read_replica = True

    @property
    def project_identifier(self):
        """Return the project identifier from the URL kwargs.

        Exposed as a view-level property so ``ProjectEntityPermission``
        can resolve the target project without a UUID in the URL.
        """
        return self.kwargs.get("project_identifier", None)

    def get_queryset(self):
        """Return workspace-level issues filtered by slug and project identifier.

        Annotates ``sub_issues_count`` for each row and orders by the
        ``order_by`` URL kwarg (defaults to ``-created_at``).
        """
        return (
            Issue.issue_objects.annotate(
                sub_issues_count=Issue.issue_objects.filter(parent=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project__identifier=self.kwargs.get("project_identifier"))
            .select_related("project")
            .select_related("workspace")
            .select_related("state")
            .select_related("parent")
            .prefetch_related("assignees")
            .prefetch_related("labels")
            .order_by(self.kwargs.get("order_by", "-created_at"))
        ).distinct()

    @extend_schema(
        operation_id="get_workspace_work_item",
        summary="Retrieve work item by identifiers",
        description="Retrieve a specific work item using workspace slug, project identifier, and issue identifier.",
        tags=["Work Items"],
        parameters=[
            WORKSPACE_SLUG_PARAMETER,
            PROJECT_IDENTIFIER_PARAMETER,
            ISSUE_IDENTIFIER_PARAMETER,
        ],
        responses={
            200: OpenApiResponse(
                description="Work item details",
                response=IssueSerializer,
                examples=[ISSUE_EXAMPLE],
            ),
            404: WORK_ITEM_NOT_FOUND_RESPONSE,
        },
    )
    def get(self, request, slug, project_identifier=None, issue_identifier=None):
        """Resolve the issue by ``(project_identifier, sequence_id)`` and return it.

        Provides workspace-level access to a work item via its human-readable
        identifier pair, bypassing the need for a UUID.
        """
        if issue_identifier and project_identifier:
            issue = Issue.issue_objects.annotate(
                sub_issues_count=Issue.issue_objects.filter(parent=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            ).get(
                workspace__slug=slug,
                project__identifier=project_identifier,
                sequence_id=issue_identifier,
            )
            return Response(
                IssueSerializer(issue, fields=self.fields, expand=self.expand).data,
                status=status.HTTP_200_OK,
            )


class IssueListCreateAPIEndpoint(BaseAPIView):
    """List or create issues within a project.

    This viewset provides ``list`` and ``create`` on issue level.

    HTTP methods + URL patterns:
        GET   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/issues/
        POST  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/issues/
        GET   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/work-items/
        POST  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/work-items/

    Request body (POST) — see ``IssueCreateSerializer``:
        name             (str,  required) – Work-item title.
        description      (object, optional) – Plane ProseMirror JSON.
        description_html (str,  optional)
        priority         (str,  optional) – One of ``low``, ``medium``,
            ``high``, ``urgent``, ``none``.
        state            (uuid, optional) – State pk; defaults to the
            project's default state.
        parent           (uuid, optional) – Parent issue pk for sub-issues.
        assignees        (list[uuid], optional) – User pks.
        labels           (list[uuid], optional) – Label pks.
        estimate_point   (uuid, optional) – Estimate point pk.
        start_date       (date, optional, ISO ``YYYY-MM-DD``)
        target_date      (date, optional, ISO ``YYYY-MM-DD``)
        external_id      (str,  optional)
        external_source  (str,  optional)

    Response shape:
        - GET: paginated array via ``IssueSerializer`` with the
          annotations ``cycle_id``, ``link_count``, ``attachment_count``,
          and priority/state-driven ordering.
        - POST: created issue via ``IssueSerializer``.

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
        external_source)`` with the existing issue's id.

    Side effects on POST:
        - Writes ``Issue`` row + initial ``IssueActivity`` log entry.
        - Dispatches ``issue_activity`` and ``model_activity`` via
          Celery+RabbitMQ for the activity feed and audit log.
        - Triggers ``webhook_task.delay(...)`` for ``issue`` events if
          the project has active webhook subscriptions.
    """

    model = Issue
    webhook_event = "issue"
    permission_classes = [ProjectEntityPermission]
    serializer_class = IssueSerializer
    use_read_replica = True

    def get_queryset(self):
        """Return project issues with rollup annotations and ordering.

        Annotations attached to each row:

        - ``cycle_id`` – the currently associated cycle (subquery over
          ``CycleIssue``); ``None`` for issues not on a cycle.
        - ``link_count`` – count of ``IssueLink`` rows.
        - ``attachment_count`` – count of ``FileAsset`` rows in
          ``ISSUE_ATTACHMENT`` entity type.

        Ordering applies a priority weight (``urgent`` first, ``none``
        last) followed by ``state__group`` and ``created_at``. Uses
        ``select_related`` for ``project``, ``workspace``, ``state``,
        ``parent``, ``created_by`` and ``prefetch_related`` for
        ``assignees``, ``labels``.
        """
        return (
            Issue.issue_objects.annotate(
                sub_issues_count=Issue.issue_objects.filter(parent=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(workspace__slug=self.kwargs.get("slug"))
            .select_related("project")
            .select_related("workspace")
            .select_related("state")
            .select_related("parent")
            .prefetch_related("assignees")
            .prefetch_related("labels")
            .order_by(self.kwargs.get("order_by", "-created_at"))
        ).distinct()

    @work_item_docs(
        operation_id="list_work_items",
        summary="List work items",
        description="Retrieve a paginated list of all work items in a project. Supports filtering, ordering, and field selection through query parameters.",  # noqa: E501
        parameters=[
            CURSOR_PARAMETER,
            PER_PAGE_PARAMETER,
            EXTERNAL_ID_PARAMETER,
            EXTERNAL_SOURCE_PARAMETER,
            ORDER_BY_PARAMETER,
            FIELDS_PARAMETER,
            EXPAND_PARAMETER,
        ],
        responses={
            200: create_paginated_response(
                IssueSerializer,
                "PaginatedWorkItemResponse",
                "Paginated list of work items",
                "Paginated Work Items",
            ),
            400: INVALID_REQUEST_RESPONSE,
            404: PROJECT_NOT_FOUND_RESPONSE,
        },
    )
    def get(self, request, slug, project_id):
        """List issues in the project with rollup annotations.

        Retrieve a paginated list of all work items in a project with
        ``cycle_id``, ``link_count``, and ``attachment_count`` annotations.
        Supports filtering, ordering, and field selection through query parameters.
        """
        external_id = request.GET.get("external_id")
        external_source = request.GET.get("external_source")

        if external_id and external_source:
            issue = Issue.objects.get(
                external_id=external_id,
                external_source=external_source,
                workspace__slug=slug,
                project_id=project_id,
            )
            return Response(
                IssueSerializer(issue, fields=self.fields, expand=self.expand).data,
                status=status.HTTP_200_OK,
            )

        # Custom ordering for priority and state
        priority_order = ["urgent", "high", "medium", "low", "none"]
        state_order = ["backlog", "unstarted", "started", "completed", "cancelled"]

        order_by_param = request.GET.get("order_by", "-created_at")

        issue_queryset = (
            self.get_queryset()
            .annotate(
                cycle_id=Subquery(
                    CycleIssue.objects.filter(issue=OuterRef("id"), deleted_at__isnull=True).values("cycle_id")[:1]
                )
            )
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

        total_issue_queryset = Issue.issue_objects.filter(project_id=project_id, workspace__slug=slug)

        # Priority Ordering
        if order_by_param == "priority" or order_by_param == "-priority":
            priority_order = priority_order if order_by_param == "priority" else priority_order[::-1]
            issue_queryset = issue_queryset.annotate(
                priority_order=Case(
                    *[When(priority=p, then=Value(i)) for i, p in enumerate(priority_order)],
                    output_field=CharField(),
                )
            ).order_by("priority_order")

        # State Ordering
        elif order_by_param in [
            "state__name",
            "state__group",
            "-state__name",
            "-state__group",
        ]:
            state_order = state_order if order_by_param in ["state__name", "state__group"] else state_order[::-1]
            issue_queryset = issue_queryset.annotate(
                state_order=Case(
                    *[When(state__group=state_group, then=Value(i)) for i, state_group in enumerate(state_order)],
                    default=Value(len(state_order)),
                    output_field=CharField(),
                )
            ).order_by("state_order")
        # assignee and label ordering
        elif order_by_param in [
            "labels__name",
            "-labels__name",
            "assignees__first_name",
            "-assignees__first_name",
        ]:
            issue_queryset = issue_queryset.annotate(
                max_values=Max(order_by_param[1::] if order_by_param.startswith("-") else order_by_param)
            ).order_by("-max_values" if order_by_param.startswith("-") else "max_values")
        else:
            issue_queryset = issue_queryset.order_by(order_by_param)

        return self.paginate(
            request=request,
            queryset=(issue_queryset),
            total_count_queryset=total_issue_queryset,
            on_results=lambda issues: IssueSerializer(issues, many=True, fields=self.fields, expand=self.expand).data,
        )

    @work_item_docs(
        operation_id="create_work_item",
        summary="Create work item",
        description="Create a new work item in the specified project with the provided details.",
        request=OpenApiRequest(
            request=IssueSerializer,
            examples=[ISSUE_CREATE_EXAMPLE],
        ),
        responses={
            201: OpenApiResponse(
                description="Work Item created successfully",
                response=IssueSerializer,
                examples=[ISSUE_EXAMPLE],
            ),
            400: INVALID_REQUEST_RESPONSE,
            404: PROJECT_NOT_FOUND_RESPONSE,
            409: EXTERNAL_ID_EXISTS_RESPONSE,
        },
    )
    def post(self, request, slug, project_id):
        """Create an issue in the project.

        Returns ``409 Conflict`` on duplicate ``(external_id,
        external_source)``. Dispatches ``issue_activity`` and
        ``model_activity`` via Celery+RabbitMQ; fires issue webhooks.
        """
        project = Project.objects.get(pk=project_id)

        serializer = IssueSerializer(
            data=request.data,
            context={
                "project_id": project_id,
                "workspace_id": project.workspace_id,
                "default_assignee_id": project.default_assignee_id,
            },
        )

        if serializer.is_valid():
            if (
                request.data.get("external_id")
                and request.data.get("external_source")
                and Issue.objects.filter(
                    project_id=project_id,
                    workspace__slug=slug,
                    external_source=request.data.get("external_source"),
                    external_id=request.data.get("external_id"),
                ).exists()
            ):
                issue = Issue.objects.filter(
                    workspace__slug=slug,
                    project_id=project_id,
                    external_id=request.data.get("external_id"),
                    external_source=request.data.get("external_source"),
                ).first()
                return Response(
                    {
                        "error": "Issue with the same external id and external source already exists",
                        "id": str(issue.id),
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            serializer.save()
            # Refetch the issue
            issue = Issue.objects.filter(workspace__slug=slug, project_id=project_id, pk=serializer.data["id"]).first()
            issue.created_at = request.data.get("created_at", timezone.now())
            issue.created_by_id = request.data.get("created_by", request.user.id)
            issue.save(update_fields=["created_at", "created_by"])

            # Track the issue
            issue_activity.delay(
                type="issue.activity.created",
                requested_data=json.dumps(self.request.data, cls=DjangoJSONEncoder),
                actor_id=str(request.user.id),
                issue_id=str(serializer.data.get("id", None)),
                project_id=str(project_id),
                current_instance=None,
                epoch=int(timezone.now().timestamp()),
            )

            # Send the model activity
            model_activity.delay(
                model_name="issue",
                model_id=str(serializer.data["id"]),
                requested_data=request.data,
                current_instance=None,
                actor_id=request.user.id,
                slug=slug,
                origin=base_host(request=request, is_app=True),
            )
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class IssueDetailAPIEndpoint(BaseAPIView):
    """Retrieve, upsert (PUT), partially update, or delete a single issue.

    HTTP methods + URL pattern:
        GET     /api/v1/workspaces/<slug>/projects/<uuid:project_id>/issues/<uuid:pk>/
        PUT     /api/v1/workspaces/<slug>/projects/<uuid:project_id>/issues/<uuid:pk>/
        PATCH   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/issues/<uuid:pk>/
        DELETE  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/issues/<uuid:pk>/
        (and the ``/work-items/<uuid:pk>/`` alias variants)

    Request body (PUT) — upsert mode:
        Both ``external_id`` AND ``external_source`` are REQUIRED. PUT
        uses these to upsert based on ``(external_id, external_source)``
        rather than the URL pk; if no matching row exists, a new issue
        is created.

    Request body (PATCH) — partial ``IssueSerializer`` payload.

    Response shape:
        ``IssueSerializer`` payload (GET / PUT / PATCH); HTTP 204 for
        DELETE.

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
        - PUT requires both ``external_id`` and ``external_source``;
          missing either returns ``400 Bad Request``.
        - DELETE is restricted to the issue's creator (``created_by``)
          or a project ``ADMIN``; other roles return ``403 Forbidden``.

    Side effects on PUT / PATCH / DELETE:
        Dispatches ``issue_activity`` and ``model_activity`` via
        Celery+RabbitMQ; fires ``issue`` webhook events.
    """

    model = Issue
    webhook_event = "issue"
    permission_classes = [ProjectEntityPermission]
    serializer_class = IssueSerializer
    use_read_replica = True

    def get_queryset(self):
        """Return the single issue with the same annotations as the list endpoint."""
        return (
            Issue.issue_objects.annotate(
                sub_issues_count=Issue.issue_objects.filter(parent=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(workspace__slug=self.kwargs.get("slug"))
            .select_related("project")
            .select_related("workspace")
            .select_related("state")
            .select_related("parent")
            .prefetch_related("assignees")
            .prefetch_related("labels")
            .order_by(self.kwargs.get("order_by", "-created_at"))
        ).distinct()

    @work_item_docs(
        operation_id="retrieve_work_item",
        summary="Retrieve work item",
        description="Retrieve details of a specific work item.",
        parameters=[
            PROJECT_ID_PARAMETER,
            EXTERNAL_ID_PARAMETER,
            EXTERNAL_SOURCE_PARAMETER,
            ORDER_BY_PARAMETER,
            FIELDS_PARAMETER,
            EXPAND_PARAMETER,
        ],
        responses={
            200: OpenApiResponse(
                description="List of issues or issue details",
                response=IssueSerializer,
                examples=[ISSUE_EXAMPLE],
            ),
            400: INVALID_REQUEST_RESPONSE,
            404: WORK_ITEM_NOT_FOUND_RESPONSE,
        },
    )
    def get(self, request, slug, project_id, pk):
        """Retrieve the issue with its annotations.

        Retrieve details of a specific work item including the
        ``sub_issues_count`` annotation. Supports field selection and
        expansion through query parameters.
        """
        issue = Issue.issue_objects.annotate(
            sub_issues_count=Issue.issue_objects.filter(parent=OuterRef("id"))
            .order_by()
            .annotate(count=Func(F("id"), function="Count"))
            .values("count")
        ).get(workspace__slug=slug, project_id=project_id, pk=pk)
        return Response(
            IssueSerializer(issue, fields=self.fields, expand=self.expand).data,
            status=status.HTTP_200_OK,
        )

    @work_item_docs(
        operation_id="put_work_item",
        summary="Update or create work item",
        description="Update an existing work item identified by external ID and source, or create a new one if it doesn't exist. Requires external_id and external_source parameters for identification.",  # noqa: E501
        request=OpenApiRequest(
            request=IssueSerializer,
            examples=[ISSUE_UPSERT_EXAMPLE],
        ),
        responses={
            200: OpenApiResponse(
                description="Work Item updated successfully",
                response=IssueSerializer,
                examples=[ISSUE_EXAMPLE],
            ),
            201: OpenApiResponse(
                description="Work Item created successfully",
                response=IssueSerializer,
                examples=[ISSUE_EXAMPLE],
            ),
            400: INVALID_REQUEST_RESPONSE,
            404: WORK_ITEM_NOT_FOUND_RESPONSE,
        },
    )
    def put(self, request, slug, project_id):
        """Upsert the issue keyed by ``(external_id, external_source)``.

        Both fields are required. If no matching row exists a new issue
        is created; otherwise the existing row is replaced. Dispatches
        ``issue_activity`` and ``model_activity`` via Celery; fires
        issue webhooks.
        """
        # Get the entities required for putting the issue, external_id and
        # external_source are must to identify the issue here
        project = Project.objects.get(pk=project_id)
        external_id = request.data.get("external_id")
        external_source = request.data.get("external_source")

        # If the external_id and source are present, we need to find the exact
        # issue that needs to be updated with the provided external_id and
        # external_source
        if external_id and external_source:
            try:
                issue = Issue.objects.get(
                    project_id=project_id,
                    workspace__slug=slug,
                    external_id=external_id,
                    external_source=external_source,
                )

                # Get the current instance of the issue in order to track
                # changes and dispatch the issue activity
                current_instance = json.dumps(IssueSerializer(issue).data, cls=DjangoJSONEncoder)

                # Get the requested data, encode it as django object and pass it
                # to serializer to validation
                requested_data = json.dumps(self.request.data, cls=DjangoJSONEncoder)
                serializer = IssueSerializer(
                    issue,
                    data=request.data,
                    context={
                        "project_id": project_id,
                        "workspace_id": project.workspace_id,
                    },
                    partial=True,
                )
                if serializer.is_valid():
                    # If the serializer is valid, save the issue and dispatch
                    # the update issue activity worker event.
                    serializer.save()
                    issue_activity.delay(
                        type="issue.activity.updated",
                        requested_data=requested_data,
                        actor_id=str(request.user.id),
                        issue_id=str(issue.id),
                        project_id=str(project_id),
                        current_instance=current_instance,
                        epoch=int(timezone.now().timestamp()),
                    )
                    # Send the model activity for webhook dispatch
                    model_activity.delay(
                        model_name="issue",
                        model_id=str(issue.id),
                        requested_data=request.data,
                        current_instance=current_instance,
                        actor_id=request.user.id,
                        slug=slug,
                        origin=base_host(request=request, is_app=True),
                    )
                    return Response(serializer.data, status=status.HTTP_200_OK)
                return Response(
                    # If the serializer is not valid, respond with 400 bad
                    # request
                    serializer.errors,
                    status=status.HTTP_400_BAD_REQUEST,
                )
            except Issue.DoesNotExist:
                # If the issue does not exist, a new record needs to be created
                # for the requested data.
                # Serialize the data with the context of the project and
                # workspace
                serializer = IssueSerializer(
                    data=request.data,
                    context={
                        "project_id": project_id,
                        "workspace_id": project.workspace_id,
                        "default_assignee_id": project.default_assignee_id,
                    },
                )

                # If the serializer is valid, save the issue and dispatch the
                # issue activity worker event as created
                if serializer.is_valid():
                    serializer.save()
                    # Refetch the issue
                    issue = Issue.objects.filter(
                        workspace__slug=slug,
                        project_id=project_id,
                        pk=serializer.data["id"],
                    ).first()

                    # If any of the created_at or created_by is present, update
                    # the issue with the provided data, else return with the
                    # default states given.
                    issue.created_at = request.data.get("created_at", timezone.now())
                    issue.created_by_id = request.data.get("created_by", request.user.id)
                    issue.save(update_fields=["created_at", "created_by"])

                    issue_activity.delay(
                        type="issue.activity.created",
                        requested_data=json.dumps(self.request.data, cls=DjangoJSONEncoder),
                        actor_id=str(request.user.id),
                        issue_id=str(serializer.data.get("id", None)),
                        project_id=str(project_id),
                        current_instance=None,
                        epoch=int(timezone.now().timestamp()),
                    )
                    # Send the model activity for webhook dispatch
                    model_activity.delay(
                        model_name="issue",
                        model_id=str(serializer.data["id"]),
                        requested_data=request.data,
                        current_instance=None,
                        actor_id=request.user.id,
                        slug=slug,
                        origin=base_host(request=request, is_app=True),
                    )
                    return Response(serializer.data, status=status.HTTP_201_CREATED)
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        else:
            return Response(
                {"error": "external_id and external_source are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @work_item_docs(
        operation_id="update_work_item",
        summary="Partially update work item",
        description="Partially update an existing work item with the provided fields. Supports external ID validation to prevent conflicts.",  # noqa: E501
        parameters=[
            PROJECT_ID_PARAMETER,
        ],
        request=OpenApiRequest(
            request=IssueSerializer,
            examples=[ISSUE_UPDATE_EXAMPLE],
        ),
        responses={
            200: OpenApiResponse(
                description="Work Item patched successfully",
                response=IssueSerializer,
                examples=[ISSUE_EXAMPLE],
            ),
            400: INVALID_REQUEST_RESPONSE,
            404: WORK_ITEM_NOT_FOUND_RESPONSE,
            409: EXTERNAL_ID_EXISTS_RESPONSE,
        },
    )
    def patch(self, request, slug, project_id, pk):
        """Update the issue partially; dispatch activity tasks via Celery.

        Update an existing work item with the provided fields. Returns
        ``409 Conflict`` on duplicate ``(external_id, external_source)``.
        """
        issue = Issue.objects.get(workspace__slug=slug, project_id=project_id, pk=pk)
        project = Project.objects.get(pk=project_id)
        current_instance = json.dumps(IssueSerializer(issue).data, cls=DjangoJSONEncoder)
        requested_data = json.dumps(self.request.data, cls=DjangoJSONEncoder)
        serializer = IssueSerializer(
            issue,
            data=request.data,
            context={"project_id": project_id, "workspace_id": project.workspace_id},
            partial=True,
        )
        if serializer.is_valid():
            if (
                request.data.get("external_id")
                and (issue.external_id != str(request.data.get("external_id")))
                and Issue.objects.filter(
                    project_id=project_id,
                    workspace__slug=slug,
                    external_source=request.data.get("external_source", issue.external_source),
                    external_id=request.data.get("external_id"),
                ).exists()
            ):
                return Response(
                    {
                        "error": "Issue with the same external id and external source already exists",
                        "id": str(issue.id),
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            serializer.save()
            issue_activity.delay(
                type="issue.activity.updated",
                requested_data=requested_data,
                actor_id=str(request.user.id),
                issue_id=str(pk),
                project_id=str(project_id),
                current_instance=current_instance,
                epoch=int(timezone.now().timestamp()),
            )
            # Send the model activity for webhook dispatch
            model_activity.delay(
                model_name="issue",
                model_id=str(pk),
                requested_data=request.data,
                current_instance=current_instance,
                actor_id=request.user.id,
                slug=slug,
                origin=base_host(request=request, is_app=True),
            )
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @work_item_docs(
        operation_id="delete_work_item",
        summary="Delete work item",
        description="Permanently delete an existing work item from the project. Only admins or the item creator can perform this action.",  # noqa: E501
        parameters=[
            PROJECT_ID_PARAMETER,
        ],
        responses={
            204: DELETED_RESPONSE,
            403: ADMIN_ONLY_RESPONSE,
            404: WORK_ITEM_NOT_FOUND_RESPONSE,
        },
    )
    def delete(self, request, slug, project_id, pk):
        """Hard-delete the issue. Restricted to the creator or project ``ADMIN``.

        Permanently delete an existing work item from the project. Other
        roles receive ``403 Forbidden``. Dispatches ``issue_activity``
        via Celery+RabbitMQ.
        """
        issue = Issue.objects.get(workspace__slug=slug, project_id=project_id, pk=pk)
        if issue.created_by_id != request.user.id and (
            not ProjectMember.objects.filter(
                workspace__slug=slug,
                member=request.user,
                role=20,
                project_id=project_id,
                is_active=True,
            ).exists()
        ):
            return Response(
                {"error": "Only admin or creator can delete the work item"},
                status=status.HTTP_403_FORBIDDEN,
            )
        current_instance = json.dumps(IssueSerializer(issue).data, cls=DjangoJSONEncoder)
        issue.delete()
        issue_activity.delay(
            type="issue.activity.deleted",
            requested_data=json.dumps({"issue_id": str(pk)}),
            actor_id=str(request.user.id),
            issue_id=str(pk),
            project_id=str(project_id),
            current_instance=current_instance,
            epoch=int(timezone.now().timestamp()),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class LabelListCreateAPIEndpoint(BaseAPIView):
    """List or create labels in a project.

    HTTP methods + URL pattern:
        GET   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/labels/
        POST  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/labels/

    Request body (POST) — see ``LabelCreateUpdateSerializer``:
        name            (str, required)
        description     (str, optional)
        color           (str, optional, hex)
        parent          (uuid, optional)  – Parent label pk for nested
            labels.
        external_id     (str, optional)
        external_source (str, optional)

    Response shape:
        - GET: array of labels via ``LabelSerializer``.
        - POST: created label via ``LabelSerializer``.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectMemberPermission``:
            - GET: any project member.
            - POST: workspace ``ADMIN`` or ``MEMBER``.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Constraints on POST:
        - Returns ``409 Conflict`` if the ``name`` already exists
          (case-insensitive) within the project, with the existing
          label's id.
        - Returns ``409 Conflict`` on duplicate ``(external_id,
          external_source)``.

    Side effects on POST:
        Writes ``Label`` row; dispatches ``model_activity`` via
        Celery+RabbitMQ; fires ``label`` webhook events.
    """

    serializer_class = LabelSerializer
    model = Label
    permission_classes = [ProjectMemberPermission]
    use_read_replica = True

    def get_queryset(self):
        """Return labels in the URL's project, ordered by name."""
        return (
            Label.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(project__archived_at__isnull=True)
            .select_related("project")
            .select_related("workspace")
            .select_related("parent")
            .distinct()
            .order_by(self.kwargs.get("order_by", "-created_at"))
        )

    @label_docs(
        operation_id="create_label",
        description="Create a new label in the specified project with name, color, and description.",
        request=OpenApiRequest(
            request=LabelCreateUpdateSerializer,
            examples=[LABEL_CREATE_EXAMPLE],
        ),
        responses={
            201: OpenApiResponse(
                description="Label created successfully",
                response=LabelSerializer,
                examples=[LABEL_EXAMPLE],
            ),
            400: INVALID_REQUEST_RESPONSE,
            409: LABEL_NAME_EXISTS_RESPONSE,
        },
    )
    def post(self, request, slug, project_id):
        """Create a label in the project.

        Returns ``409 Conflict`` on duplicate ``name`` (case-insensitive)
        or duplicate ``(external_id, external_source)``.
        """
        try:
            serializer = LabelCreateUpdateSerializer(data=request.data)
            if serializer.is_valid():
                if (
                    request.data.get("external_id")
                    and request.data.get("external_source")
                    and Label.objects.filter(
                        project_id=project_id,
                        workspace__slug=slug,
                        external_source=request.data.get("external_source"),
                        external_id=request.data.get("external_id"),
                    ).exists()
                ):
                    label = Label.objects.filter(
                        workspace__slug=slug,
                        project_id=project_id,
                        external_id=request.data.get("external_id"),
                        external_source=request.data.get("external_source"),
                    ).first()
                    return Response(
                        {
                            "error": "Label with the same external id and external source already exists",
                            "id": str(label.id),
                        },
                        status=status.HTTP_409_CONFLICT,
                    )

                serializer.save(project_id=project_id)
                label = Label.objects.get(pk=serializer.instance.id)
                serializer = LabelSerializer(label)
                return Response(serializer.data, status=status.HTTP_201_CREATED)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            label = Label.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                name=request.data.get("name"),
            ).first()
            return Response(
                {
                    "error": "Label with the same name already exists in the project",
                    "id": str(label.id),
                },
                status=status.HTTP_409_CONFLICT,
            )

    @label_docs(
        operation_id="list_labels",
        description="Retrieve all labels in a project. Supports filtering by name and color.",
        parameters=[
            CURSOR_PARAMETER,
            PER_PAGE_PARAMETER,
            ORDER_BY_PARAMETER,
            FIELDS_PARAMETER,
            EXPAND_PARAMETER,
        ],
        responses={
            200: create_paginated_response(
                LabelSerializer,
                "PaginatedLabelResponse",
                "Paginated list of labels",
                "Paginated Labels",
            ),
            400: INVALID_REQUEST_RESPONSE,
            404: PROJECT_NOT_FOUND_RESPONSE,
        },
    )
    def get(self, request, slug, project_id):
        """List labels in the project."""
        return self.paginate(
            request=request,
            queryset=(self.get_queryset()),
            on_results=lambda labels: LabelSerializer(labels, many=True, fields=self.fields, expand=self.expand).data,
        )


class LabelDetailAPIEndpoint(LabelListCreateAPIEndpoint):
    """Retrieve, update, or delete a single label.

    HTTP methods + URL pattern:
        GET     /api/v1/workspaces/<slug>/projects/<uuid:project_id>/labels/<uuid:pk>/
        PATCH   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/labels/<uuid:pk>/
        DELETE  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/labels/<uuid:pk>/

    Request body (PATCH) — partial ``LabelCreateUpdateSerializer`` payload.

    Response shape:
        - GET: label via ``LabelSerializer``.
        - PATCH: updated label via ``LabelSerializer``.
        - DELETE: HTTP 204 with empty body.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectMemberPermission`` — SAFE = project member; mutations
        require project ``ADMIN`` or ``MEMBER``.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Side effects on PATCH / DELETE:
        Dispatches ``model_activity`` via Celery+RabbitMQ; fires
        ``label`` webhook events.
    """

    serializer_class = LabelSerializer
    model = Label
    permission_classes = [ProjectMemberPermission]
    use_read_replica = True

    @label_docs(
        operation_id="get_labels",
        description="Retrieve details of a specific label.",
        parameters=[
            LABEL_ID_PARAMETER,
        ],
        responses={
            200: OpenApiResponse(
                description="Labels",
                response=LabelSerializer,
                examples=[LABEL_EXAMPLE],
            ),
            404: LABEL_NOT_FOUND_RESPONSE,
        },
    )
    def get(self, request, slug, project_id, pk):
        """Retrieve the label.

        Retrieve details of a specific label by primary key.
        """
        label = self.get_queryset().get(pk=pk)
        serializer = LabelSerializer(label)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @label_docs(
        operation_id="update_label",
        description="Partially update an existing label's properties like name, color, or description.",
        parameters=[
            LABEL_ID_PARAMETER,
        ],
        request=OpenApiRequest(
            request=LabelCreateUpdateSerializer,
            examples=[LABEL_UPDATE_EXAMPLE],
        ),
        responses={
            200: OpenApiResponse(
                description="Label updated successfully",
                response=LabelSerializer,
                examples=[LABEL_EXAMPLE],
            ),
            400: INVALID_REQUEST_RESPONSE,
            404: LABEL_NOT_FOUND_RESPONSE,
            409: EXTERNAL_ID_EXISTS_RESPONSE,
        },
    )
    def patch(self, request, slug, project_id, pk):
        """Update the label partially.

        Update an existing label's properties like name, color, or description.
        Returns ``409 Conflict`` on duplicate ``(external_id, external_source)``.
        """
        label = self.get_queryset().get(pk=pk)
        serializer = LabelCreateUpdateSerializer(label, data=request.data, partial=True)
        if serializer.is_valid():
            if (
                request.data.get("external_id")
                and request.data.get("external_source")
                and Label.objects.filter(
                    project_id=project_id,
                    workspace__slug=slug,
                    external_source=request.data.get("external_source"),
                    external_id=request.data.get("external_id"),
                )
                .exclude(id=pk)
                .exists()
            ):
                return Response(
                    {
                        "error": "Label with the same external id and external source already exists",
                        "id": str(label.id),
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            serializer.save()
            label = Label.objects.get(pk=serializer.instance.id)
            serializer = LabelSerializer(label)
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @label_docs(
        operation_id="delete_label",
        description="Permanently remove a label from the project. This action cannot be undone.",
        parameters=[
            LABEL_ID_PARAMETER,
        ],
        responses={
            204: DELETED_RESPONSE,
            404: LABEL_NOT_FOUND_RESPONSE,
        },
    )
    def delete(self, request, slug, project_id, pk):
        """Hard-delete the label. Existing ``IssueLabel`` associations cascade.

        Permanently remove a label from the project. This action cannot
        be undone.
        """
        label = self.get_queryset().get(pk=pk)
        label.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class IssueLinkListCreateAPIEndpoint(BaseAPIView):
    """List or create external links attached to an issue.

    HTTP methods + URL pattern:
        GET   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/links/
        POST  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/links/
        (and the ``/work-items/<uuid:issue_id>/links/`` alias variants)

    Request body (POST) — see ``IssueLinkSerializer``:
        url      (str, required) – External URL.
        title    (str, optional) – Display title; if omitted, the title
            is asynchronously backfilled from the URL's ``<title>``
            element.
        metadata (object, optional) – Free-form metadata blob.

    Response shape:
        - GET: array of links via ``IssueLinkSerializer``.
        - POST: created link via ``IssueLinkSerializer``.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` — SAFE = project member; mutations
        require project ``ADMIN`` or ``MEMBER``.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Side effects on POST:
        - Writes ``IssueLink`` row.
        - Dispatches ``crawl_work_item_link_title`` via Celery+RabbitMQ
          to fetch the URL's HTML and backfill the ``title`` field if
          the request body did not supply one.
        - Dispatches ``issue_activity`` via Celery for the issue's
          activity feed.
    """

    serializer_class = IssueLinkSerializer
    model = IssueLink
    permission_classes = [ProjectEntityPermission]
    use_read_replica = True

    def get_queryset(self):
        """Return links attached to the URL's issue."""
        return (
            IssueLink.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(issue_id=self.kwargs.get("issue_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(project__archived_at__isnull=True)
            .order_by(self.kwargs.get("order_by", "-created_at"))
            .distinct()
        )

    @issue_link_docs(
        operation_id="list_work_item_links",
        description="Retrieve all links associated with a work item. Supports filtering by URL, title, and metadata.",
        parameters=[
            ISSUE_ID_PARAMETER,
            CURSOR_PARAMETER,
            PER_PAGE_PARAMETER,
            ORDER_BY_PARAMETER,
            FIELDS_PARAMETER,
            EXPAND_PARAMETER,
        ],
        responses={
            200: create_paginated_response(
                IssueLinkSerializer,
                "PaginatedIssueLinkResponse",
                "Paginated list of work item links",
                "Paginated Work Item Links",
            ),
            400: INVALID_REQUEST_RESPONSE,
            404: ISSUE_NOT_FOUND_RESPONSE,
        },
    )
    def get(self, request, slug, project_id, issue_id):
        """List external links attached to the issue."""
        return self.paginate(
            request=request,
            queryset=(self.get_queryset()),
            on_results=lambda issue_links: (
                IssueLinkSerializer(issue_links, many=True, fields=self.fields, expand=self.expand).data
            ),
        )

    @issue_link_docs(
        operation_id="create_work_item_link",
        description="Add a new external link to a work item with URL, title, and metadata.",
        parameters=[
            ISSUE_ID_PARAMETER,
        ],
        request=OpenApiRequest(
            request=IssueLinkCreateSerializer,
            examples=[ISSUE_LINK_CREATE_EXAMPLE],
        ),
        responses={
            201: OpenApiResponse(
                description="Work item link created successfully",
                response=IssueLinkSerializer,
                examples=[ISSUE_LINK_EXAMPLE],
            ),
            400: INVALID_REQUEST_RESPONSE,
            404: ISSUE_NOT_FOUND_RESPONSE,
        },
    )
    def post(self, request, slug, project_id, issue_id):
        """Create an external link on the issue.

        Dispatches ``crawl_work_item_link_title`` via Celery+RabbitMQ to
        backfill the link title from the URL's ``<title>`` if not
        provided. Also dispatches ``issue_activity`` for the activity
        feed.
        """
        serializer = IssueLinkCreateSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(project_id=project_id, issue_id=issue_id)
            crawl_work_item_link_title.delay(serializer.instance.id, serializer.instance.url)
            link = IssueLink.objects.get(pk=serializer.instance.id)
            link.created_by_id = request.data.get("created_by", request.user.id)
            link.save(update_fields=["created_by"])
            issue_activity.delay(
                type="link.activity.created",
                requested_data=json.dumps(serializer.data, cls=DjangoJSONEncoder),
                issue_id=str(self.kwargs.get("issue_id")),
                project_id=str(self.kwargs.get("project_id")),
                actor_id=str(link.created_by_id),
                current_instance=None,
                epoch=int(timezone.now().timestamp()),
            )
            serializer = IssueLinkSerializer(link)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class IssueLinkDetailAPIEndpoint(BaseAPIView):
    """Retrieve, update, or delete a single issue link.

    HTTP methods + URL pattern:
        GET     /.../issues/<uuid:issue_id>/links/<uuid:link_id>/
        PATCH   /.../issues/<uuid:issue_id>/links/<uuid:link_id>/
        DELETE  /.../issues/<uuid:issue_id>/links/<uuid:link_id>/
        (and the ``/work-items/`` alias variants)

    Request body (PATCH) — partial ``IssueLinkSerializer`` payload.

    Response shape:
        - GET: link via ``IssueLinkSerializer``.
        - PATCH: updated link via ``IssueLinkSerializer``.
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

    Side effects on PATCH / DELETE:
        Dispatches ``issue_activity`` via Celery+RabbitMQ for the issue's
        activity feed.
    """

    permission_classes = [ProjectEntityPermission]

    model = IssueLink
    serializer_class = IssueLinkSerializer
    use_read_replica = True

    def get_queryset(self):
        """Return links attached to the URL's issue (same scope as the list endpoint)."""
        return (
            IssueLink.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(issue_id=self.kwargs.get("issue_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(project__archived_at__isnull=True)
            .order_by(self.kwargs.get("order_by", "-created_at"))
            .distinct()
        )

    @issue_link_docs(
        operation_id="retrieve_work_item_link",
        description="Retrieve details of a specific work item link.",
        parameters=[
            ISSUE_ID_PARAMETER,
            LINK_ID_PARAMETER,
            CURSOR_PARAMETER,
            PER_PAGE_PARAMETER,
            FIELDS_PARAMETER,
            EXPAND_PARAMETER,
        ],
        responses={
            200: create_paginated_response(
                IssueLinkSerializer,
                "PaginatedIssueLinkDetailResponse",
                "Work item link details or paginated list",
                "Work Item Link Details",
            ),
            404: OpenApiResponse(description="Issue not found"),
        },
    )
    def get(self, request, slug, project_id, issue_id, pk):
        """Retrieve the link.

        Retrieve details of a specific work item link by primary key.
        """
        if pk is None:
            issue_links = self.get_queryset()
            serializer = IssueLinkSerializer(issue_links, fields=self.fields, expand=self.expand)
            return self.paginate(
                request=request,
                queryset=(self.get_queryset()),
                on_results=lambda issue_links: (
                    IssueLinkSerializer(issue_links, many=True, fields=self.fields, expand=self.expand).data
                ),
            )
        issue_link = self.get_queryset().get(pk=pk)
        serializer = IssueLinkSerializer(issue_link, fields=self.fields, expand=self.expand)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @issue_link_docs(
        operation_id="update_issue_link",
        description="Modify the URL, title, or metadata of an existing issue link.",
        parameters=[
            ISSUE_ID_PARAMETER,
            LINK_ID_PARAMETER,
        ],
        request=OpenApiRequest(
            request=IssueLinkUpdateSerializer,
            examples=[ISSUE_LINK_UPDATE_EXAMPLE],
        ),
        responses={
            200: OpenApiResponse(
                description="Issue link updated successfully",
                response=IssueLinkSerializer,
                examples=[ISSUE_LINK_EXAMPLE],
            ),
            400: INVALID_REQUEST_RESPONSE,
            404: LINK_NOT_FOUND_RESPONSE,
        },
    )
    def patch(self, request, slug, project_id, issue_id, pk):
        """Update the link partially; dispatch ``issue_activity`` via Celery.

        Modify the URL, title, or metadata of an existing issue link.
        Re-runs the asynchronous title crawl when the URL changes.
        """
        issue_link = IssueLink.objects.get(workspace__slug=slug, project_id=project_id, issue_id=issue_id, pk=pk)
        requested_data = json.dumps(request.data, cls=DjangoJSONEncoder)
        current_instance = json.dumps(IssueLinkSerializer(issue_link).data, cls=DjangoJSONEncoder)
        serializer = IssueLinkSerializer(issue_link, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            crawl_work_item_link_title.delay(serializer.data.get("id"), serializer.data.get("url"))
            issue_activity.delay(
                type="link.activity.updated",
                requested_data=requested_data,
                actor_id=str(request.user.id),
                issue_id=str(issue_id),
                project_id=str(project_id),
                current_instance=current_instance,
                epoch=int(timezone.now().timestamp()),
            )
            serializer = IssueLinkSerializer(issue_link)
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @issue_link_docs(
        operation_id="delete_work_item_link",
        description="Permanently remove an external link from a work item.",
        parameters=[
            ISSUE_ID_PARAMETER,
            LINK_ID_PARAMETER,
        ],
        responses={
            204: OpenApiResponse(description="Work item link deleted successfully"),
            404: OpenApiResponse(description="Work item link not found"),
        },
    )
    def delete(self, request, slug, project_id, issue_id, pk):
        """Hard-delete the link. Dispatches ``issue_activity`` via Celery.

        Permanently remove an external link from a work item. Records
        deletion activity in the issue's activity feed for audit
        purposes.
        """
        issue_link = IssueLink.objects.get(workspace__slug=slug, project_id=project_id, issue_id=issue_id, pk=pk)
        current_instance = json.dumps(IssueLinkSerializer(issue_link).data, cls=DjangoJSONEncoder)
        issue_activity.delay(
            type="link.activity.deleted",
            requested_data=json.dumps({"link_id": str(pk)}),
            actor_id=str(request.user.id),
            issue_id=str(issue_id),
            project_id=str(project_id),
            current_instance=current_instance,
            epoch=int(timezone.now().timestamp()),
        )
        issue_link.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class IssueCommentListCreateAPIEndpoint(BaseAPIView):
    """List or create comments on an issue.

    HTTP methods + URL pattern:
        GET   /.../issues/<uuid:issue_id>/comments/
        POST  /.../issues/<uuid:issue_id>/comments/
        (and the ``/work-items/`` alias variants)

    Request body (POST) — see ``IssueCommentSerializer``:
        comment_html      (str, optional)    – HTML body.
        comment_json      (object, optional) – Plane ProseMirror JSON.
        comment_stripped  (str, optional)    – Plain-text fallback.
        access            (str, optional)    – Comment visibility scope.
        external_id       (str, optional)
        external_source   (str, optional)

    Response shape:
        - GET: array of comments via ``IssueCommentSerializer``.
        - POST: created comment via ``IssueCommentSerializer``.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectLitePermission`` — any active project member regardless
        of role can post comments.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Webhook event:
        ``webhook_event = "issue_comment"`` — POST triggers
        ``issue_comment`` webhook fan-out if subscriptions are active.

    Side effects on POST:
        Writes ``IssueComment`` row; dispatches ``issue_activity`` and
        ``model_activity`` via Celery+RabbitMQ.
    """

    serializer_class = IssueCommentSerializer
    model = IssueComment
    webhook_event = "issue_comment"
    permission_classes = [ProjectLitePermission]
    use_read_replica = True

    def get_queryset(self):
        """Return comments on the URL's issue, ordered by creation time."""
        return (
            IssueComment.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(issue_id=self.kwargs.get("issue_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(project__archived_at__isnull=True)
            .select_related("workspace", "project", "issue", "actor")
            .annotate(
                is_member=Exists(
                    ProjectMember.objects.filter(
                        workspace__slug=self.kwargs.get("slug"),
                        project_id=self.kwargs.get("project_id"),
                        member_id=self.request.user.id,
                        is_active=True,
                    )
                )
            )
            .order_by(self.kwargs.get("order_by", "-created_at"))
            .distinct()
        )

    @issue_comment_docs(
        operation_id="list_work_item_comments",
        description="Retrieve all comments for a work item.",
        parameters=[
            ISSUE_ID_PARAMETER,
            CURSOR_PARAMETER,
            PER_PAGE_PARAMETER,
            ORDER_BY_PARAMETER,
            FIELDS_PARAMETER,
            EXPAND_PARAMETER,
        ],
        responses={
            200: create_paginated_response(
                IssueCommentSerializer,
                "PaginatedIssueCommentResponse",
                "Paginated list of work item comments",
                "Paginated Work Item Comments",
            ),
            404: OpenApiResponse(description="Issue not found"),
        },
    )
    def get(self, request, slug, project_id, issue_id):
        """List comments on the issue."""
        return self.paginate(
            request=request,
            queryset=(self.get_queryset()),
            on_results=lambda issue_comments: (
                IssueCommentSerializer(issue_comments, many=True, fields=self.fields, expand=self.expand).data
            ),
        )

    @issue_comment_docs(
        operation_id="create_work_item_comment",
        description="Add a new comment to a work item with HTML content.",
        parameters=[
            ISSUE_ID_PARAMETER,
        ],
        request=OpenApiRequest(
            request=IssueCommentCreateSerializer,
            examples=[ISSUE_COMMENT_CREATE_EXAMPLE],
        ),
        responses={
            201: OpenApiResponse(
                description="Work item comment created successfully",
                response=IssueCommentSerializer,
                examples=[ISSUE_COMMENT_EXAMPLE],
            ),
            400: INVALID_REQUEST_RESPONSE,
            404: ISSUE_NOT_FOUND_RESPONSE,
            409: EXTERNAL_ID_EXISTS_RESPONSE,
        },
    )
    def post(self, request, slug, project_id, issue_id):
        """Add a comment to the issue.

        Dispatches ``issue_activity`` and ``model_activity`` via
        Celery+RabbitMQ; fires the ``issue_comment`` webhook event.
        Returns ``409 Conflict`` on duplicate ``(external_id,
        external_source)``.
        """
        # Validation check if the issue already exists
        if (
            request.data.get("external_id")
            and request.data.get("external_source")
            and IssueComment.objects.filter(
                project_id=project_id,
                workspace__slug=slug,
                external_source=request.data.get("external_source"),
                external_id=request.data.get("external_id"),
            ).exists()
        ):
            issue_comment = IssueComment.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                external_id=request.data.get("external_id"),
                external_source=request.data.get("external_source"),
            ).first()
            return Response(
                {
                    "error": "Work item comment with the same external id and external source already exists",
                    "id": str(issue_comment.id),
                },
                status=status.HTTP_409_CONFLICT,
            )

        serializer = IssueCommentCreateSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(project_id=project_id, issue_id=issue_id, actor=request.user)
            issue_comment = IssueComment.objects.get(pk=serializer.instance.id)
            # Update the created_at and the created_by and save the comment
            issue_comment.created_at = request.data.get("created_at", timezone.now())
            issue_comment.created_by_id = request.data.get("created_by", request.user.id)
            issue_comment.actor_id = request.data.get("created_by", request.user.id)
            issue_comment.save(update_fields=["created_at", "created_by"])

            issue_activity.delay(
                type="comment.activity.created",
                requested_data=json.dumps(serializer.data, cls=DjangoJSONEncoder),
                actor_id=str(issue_comment.created_by_id),
                issue_id=str(self.kwargs.get("issue_id")),
                project_id=str(self.kwargs.get("project_id")),
                current_instance=None,
                epoch=int(timezone.now().timestamp()),
            )

            # Send the model activity
            model_activity.delay(
                model_name="issue_comment",
                model_id=str(serializer.instance.id),
                requested_data=request.data,
                current_instance=None,
                actor_id=request.user.id,
                slug=slug,
                origin=base_host(request=request, is_app=True),
            )

            serializer = IssueCommentSerializer(issue_comment)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class IssueCommentDetailAPIEndpoint(BaseAPIView):
    """Retrieve, update, or delete a single comment on an issue.

    HTTP methods + URL pattern:
        GET     /.../issues/<uuid:issue_id>/comments/<uuid:comment_id>/
        PATCH   /.../issues/<uuid:issue_id>/comments/<uuid:comment_id>/
        DELETE  /.../issues/<uuid:issue_id>/comments/<uuid:comment_id>/
        (and the ``/work-items/`` alias variants)

    Request body (PATCH) — partial ``IssueCommentSerializer`` payload.

    Response shape:
        - GET: comment via ``IssueCommentSerializer``.
        - PATCH: updated comment via ``IssueCommentSerializer``.
        - DELETE: HTTP 204 with empty body.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectLitePermission`` — any active project member can read;
        mutations are typically restricted to the comment's author by
        ``IssueCommentSerializer``/handler-level checks.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Side effects on PATCH / DELETE:
        Dispatches ``issue_activity`` and ``model_activity`` via
        Celery+RabbitMQ; fires ``issue_comment`` webhook events.
    """

    serializer_class = IssueCommentSerializer
    model = IssueComment
    webhook_event = "issue_comment"
    permission_classes = [ProjectLitePermission]
    use_read_replica = True

    def get_queryset(self):
        """Return comments on the URL's issue (same scope as the list endpoint)."""
        return (
            IssueComment.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(issue_id=self.kwargs.get("issue_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(project__archived_at__isnull=True)
            .select_related("workspace", "project", "issue", "actor")
            .annotate(
                is_member=Exists(
                    ProjectMember.objects.filter(
                        workspace__slug=self.kwargs.get("slug"),
                        project_id=self.kwargs.get("project_id"),
                        member_id=self.request.user.id,
                        is_active=True,
                    )
                )
            )
            .order_by(self.kwargs.get("order_by", "-created_at"))
            .distinct()
        )

    @issue_comment_docs(
        operation_id="retrieve_work_item_comment",
        description="Retrieve details of a specific comment.",
        parameters=[
            ISSUE_ID_PARAMETER,
            COMMENT_ID_PARAMETER,
        ],
        responses={
            200: OpenApiResponse(
                description="Work item comments",
                response=IssueCommentSerializer,
                examples=[ISSUE_COMMENT_EXAMPLE],
            ),
            400: INVALID_REQUEST_RESPONSE,
            404: ISSUE_NOT_FOUND_RESPONSE,
        },
    )
    def get(self, request, slug, project_id, issue_id, pk):
        """Retrieve the comment.

        Retrieve details of a specific comment by primary key.
        """
        issue_comment = self.get_queryset().get(pk=pk)
        serializer = IssueCommentSerializer(issue_comment, fields=self.fields, expand=self.expand)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @issue_comment_docs(
        operation_id="update_work_item_comment",
        description="Modify the content of an existing comment on a work item.",
        parameters=[
            ISSUE_ID_PARAMETER,
            COMMENT_ID_PARAMETER,
        ],
        request=OpenApiRequest(
            request=IssueCommentCreateSerializer,
            examples=[ISSUE_COMMENT_UPDATE_EXAMPLE],
        ),
        responses={
            200: OpenApiResponse(
                description="Work item comment updated successfully",
                response=IssueCommentSerializer,
                examples=[ISSUE_COMMENT_EXAMPLE],
            ),
            400: INVALID_REQUEST_RESPONSE,
            404: COMMENT_NOT_FOUND_RESPONSE,
            409: EXTERNAL_ID_EXISTS_RESPONSE,
        },
    )
    def patch(self, request, slug, project_id, issue_id, pk):
        """Update the comment partially.

        Dispatches ``issue_activity`` and ``model_activity`` via
        Celery; fires ``issue_comment`` webhook events. Returns
        ``409 Conflict`` on duplicate ``(external_id, external_source)``.
        """
        issue_comment = IssueComment.objects.get(workspace__slug=slug, project_id=project_id, issue_id=issue_id, pk=pk)
        requested_data = json.dumps(self.request.data, cls=DjangoJSONEncoder)
        current_instance = json.dumps(IssueCommentSerializer(issue_comment).data, cls=DjangoJSONEncoder)

        # Validation check if the issue already exists
        if (
            request.data.get("external_id")
            and (issue_comment.external_id != str(request.data.get("external_id")))
            and IssueComment.objects.filter(
                project_id=project_id,
                workspace__slug=slug,
                external_source=request.data.get("external_source", issue_comment.external_source),
                external_id=request.data.get("external_id"),
            ).exists()
        ):
            return Response(
                {
                    "error": "Work item comment with the same external id and external source already exists",
                    "id": str(issue_comment.id),
                },
                status=status.HTTP_409_CONFLICT,
            )

        serializer = IssueCommentCreateSerializer(issue_comment, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            issue_activity.delay(
                type="comment.activity.updated",
                requested_data=requested_data,
                actor_id=str(request.user.id),
                issue_id=str(issue_id),
                project_id=str(project_id),
                current_instance=current_instance,
                epoch=int(timezone.now().timestamp()),
            )
            # Send the model activity
            model_activity.delay(
                model_name="issue_comment",
                model_id=str(pk),
                requested_data=request.data,
                current_instance=current_instance,
                actor_id=request.user.id,
                slug=slug,
                origin=base_host(request=request, is_app=True),
            )

            issue_comment = IssueComment.objects.get(pk=serializer.instance.id)
            serializer = IssueCommentSerializer(issue_comment)
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @issue_comment_docs(
        operation_id="delete_work_item_comment",
        description="Permanently remove a comment from a work item. Records deletion activity for audit purposes.",
        parameters=[
            ISSUE_ID_PARAMETER,
            COMMENT_ID_PARAMETER,
        ],
        responses={
            204: OpenApiResponse(description="Work item comment deleted successfully"),
            404: COMMENT_NOT_FOUND_RESPONSE,
        },
    )
    def delete(self, request, slug, project_id, issue_id, pk):
        """Hard-delete the comment.

        Dispatches ``issue_activity`` and ``model_activity`` via Celery;
        fires ``issue_comment`` webhook events.
        """
        issue_comment = IssueComment.objects.get(workspace__slug=slug, project_id=project_id, issue_id=issue_id, pk=pk)
        current_instance = json.dumps(IssueCommentSerializer(issue_comment).data, cls=DjangoJSONEncoder)
        issue_comment.delete()
        issue_activity.delay(
            type="comment.activity.deleted",
            requested_data=json.dumps({"comment_id": str(pk)}),
            actor_id=str(request.user.id),
            issue_id=str(issue_id),
            project_id=str(project_id),
            current_instance=current_instance,
            epoch=int(timezone.now().timestamp()),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class IssueActivityListAPIEndpoint(BaseAPIView):
    """List model-state activity entries for an issue (read-only).

    HTTP methods + URL pattern:
        GET   /.../issues/<uuid:issue_id>/activities/

    Response shape:
        Paginated array of ``IssueActivity`` rows via
        ``IssueActivitySerializer``. The endpoint EXCLUDES activities of
        type ``comment``, ``vote``, ``reaction``, and ``draft`` — those
        events have dedicated endpoints. Only model-state activities
        (state change, assignee change, label change, schedule change,
        priority change, etc.) are returned.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` — any project member can read.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Performance:
        ``use_read_replica = True`` — served by the read replica.

    Side effects:
        Read-only.
    """

    permission_classes = [ProjectEntityPermission]
    use_read_replica = True

    @issue_activity_docs(
        operation_id="list_work_item_activities",
        description="Retrieve all activities for a work item. Supports filtering by activity type and date range.",
        parameters=[
            ISSUE_ID_PARAMETER,
            CURSOR_PARAMETER,
            PER_PAGE_PARAMETER,
            ORDER_BY_PARAMETER,
            FIELDS_PARAMETER,
            EXPAND_PARAMETER,
        ],
        responses={
            200: create_paginated_response(
                IssueActivitySerializer,
                "PaginatedIssueActivityResponse",
                "Paginated list of issue activities",
                "Paginated Issue Activities",
            ),
            400: INVALID_REQUEST_RESPONSE,
            404: ISSUE_NOT_FOUND_RESPONSE,
        },
    )
    def get(self, request, slug, project_id, issue_id):
        """List model-state activities for the issue.

        Returns model-state activities for the URL's issue. Excludes
        activities of type ``comment``, ``vote``, ``reaction``, and
        ``draft``.
        """
        issue_activities = (
            IssueActivity.objects.filter(issue_id=issue_id, workspace__slug=slug, project_id=project_id)
            .filter(
                ~Q(field__in=["comment", "vote", "reaction", "draft"]),
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(project__archived_at__isnull=True)
            .select_related("actor", "workspace", "issue", "project")
        ).order_by(request.GET.get("order_by", "created_at"))

        return self.paginate(
            request=request,
            queryset=(issue_activities),
            on_results=lambda issue_activity: (
                IssueActivitySerializer(issue_activity, many=True, fields=self.fields, expand=self.expand).data
            ),
        )


class IssueActivityDetailAPIEndpoint(BaseAPIView):
    """Retrieve a single activity entry for an issue.

    HTTP methods + URL pattern:
        GET   /.../issues/<uuid:issue_id>/activities/<uuid:activity_id>/

    Response shape:
        ``IssueActivity`` row via ``IssueActivitySerializer``. Same
        filtering as the list endpoint (excludes ``comment``, ``vote``,
        ``reaction``, ``draft`` types).

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` — any project member can read.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Side effects:
        Read-only.
    """

    permission_classes = [ProjectEntityPermission]
    use_read_replica = True

    @issue_activity_docs(
        operation_id="retrieve_work_item_activity",
        description="Retrieve details of a specific activity.",
        parameters=[
            ISSUE_ID_PARAMETER,
            ACTIVITY_ID_PARAMETER,
            CURSOR_PARAMETER,
            PER_PAGE_PARAMETER,
            ORDER_BY_PARAMETER,
            FIELDS_PARAMETER,
            EXPAND_PARAMETER,
        ],
        responses={
            200: create_paginated_response(
                IssueActivitySerializer,
                "PaginatedIssueActivityDetailResponse",
                "Paginated list of work item activities",
                "Work Item Activity Details",
            ),
            400: INVALID_REQUEST_RESPONSE,
            404: ISSUE_NOT_FOUND_RESPONSE,
        },
    )
    def get(self, request, slug, project_id, issue_id, pk):
        """Retrieve the activity entry, applying the same type filter as the list endpoint.

        Retrieve details of a specific activity. Excludes ``comment``,
        ``vote``, ``reaction``, and ``draft`` activities.
        """
        issue_activity = (
            (
                IssueActivity.objects.filter(issue_id=issue_id, workspace__slug=slug, project_id=project_id, id=pk)
                .filter(
                    ~Q(field__in=["comment", "vote", "reaction", "draft"]),
                    project__project_projectmember__member=self.request.user,
                    project__project_projectmember__is_active=True,
                )
                .filter(project__archived_at__isnull=True)
                .select_related("actor", "workspace", "issue", "project")
            )
            .order_by(request.GET.get("order_by", "created_at"))
            .first()
        )

        if not issue_activity:
            return Response({"message": "Activity not found.", "code": "NOT_FOUND"}, status=status.HTTP_404_NOT_FOUND)

        return Response(
            IssueActivitySerializer(issue_activity, fields=self.fields, expand=self.expand).data,
            status=status.HTTP_200_OK,
        )


class IssueAttachmentListCreateAPIEndpoint(BaseAPIView):
    """List or create file attachments on an issue.

    HTTP methods + URL pattern:
        GET   /.../issues/<uuid:issue_id>/issue-attachments/
        POST  /.../issues/<uuid:issue_id>/issue-attachments/
        (and the ``/work-items/<uuid:issue_id>/issue-attachments/``
        alias variants)

    Request body (POST):
        name        (str, required) – Original filename.
        type        (str, required) – MIME type; must appear in
            ``settings.ATTACHMENT_MIME_TYPES``.
        size        (int, required) – File size in bytes; must be
            ``<= settings.FILE_SIZE_LIMIT``.

    Response shape:
        - GET: array of ``FileAsset`` rows via the attachment serializer.
        - POST: ``{asset_id, asset_url, upload_data: {url, fields}}``
          where ``upload_data`` is the S3 presigned POST payload
          generated by ``S3Storage.generate_presigned_post``.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` + the ``user_has_issue_permission``
        helper — enforces fine-grained access against the parent issue
        (creator, assignee, or workspace ADMIN can attach).
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Side effects on POST:
        - Writes a ``FileAsset`` row with ``is_uploaded=False``,
          ``entity_type=ISSUE_ATTACHMENT``, ``entity_identifier=<issue
          pk>``.
        - Generates an S3 presigned PUT URL via
          ``S3Storage.generate_presigned_post``.
        - Dispatches ``issue_activity`` via Celery+RabbitMQ.
    """

    serializer_class = IssueAttachmentSerializer
    model = FileAsset
    use_read_replica = True

    @issue_attachment_docs(
        operation_id="create_work_item_attachment",
        description="Generate presigned URL for uploading file attachments to a work item.",
        parameters=[
            ISSUE_ID_PARAMETER,
        ],
        request=OpenApiRequest(
            request=IssueAttachmentUploadSerializer,
            examples=[ISSUE_ATTACHMENT_UPLOAD_EXAMPLE],
        ),
        responses={
            200: OpenApiResponse(
                description="Presigned download URL generated successfully",
                examples=[
                    OpenApiExample(
                        name="Work Item Attachment Response",
                        value={
                            "upload_data": {
                                "url": "https://s3.amazonaws.com/bucket/file.pdf?signed-url",
                                "fields": {
                                    "key": "file.pdf",
                                    "AWSAccessKeyId": "AKIAIOSFODNN7EXAMPLE",
                                    "policy": "EXAMPLE",
                                    "signature": "EXAMPLE",
                                    "acl": "public-read",
                                    "Content-Type": "application/pdf",
                                },
                            },
                            "asset_id": "550e8400-e29b-41d4-a716-446655440000",
                            "asset_url": "https://s3.amazonaws.com/bucket/file.pdf?signed-url",
                            "attachment": {
                                "id": "550e8400-e29b-41d4-a716-446655440000",
                                "name": "file.pdf",
                                "type": "application/pdf",
                                "size": 1234567890,
                                "url": "https://s3.amazonaws.com/bucket/file.pdf?signed-url",
                            },
                        },
                    )
                ],
            ),
            400: OpenApiResponse(
                description="Validation error",
                examples=[
                    OpenApiExample(
                        name="Missing required fields",
                        value={
                            "error": "Name and size are required fields.",
                            "status": False,
                        },
                    ),
                    OpenApiExample(
                        name="Invalid file type",
                        value={"error": "Invalid file type.", "status": False},
                    ),
                ],
            ),
            404: OpenApiResponse(
                description="Issue or Project or Workspace not found",
                examples=[
                    OpenApiExample(
                        name="Workspace not found",
                        value={"error": "Workspace not found"},
                    ),
                    OpenApiExample(name="Project not found", value={"error": "Project not found"}),
                    OpenApiExample(name="Issue not found", value={"error": "Issue not found"}),
                ],
            ),
        },
    )
    def post(self, request, slug, project_id, issue_id):
        """Create a new attachment slot and return a presigned PUT URL.

        Validates the requested MIME type and size against
        ``settings.ATTACHMENT_MIME_TYPES`` and ``settings.FILE_SIZE_LIMIT``.
        Dispatches ``issue_activity`` via Celery+RabbitMQ.
        """
        issue = Issue.objects.get(pk=issue_id, workspace__slug=slug, project_id=project_id)
        # if the user is creator or admin,member then allow the upload
        if not user_has_issue_permission(
            request.user.id,
            project_id=project_id,
            issue=issue,
            allowed_roles=[ROLE.ADMIN.value, ROLE.MEMBER.value, ROLE.GUEST.value],
            allow_creator=True,
        ):
            return Response(
                {"error": "You are not allowed to upload this attachment"},
                status=status.HTTP_403_FORBIDDEN,
            )

        name = sanitize_filename(request.data.get("name"))
        type = request.data.get("type", False)
        size = request.data.get("size")
        external_id = request.data.get("external_id")
        external_source = request.data.get("external_source")

        # Check if the request is valid
        if not name or not size:
            return Response(
                {"error": "Invalid request.", "status": False},
                status=status.HTTP_400_BAD_REQUEST,
            )

        size_limit = min(size, settings.FILE_SIZE_LIMIT)

        if not type or type not in settings.ATTACHMENT_MIME_TYPES:
            return Response(
                {"error": "Invalid file type.", "status": False},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get the workspace
        workspace = Workspace.objects.get(slug=slug)

        # asset key
        asset_key = f"{workspace.id}/{uuid.uuid4().hex}-{name}"

        if (
            request.data.get("external_id")
            and request.data.get("external_source")
            and FileAsset.objects.filter(
                project_id=project_id,
                workspace__slug=slug,
                external_source=request.data.get("external_source"),
                external_id=request.data.get("external_id"),
                issue_id=issue_id,
                entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            ).exists()
        ):
            asset = FileAsset.objects.filter(
                project_id=project_id,
                workspace__slug=slug,
                external_source=request.data.get("external_source"),
                external_id=request.data.get("external_id"),
                issue_id=issue_id,
                entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            ).first()
            return Response(
                {
                    "error": "Issue with the same external id and external source already exists",
                    "id": str(asset.id),
                },
                status=status.HTTP_409_CONFLICT,
            )

        # Create a File Asset
        asset = FileAsset.objects.create(
            attributes={"name": name, "type": type, "size": size_limit},
            asset=asset_key,
            size=size_limit,
            workspace_id=workspace.id,
            created_by=request.user,
            issue_id=issue_id,
            project_id=project_id,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            external_id=external_id,
            external_source=external_source,
        )

        # Get the presigned URL
        storage = S3Storage(request=request)
        # Generate a presigned URL to share an S3 object
        presigned_url = storage.generate_presigned_post(object_name=asset_key, file_type=type, file_size=size_limit)
        # Return the presigned URL
        return Response(
            {
                "upload_data": presigned_url,
                "asset_id": str(asset.id),
                "attachment": IssueAttachmentSerializer(asset).data,
                "asset_url": asset.asset_url,
            },
            status=status.HTTP_200_OK,
        )

    @issue_attachment_docs(
        operation_id="list_work_item_attachments",
        description="Retrieve all attachments for a work item.",
        parameters=[
            ISSUE_ID_PARAMETER,
        ],
        responses={
            200: OpenApiResponse(
                description="Work item attachment",
                response=IssueAttachmentSerializer,
                examples=[ISSUE_ATTACHMENT_EXAMPLE],
            ),
            400: INVALID_REQUEST_RESPONSE,
            404: ATTACHMENT_NOT_FOUND_RESPONSE,
        },
    )
    def get(self, request, slug, project_id, issue_id):
        """List uploaded attachments on the issue.

        Returns only ``FileAsset`` rows where ``is_uploaded=True`` to
        avoid exposing rows whose S3 PUT has not completed.
        """
        # Get all the attachments
        issue_attachments = FileAsset.objects.filter(
            issue_id=issue_id,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            workspace__slug=slug,
            project_id=project_id,
            is_uploaded=True,
        )
        # Serialize the attachments
        serializer = IssueAttachmentSerializer(issue_attachments, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


class IssueAttachmentDetailAPIEndpoint(BaseAPIView):
    """Retrieve, finalize, or delete a single issue attachment.

    HTTP methods + URL pattern:
        GET     /.../issues/<uuid:issue_id>/issue-attachments/<uuid:pk>/
        PATCH   /.../issues/<uuid:issue_id>/issue-attachments/<uuid:pk>/
        DELETE  /.../issues/<uuid:issue_id>/issue-attachments/<uuid:pk>/

    Request body (PATCH):
        is_uploaded (bool, required) – Confirms the client has finished
            the S3 PUT.

    Response shape:
        - GET: HTTP 302 redirect to the S3 presigned GET URL for the
          underlying object (so the client downloads directly from S3).
        - PATCH: ``FileAsset`` serialized payload after marking uploaded.
        - DELETE: HTTP 204 with empty body.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` + ``user_has_issue_permission`` —
        same fine-grained issue access check as the create endpoint.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Side effects:
        - PATCH: sets ``is_uploaded=True`` and dispatches
          ``get_asset_object_metadata`` via Celery+RabbitMQ to backfill
          MIME / size from S3 head metadata.
        - DELETE: soft-deletes via ``is_deleted=True`` +
          ``deleted_at=timezone.now()``. The S3 object is reaped by the
          ``file_asset`` Celery beat job at 02:00 UTC.
    """

    serializer_class = IssueAttachmentSerializer
    model = FileAsset
    use_read_replica = True

    @issue_attachment_docs(
        operation_id="delete_work_item_attachment",
        description="Permanently remove an attachment from a work item. Records deletion activity for audit purposes.",
        parameters=[
            ATTACHMENT_ID_PARAMETER,
        ],
        responses={
            204: OpenApiResponse(description="Work item attachment deleted successfully"),
            404: ATTACHMENT_NOT_FOUND_RESPONSE,
        },
    )
    def delete(self, request, slug, project_id, issue_id, pk):
        """Soft-delete the attachment row; the S3 object is reaped by Celery beat at 02:00 UTC.

        Marks ``is_deleted=True`` and ``deleted_at=timezone.now()``;
        dispatches ``issue_activity`` via Celery+RabbitMQ. The underlying
        S3 object is removed by the ``file_asset`` Celery beat job.
        """
        issue = Issue.objects.get(pk=issue_id, workspace__slug=slug, project_id=project_id)
        # if the request user is creator or admin then delete the attachment
        if not user_has_issue_permission(
            request.user.id,
            project_id=project_id,
            issue=issue,
            allowed_roles=[ROLE.ADMIN.value, ROLE.MEMBER.value, ROLE.GUEST.value],
            allow_creator=True,
        ):
            return Response(
                {"error": "You are not allowed to delete this attachment"},
                status=status.HTTP_403_FORBIDDEN,
            )

        issue_attachment = FileAsset.objects.get(pk=pk, workspace__slug=slug, project_id=project_id)
        issue_attachment.is_deleted = True
        issue_attachment.deleted_at = timezone.now()
        issue_attachment.save()

        issue_activity.delay(
            type="attachment.activity.deleted",
            requested_data=None,
            actor_id=str(self.request.user.id),
            issue_id=str(issue_id),
            project_id=str(project_id),
            current_instance=None,
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )

        # Get the storage metadata
        if not issue_attachment.storage_metadata:
            get_asset_object_metadata.delay(str(issue_attachment.id))
        issue_attachment.save()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @issue_attachment_docs(
        operation_id="retrieve_work_item_attachment",
        description="Download attachment file. Returns a redirect to the presigned download URL.",
        parameters=[
            ATTACHMENT_ID_PARAMETER,
        ],
        responses={
            302: OpenApiResponse(
                description="Redirect to presigned download URL",
            ),
            400: OpenApiResponse(
                description="Asset not uploaded",
                response={
                    "type": "object",
                    "properties": {
                        "error": {
                            "type": "string",
                            "description": "Error message",
                            "example": "The asset is not uploaded.",
                        },
                        "status": {
                            "type": "boolean",
                            "description": "Request status",
                            "example": False,
                        },
                    },
                },
                examples=[ISSUE_ATTACHMENT_NOT_UPLOADED_EXAMPLE],
            ),
            404: ATTACHMENT_NOT_FOUND_RESPONSE,
        },
    )
    def get(self, request, slug, project_id, issue_id, pk):
        """Redirect to a fresh S3 presigned GET URL (HTTP 302) for the underlying object.

        Returns ``HTTP 302`` so the client downloads directly from S3.
        Returns ``HTTP 400`` if the asset has not been finalized via the
        ``PATCH`` endpoint.
        """
        # if the user is part of the project then allow the download
        if not user_has_issue_permission(
            request.user.id,
            project_id=project_id,
            issue=None,
            allowed_roles=None,
            allow_creator=False,
        ):
            return Response(
                {"error": "You are not allowed to download this attachment"},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Get the asset
        asset = FileAsset.objects.get(id=pk, workspace__slug=slug, project_id=project_id)

        # Check if the asset is uploaded
        if not asset.is_uploaded:
            return Response(
                {"error": "The asset is not uploaded.", "status": False},
                status=status.HTTP_400_BAD_REQUEST,
            )

        storage = S3Storage(request=request)
        presigned_url = storage.generate_presigned_url(
            object_name=asset.asset.name,
            disposition="attachment",
            filename=asset.attributes.get("name"),
        )
        return HttpResponseRedirect(presigned_url)

    @issue_attachment_docs(
        operation_id="upload_work_item_attachment",
        description="Mark an attachment as uploaded after successful file transfer to storage.",
        parameters=[
            ATTACHMENT_ID_PARAMETER,
        ],
        request=OpenApiRequest(
            request={
                "application/json": {
                    "type": "object",
                    "properties": {
                        "is_uploaded": {
                            "type": "boolean",
                            "description": "Mark attachment as uploaded",
                        }
                    },
                }
            },
            examples=[ATTACHMENT_UPLOAD_CONFIRM_EXAMPLE],
        ),
        responses={
            204: OpenApiResponse(description="Work item attachment uploaded successfully"),
            400: INVALID_REQUEST_RESPONSE,
            404: ATTACHMENT_NOT_FOUND_RESPONSE,
        },
    )
    def patch(self, request, slug, project_id, issue_id, pk):
        """Mark the attachment upload complete and enqueue metadata backfill via Celery.

        Sets ``is_uploaded=True`` and dispatches
        ``get_asset_object_metadata`` via Celery+RabbitMQ to backfill
        MIME / size from S3 head metadata. The activity entry is only
        emitted on the first transition.
        """
        issue = Issue.objects.get(pk=issue_id, workspace__slug=slug, project_id=project_id)
        # if the user is creator or admin then allow the upload
        if not user_has_issue_permission(
            request.user.id,
            project_id=project_id,
            issue=issue,
            allowed_roles=[ROLE.ADMIN.value, ROLE.MEMBER.value, ROLE.GUEST.value],
            allow_creator=True,
        ):
            return Response(
                {"error": "You are not allowed to upload this attachment"},
                status=status.HTTP_403_FORBIDDEN,
            )

        issue_attachment = FileAsset.objects.get(pk=pk, workspace__slug=slug, project_id=project_id)
        serializer = IssueAttachmentSerializer(issue_attachment)

        # Send this activity only if the attachment is not uploaded before
        if not issue_attachment.is_uploaded:
            issue_activity.delay(
                type="attachment.activity.created",
                requested_data=None,
                actor_id=str(self.request.user.id),
                issue_id=str(self.kwargs.get("issue_id", None)),
                project_id=str(self.kwargs.get("project_id", None)),
                current_instance=json.dumps(serializer.data, cls=DjangoJSONEncoder),
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )

            # Update the attachment
            issue_attachment.is_uploaded = True
            issue_attachment.created_by = request.user

        # Get the storage metadata
        if not issue_attachment.storage_metadata:
            get_asset_object_metadata.delay(str(issue_attachment.id))
        issue_attachment.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


class IssueSearchEndpoint(BaseAPIView):
    """Workspace-wide search across issues.

    HTTP methods + URL pattern:
        GET   /api/v1/workspaces/<slug>/issues/search/

    Query parameters:
        search (str, required) – Search term applied to ``name``,
            ``sequence_id``, and ``project__identifier`` (all case-
            insensitive ``icontains``).

    Response shape:
        Paginated array of matching issues via ``IssueLiteSerializer``.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` — only returns issues from projects
        the requesting user can access.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Performance:
        ``use_read_replica = True`` — served by the read replica.

    Side effects:
        Read-only.
    """

    use_read_replica = True

    @extend_schema(
        operation_id="search_work_items",
        tags=["Work Items"],
        description="Perform semantic search across issue names, sequence IDs, and project identifiers.",
        parameters=[
            WORKSPACE_SLUG_PARAMETER,
            SEARCH_PARAMETER_REQUIRED,
            LIMIT_PARAMETER,
            WORKSPACE_SEARCH_PARAMETER,
            PROJECT_ID_QUERY_PARAMETER,
        ],
        responses={
            200: OpenApiResponse(
                description="Work item search results",
                response=IssueSearchSerializer,
                examples=[ISSUE_SEARCH_EXAMPLE],
            ),
            400: BAD_SEARCH_REQUEST_RESPONSE,
            401: UNAUTHORIZED_RESPONSE,
            403: FORBIDDEN_RESPONSE,
            404: WORKSPACE_NOT_FOUND_RESPONSE,
        },
    )
    def get(self, request, slug):
        """Return issues whose name, sequence id, or project identifier matches the search term.

        Supports workspace-wide or project-specific search with
        configurable result limits via ``limit`` and ``project_id``
        query parameters.
        """
        query = request.query_params.get("search", False)
        limit = request.query_params.get("limit", 10)
        workspace_search = request.query_params.get("workspace_search", "false")
        project_id = request.query_params.get("project_id", False)

        if not query:
            return Response({"issues": []}, status=status.HTTP_200_OK)

        # Build search query
        fields = ["name", "sequence_id", "project__identifier"]
        q = Q()
        for field in fields:
            if field == "sequence_id":
                # Match whole integers only (exclude decimal numbers)
                sequences = re.findall(r"\b\d+\b", query)
                for sequence_id in sequences:
                    q |= Q(**{"sequence_id": sequence_id})
            else:
                q |= Q(**{f"{field}__icontains": query})

        # Filter issues
        issues = Issue.issue_objects.filter(
            q,
            project__project_projectmember__member=self.request.user,
            project__project_projectmember__is_active=True,
            project__archived_at__isnull=True,
            workspace__slug=slug,
        )

        # Apply project filter if not searching across workspace
        if workspace_search == "false" and project_id:
            issues = issues.filter(project_id=project_id)

        # Get results
        issue_results = issues.distinct().values(
            "name",
            "id",
            "sequence_id",
            "project__identifier",
            "project_id",
            "workspace__slug",
        )[: int(limit)]

        return Response({"issues": issue_results}, status=status.HTTP_200_OK)


class IssueRelationListCreateAPIEndpoint(BaseAPIView):
    """List or create relations between issues.

    HTTP methods + URL pattern:
        GET   /.../issues/<uuid:issue_id>/issue-relation/
        POST  /.../issues/<uuid:issue_id>/issue-relation/

    Request body (POST):
        relation_type (str, required) – One of ``blocking``,
            ``blocked_by``, ``duplicate``, ``relates_to``,
            ``start_before``, ``start_after``, ``finish_before``,
            ``finish_after``.
        issues        (list[uuid], required) – Target issue pks to
            link the source issue to.

    Response shape:
        - GET: array of relations via ``IssueRelationSerializer``,
          grouped by relation type.
        - POST: array of created ``IssueRelation`` rows.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` — mutations require project ``ADMIN``
        or ``MEMBER``.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Semantics:
        Symmetric pairs are created so each side of the relation is
        addressable from either issue. The actual mapping (e.g.
        ``blocking`` ↔ ``blocked_by``) is computed by
        ``plane.utils.issue_relation_mapper.get_actual_relation``.

    Side effects on POST:
        Writes ``IssueRelation`` rows (one per direction); dispatches
        ``issue_activity`` via Celery+RabbitMQ for each related issue's
        activity feed.
    """

    serializer_class = IssueRelationSerializer
    model = IssueRelation
    permission_classes = [ProjectEntityPermission]
    use_read_replica = True

    @work_item_relation_docs(
        operation_id="list_work_item_relations",
        summary="List work item relations",
        description="Retrieve all relationships for a work item including blocking, blocked_by, duplicate, relates_to, start_before, start_after, finish_before, and finish_after relations.",  # noqa E501
        parameters=[
            ISSUE_ID_PARAMETER,
            CURSOR_PARAMETER,
            PER_PAGE_PARAMETER,
            ORDER_BY_PARAMETER,
            FIELDS_PARAMETER,
            EXPAND_PARAMETER,
        ],
        responses={
            200: OpenApiResponse(
                description="Work item relations grouped by relation type",
                response=IssueRelationResponseSerializer,
                examples=[
                    OpenApiExample(
                        name="Work Item Relations Response",
                        value={
                            "blocking": [
                                {
                                    "project_id": "550e8400-e29b-41d4-a716-446655440010",
                                    "issue_id": "550e8400-e29b-41d4-a716-446655440000",
                                },
                                {
                                    "project_id": "550e8400-e29b-41d4-a716-446655440010",
                                    "issue_id": "550e8400-e29b-41d4-a716-446655440001",
                                },
                            ],
                            "blocked_by": [
                                {
                                    "project_id": "550e8400-e29b-41d4-a716-446655440011",
                                    "issue_id": "550e8400-e29b-41d4-a716-446655440002",
                                },
                            ],
                            "duplicate": [],
                            "relates_to": [
                                {
                                    "project_id": "550e8400-e29b-41d4-a716-446655440010",
                                    "issue_id": "550e8400-e29b-41d4-a716-446655440003",
                                },
                            ],
                            "start_after": [],
                            "start_before": [
                                {
                                    "project_id": "550e8400-e29b-41d4-a716-446655440012",
                                    "issue_id": "550e8400-e29b-41d4-a716-446655440004",
                                },
                            ],
                            "finish_after": [],
                            "finish_before": [],
                        },
                    )
                ],
            ),
            400: INVALID_REQUEST_RESPONSE,
            404: ISSUE_NOT_FOUND_RESPONSE,
        },
    )
    def get(self, request, slug, project_id, issue_id):
        """List relations for the issue, grouped by relation type.

        Returns relations originating from the URL's issue plus the
        symmetric inverses, organised into ``blocking``, ``blocked_by``,
        ``duplicate``, ``relates_to``, ``start_after``, ``start_before``,
        ``finish_after``, and ``finish_before`` buckets.
        """
        relations = IssueRelation.objects.filter(
            Q(issue_id=issue_id) | Q(related_issue_id=issue_id),
            workspace__slug=slug,
        ).values(
            "relation_type",
            "issue_id",
            "related_issue_id",
            issue_project_id=F("issue__project_id"),
            related_issue_project_id=F("related_issue__project_id"),
        )

        response_data = {
            "blocking": [],
            "blocked_by": [],
            "duplicate": [],
            "relates_to": [],
            "start_after": [],
            "start_before": [],
            "finish_after": [],
            "finish_before": [],
        }
        seen_duplicate = set()
        seen_relates_to = set()

        for rel in relations:
            rt = rel["relation_type"]
            if rt == "blocked_by":
                if str(rel["related_issue_id"]) == str(issue_id):
                    response_data["blocking"].append(
                        {"project_id": str(rel["issue_project_id"]), "issue_id": str(rel["issue_id"])}
                    )
                if str(rel["issue_id"]) == str(issue_id):
                    response_data["blocked_by"].append(
                        {"project_id": str(rel["related_issue_project_id"]), "issue_id": str(rel["related_issue_id"])}
                    )
            elif rt == "duplicate":
                if str(rel["issue_id"]) == str(issue_id) and rel["related_issue_id"] not in seen_duplicate:
                    seen_duplicate.add(rel["related_issue_id"])
                    response_data["duplicate"].append(
                        {"project_id": str(rel["related_issue_project_id"]), "issue_id": str(rel["related_issue_id"])}
                    )
                if str(rel["related_issue_id"]) == str(issue_id) and rel["issue_id"] not in seen_duplicate:
                    seen_duplicate.add(rel["issue_id"])
                    response_data["duplicate"].append(
                        {"project_id": str(rel["issue_project_id"]), "issue_id": str(rel["issue_id"])}
                    )
            elif rt == "relates_to":
                if str(rel["issue_id"]) == str(issue_id) and rel["related_issue_id"] not in seen_relates_to:
                    seen_relates_to.add(rel["related_issue_id"])
                    response_data["relates_to"].append(
                        {"project_id": str(rel["related_issue_project_id"]), "issue_id": str(rel["related_issue_id"])}
                    )
                if str(rel["related_issue_id"]) == str(issue_id) and rel["issue_id"] not in seen_relates_to:
                    seen_relates_to.add(rel["issue_id"])
                    response_data["relates_to"].append(
                        {"project_id": str(rel["issue_project_id"]), "issue_id": str(rel["issue_id"])}
                    )
            elif rt == "start_before":
                if str(rel["related_issue_id"]) == str(issue_id):
                    response_data["start_after"].append(
                        {"project_id": str(rel["issue_project_id"]), "issue_id": str(rel["issue_id"])}
                    )
                if str(rel["issue_id"]) == str(issue_id):
                    response_data["start_before"].append(
                        {"project_id": str(rel["related_issue_project_id"]), "issue_id": str(rel["related_issue_id"])}
                    )
            elif rt == "finish_before":
                if str(rel["related_issue_id"]) == str(issue_id):
                    response_data["finish_after"].append(
                        {"project_id": str(rel["issue_project_id"]), "issue_id": str(rel["issue_id"])}
                    )
                if str(rel["issue_id"]) == str(issue_id):
                    response_data["finish_before"].append(
                        {"project_id": str(rel["related_issue_project_id"]), "issue_id": str(rel["related_issue_id"])}
                    )

        return Response(response_data, status=status.HTTP_200_OK)

    @work_item_relation_docs(
        operation_id="create_work_item_relation",
        summary="Create work item relation",
        description="Create relationships between work items. Supports various relation types including blocking, blocked_by, duplicate, relates_to, start_before, start_after, finish_before, and finish_after.",  # noqa E501
        parameters=[
            ISSUE_ID_PARAMETER,
        ],
        request=OpenApiRequest(
            request=IssueRelationCreateSerializer,
            examples=[
                OpenApiExample(
                    name="Create blocking relation",
                    value={
                        "relation_type": "blocking",
                        "issues": [
                            "550e8400-e29b-41d4-a716-446655440000",
                            "550e8400-e29b-41d4-a716-446655440001",
                        ],
                    },
                )
            ],
        ),
        responses={
            201: OpenApiResponse(
                description="Work item relations created successfully",
                response=IssueRelationSerializer(many=True),
                examples=[
                    OpenApiExample(
                        name="Relations created",
                        value=[
                            {
                                "id": "550e8400-e29b-41d4-a716-446655440000",
                                "name": "Fix authentication bug",
                                "sequence_id": 42,
                                "project_id": "550e8400-e29b-41d4-a716-446655440001",
                                "relation_type": "blocked_by",
                                "state_id": "550e8400-e29b-41d4-a716-446655440002",
                                "priority": "high",
                                "created_at": "2024-01-15T10:00:00Z",
                                "updated_at": "2024-01-15T10:00:00Z",
                                "created_by": "550e8400-e29b-41d4-a716-446655440004",
                                "updated_by": "550e8400-e29b-41d4-a716-446655440004",
                            }
                        ],
                    )
                ],
            ),
            400: INVALID_REQUEST_RESPONSE,
            404: ISSUE_NOT_FOUND_RESPONSE,
        },
    )
    def post(self, request, slug, project_id, issue_id):
        """Create relations between the URL's issue and the listed target issues.

        Uses ``get_actual_relation`` to ensure the symmetric inverse
        relation (e.g. ``blocking`` ↔ ``blocked_by``) is also written.
        Dispatches ``issue_activity`` via Celery for each impacted
        issue.
        """
        # Validate request data using serializer
        serializer = IssueRelationCreateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        relation_type = serializer.validated_data["relation_type"]
        issues = serializer.validated_data["issues"]
        project = Project.objects.get(pk=project_id, workspace__slug=slug)

        actual_relation = get_actual_relation(relation_type)
        is_reverse = relation_type in ["blocking", "start_after", "finish_after"]

        IssueRelation.objects.bulk_create(
            [
                IssueRelation(
                    issue_id=(issue if is_reverse else issue_id),
                    related_issue_id=(issue_id if is_reverse else issue),
                    relation_type=actual_relation,
                    project_id=project_id,
                    workspace_id=project.workspace_id,
                    created_by=request.user,
                    updated_by=request.user,
                )
                for issue in issues
            ],
            batch_size=10,
            ignore_conflicts=True,
        )

        issue_activity.delay(
            type="issue_relation.activity.created",
            requested_data=json.dumps(request.data, cls=DjangoJSONEncoder),
            actor_id=str(request.user.id),
            issue_id=str(issue_id),
            project_id=str(project_id),
            current_instance=None,
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )

        # Re-fetch with select_related to avoid N+1 queries in serializers.
        # bulk_create with ignore_conflicts=True may not return PKs,
        # so query by the issue/related_issue pairs and relation type.
        if is_reverse:
            refetch_filter = Q(
                issue_id__in=issues,
                related_issue_id=issue_id,
                relation_type=actual_relation,
            )
        else:
            refetch_filter = Q(
                issue_id=issue_id,
                related_issue_id__in=issues,
                relation_type=actual_relation,
            )

        refetched_relations = IssueRelation.objects.filter(
            refetch_filter,
            workspace__slug=slug,
        ).select_related(
            "issue__state",
            "related_issue__state",
        )

        serializer_class = RelatedIssueSerializer if is_reverse else IssueRelationSerializer
        return Response(
            serializer_class(refetched_relations, many=True).data,
            status=status.HTTP_201_CREATED,
        )
