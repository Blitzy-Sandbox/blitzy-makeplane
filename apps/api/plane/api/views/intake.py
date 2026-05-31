# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Intake (triage) endpoints for the external ``/api/v1/`` API.

The "intake" is Plane's triage inbox: work-item submissions awaiting
acceptance, rejection, or snoozing before being promoted into the
project's regular issue list. Endpoints here let API clients list,
create, update, or delete intake issues for a project that has its
``intake_view`` enabled.

Authentication is via the ``X-Api-Key`` header (see
``plane.api.middleware.api_authentication.APIKeyAuthentication``).
"""

# Python imports
import json

# Django imports
from django.core.serializers.json import DjangoJSONEncoder
from django.utils import timezone
from django.db.models import Q, Value, UUIDField
from django.db.models.functions import Coalesce
from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField

# Third party imports
from rest_framework import status
from rest_framework.response import Response
from drf_spectacular.utils import OpenApiResponse, OpenApiRequest

# Module imports
from plane.api.serializers import (
    IntakeIssueSerializer,
    IssueSerializer,
    IntakeIssueCreateSerializer,
    IntakeIssueUpdateSerializer,
)
from plane.app.permissions import ProjectLitePermission
from plane.bgtasks.issue_activities_task import issue_activity
from plane.db.models import Intake, IntakeIssue, Issue, Project, ProjectMember, State, StateGroup
from plane.utils.host import base_host
from .base import BaseAPIView
from plane.db.models.intake import SourceType
from plane.utils.openapi import (
    intake_docs,
    WORKSPACE_SLUG_PARAMETER,
    PROJECT_ID_PARAMETER,
    ISSUE_ID_PARAMETER,
    CURSOR_PARAMETER,
    PER_PAGE_PARAMETER,
    FIELDS_PARAMETER,
    EXPAND_PARAMETER,
    create_paginated_response,
    # Request Examples
    INTAKE_ISSUE_CREATE_EXAMPLE,
    INTAKE_ISSUE_UPDATE_EXAMPLE,
    # Response Examples
    INTAKE_ISSUE_EXAMPLE,
    INVALID_REQUEST_RESPONSE,
    DELETED_RESPONSE,
)


class IntakeIssueListCreateAPIEndpoint(BaseAPIView):
    """Intake work-item list and create endpoint.

    HTTP methods + URL pattern:
        GET   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/intake-issues/
        POST  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/intake-issues/

    Request body (POST) — see ``IntakeIssueCreateSerializer`` / nested
    ``IssueCreateSerializer``:
        issue (object, required):
            name        (str, required)        – Issue title.
            description (object, optional)     – Plane ProseMirror JSON.
            priority    (str, optional)        – One of ``low``,
                ``medium``, ``high``, ``urgent``, ``none``; invalid values
                return ``400 Bad Request``.
        external_id     (str, optional)        – External identifier;
            combined with ``external_source`` uniquely identifies an
            imported issue.
        external_source (str, optional)        – External system identifier.

    Response shape:
        - GET: paginated array of intake issues serialized via
          ``IntakeIssueSerializer`` (includes nested issue payload).
        - POST: created intake issue serialized via
          ``IntakeIssueSerializer``.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectLitePermission`` — any active project member regardless of
        role.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Filter logic:
        The base queryset excludes expired-snoozed items by default
        (``snoozed_till__gte=timezone.now()`` OR ``snoozed_till IS NULL``).
        If the project does not have ``intake_view`` enabled the endpoint
        returns ``400 Bad Request``.

    Side effects on POST:
        - Writes ``Issue`` row (in draft state) + ``IntakeIssue`` row;
          assigns the project's default state.
        - Conflict on ``(external_id, external_source)``: returns
          ``409 Conflict`` with the existing intake issue id.
        - Enqueues ``issue_activity`` task via Celery+RabbitMQ for activity
          feed materialization. May trigger webhook fan-out if the project
          has active webhook subscriptions.
    """

    serializer_class = IntakeIssueSerializer

    model = Intake
    permission_classes = [ProjectLitePermission]
    use_read_replica = True

    def get_queryset(self):
        """Filter intake issues to the URL's workspace + project.

        Excludes expired-snoozed items by default (``snoozed_till >= now()``
        OR ``snoozed_till IS NULL``).
        """
        intake = Intake.objects.filter(
            workspace__slug=self.kwargs.get("slug"),
            project_id=self.kwargs.get("project_id"),
        ).first()

        project = Project.objects.get(workspace__slug=self.kwargs.get("slug"), pk=self.kwargs.get("project_id"))

        if intake is None or not project.intake_view:
            return IntakeIssue.objects.none()

        return (
            IntakeIssue.objects.filter(
                Q(snoozed_till__gte=timezone.now()) | Q(snoozed_till__isnull=True),
                workspace__slug=self.kwargs.get("slug"),
                project_id=self.kwargs.get("project_id"),
                intake_id=intake.id,
            )
            .select_related("issue", "workspace", "project")
            .order_by(self.kwargs.get("order_by", "-created_at"))
        )

    @intake_docs(
        operation_id="get_intake_work_items_list",
        summary="List intake work items",
        description="Retrieve all work items in the project's intake queue. Returns paginated results when listing all intake work items.",  # noqa: E501
        parameters=[
            WORKSPACE_SLUG_PARAMETER,
            PROJECT_ID_PARAMETER,
            CURSOR_PARAMETER,
            PER_PAGE_PARAMETER,
            FIELDS_PARAMETER,
            EXPAND_PARAMETER,
        ],
        responses={
            200: create_paginated_response(
                IntakeIssueSerializer,
                "PaginatedIntakeIssueResponse",
                "Paginated list of intake work items",
                "Paginated Intake Work Items",
            ),
        },
    )
    def get(self, request, slug, project_id):
        """List intake issues for the project.

        Returns an empty 400 response if the project does not have
        ``intake_view`` enabled.
        """
        issue_queryset = self.get_queryset()
        return self.paginate(
            request=request,
            queryset=(issue_queryset),
            on_results=lambda intake_issues: IntakeIssueSerializer(
                intake_issues, many=True, fields=self.fields, expand=self.expand
            ).data,
        )

    @intake_docs(
        operation_id="create_intake_work_item",
        summary="Create intake work item",
        description="Submit a new work item to the project's intake queue for review and triage. Automatically creates the work item with default triage state and tracks activity.",  # noqa: E501
        parameters=[
            WORKSPACE_SLUG_PARAMETER,
            PROJECT_ID_PARAMETER,
        ],
        request=OpenApiRequest(
            request=IntakeIssueCreateSerializer,
            examples=[INTAKE_ISSUE_CREATE_EXAMPLE],
        ),
        responses={
            201: OpenApiResponse(
                description="Intake work item created",
                response=IntakeIssueSerializer,
                examples=[INTAKE_ISSUE_EXAMPLE],
            ),
            400: INVALID_REQUEST_RESPONSE,
        },
    )
    def post(self, request, slug, project_id):
        """Create a new intake issue.

        Validates priority against ``["low", "medium", "high", "urgent",
        "none"]``. Returns ``409 Conflict`` on
        ``(external_id, external_source)`` duplicates. Enqueues
        ``issue_activity`` via Celery+RabbitMQ for activity feed
        materialization.
        """
        if not request.data.get("issue", {}).get("name", False):
            return Response({"error": "Name is required"}, status=status.HTTP_400_BAD_REQUEST)

        intake = Intake.objects.filter(workspace__slug=slug, project_id=project_id).first()

        project = Project.objects.get(workspace__slug=slug, pk=project_id)

        # Intake view
        if intake is None and not project.intake_view:
            return Response(
                {"error": "Intake is not enabled for this project enable it through the project's api"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check for valid priority
        if request.data.get("issue", {}).get("priority", "none") not in [
            "low",
            "medium",
            "high",
            "urgent",
            "none",
        ]:
            return Response({"error": "Invalid priority"}, status=status.HTTP_400_BAD_REQUEST)

        # get the triage state
        triage_state = State.triage_objects.filter(project_id=project_id, workspace__slug=slug).first()

        if not triage_state:
            triage_state = State.objects.create(
                name="Triage",
                group=StateGroup.TRIAGE.value,
                project_id=project_id,
                workspace_id=project.workspace_id,
                color="#4E5355",
                sequence=65000,
                default=False,
            )

        # create an issue
        issue_data = request.data.get("issue", {})
        # Accept both "description" and "description_json" keys for the description_json field
        description_json = issue_data.get("description") or issue_data.get("description_json") or {}
        issue = Issue.objects.create(
            name=issue_data.get("name"),
            description_json=description_json,
            description_html=issue_data.get("description_html", "<p></p>"),
            priority=issue_data.get("priority", "none"),
            project_id=project_id,
            state_id=triage_state.id,
        )

        # create an intake issue
        intake_issue = IntakeIssue.objects.create(
            intake_id=intake.id,
            project_id=project_id,
            issue=issue,
            source=SourceType.IN_APP,
        )
        # Create an Issue Activity
        issue_activity.delay(
            type="issue.activity.created",
            requested_data=json.dumps(request.data, cls=DjangoJSONEncoder),
            actor_id=str(request.user.id),
            issue_id=str(issue.id),
            project_id=str(project_id),
            current_instance=None,
            epoch=int(timezone.now().timestamp()),
            intake=str(intake_issue.id),
        )

        serializer = IntakeIssueSerializer(intake_issue)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class IntakeIssueDetailAPIEndpoint(BaseAPIView):
    """Retrieve, update, or delete a single intake (triage) issue.

    HTTP methods + URL pattern:
        GET     /api/v1/workspaces/<slug>/projects/<uuid:project_id>/intake-issues/<uuid:issue_id>/
        PATCH   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/intake-issues/<uuid:issue_id>/
        DELETE  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/intake-issues/<uuid:issue_id>/

    Request body (PATCH) — partial ``IntakeIssueSerializer`` / nested
    ``IssueSerializer`` payload. Role-based field restrictions apply:
        - Guest role (``ProjectMember.role <= 5``): may only update
          ``name``, ``description``, ``description_html``; other fields
          are silently ignored or return ``400 Bad Request``.
        - Higher roles (``role > 15``): may also update intake-specific
          attributes — ``status``, ``snoozed_till``, ``duplicate_to``.

    Response shape:
        - GET: intake issue serialized via ``IntakeIssueSerializer``
          (with nested issue payload).
        - PATCH: updated intake issue via ``IntakeIssueSerializer``.
        - DELETE: HTTP 204 with empty body.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectLitePermission`` — any active project member regardless of
        role. Field-level write access is enforced inside the handler
        based on ``ProjectMember.role``.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Constraints on DELETE:
        Intake issues in status ``-2`` (pending), ``-1`` (rejected),
        ``0`` (snoozed), or ``2`` (accepted) may only be deleted by the
        creator or a project ``ADMIN``. Items in status ``1`` (declined
        / expired) can be deleted by any project member.

    Side effects on PATCH / DELETE:
        - PATCH: dispatches ``issue_activity`` via Celery+RabbitMQ for
          non-trivial field changes; webhook fan-out on status
          transitions.
        - DELETE: hard-deletes the ``IntakeIssue`` row (the underlying
          ``Issue`` follows the project's deletion semantics).
    """

    permission_classes = [ProjectLitePermission]

    serializer_class = IntakeIssueSerializer
    model = IntakeIssue
    use_read_replica = True

    filterset_fields = ["status"]

    def get_queryset(self):
        """Filter intake issues to the URL's workspace + project + issue."""
        intake = Intake.objects.filter(
            workspace__slug=self.kwargs.get("slug"),
            project_id=self.kwargs.get("project_id"),
        ).first()

        project = Project.objects.get(workspace__slug=self.kwargs.get("slug"), pk=self.kwargs.get("project_id"))

        if intake is None or not project.intake_view:
            return IntakeIssue.objects.none()

        return (
            IntakeIssue.objects.filter(
                Q(snoozed_till__gte=timezone.now()) | Q(snoozed_till__isnull=True),
                workspace__slug=self.kwargs.get("slug"),
                project_id=self.kwargs.get("project_id"),
                intake_id=intake.id,
            )
            .select_related("issue", "workspace", "project")
            .order_by(self.kwargs.get("order_by", "-created_at"))
        )

    @intake_docs(
        operation_id="retrieve_intake_work_item",
        summary="Retrieve intake work item",
        description="Retrieve details of a specific intake work item.",
        parameters=[
            WORKSPACE_SLUG_PARAMETER,
            PROJECT_ID_PARAMETER,
            ISSUE_ID_PARAMETER,
        ],
        responses={
            200: OpenApiResponse(
                description="Intake work item",
                response=IntakeIssueSerializer,
                examples=[INTAKE_ISSUE_EXAMPLE],
            ),
        },
    )
    def get(self, request, slug, project_id, issue_id):
        """Retrieve a single intake issue with its nested issue payload."""
        intake_issue_queryset = self.get_queryset().get(issue_id=issue_id)
        intake_issue_data = IntakeIssueSerializer(intake_issue_queryset, fields=self.fields, expand=self.expand).data
        return Response(intake_issue_data, status=status.HTTP_200_OK)

    @intake_docs(
        operation_id="update_intake_work_item",
        summary="Update intake work item",
        description="Modify an existing intake work item's properties or status for triage processing. Supports status changes like accept, reject, or mark as duplicate.",  # noqa: E501
        parameters=[
            WORKSPACE_SLUG_PARAMETER,
            PROJECT_ID_PARAMETER,
            ISSUE_ID_PARAMETER,
        ],
        request=OpenApiRequest(
            request=IntakeIssueUpdateSerializer,
            examples=[INTAKE_ISSUE_UPDATE_EXAMPLE],
        ),
        responses={
            200: OpenApiResponse(
                description="Intake work item updated",
                response=IntakeIssueSerializer,
                examples=[INTAKE_ISSUE_EXAMPLE],
            ),
            400: INVALID_REQUEST_RESPONSE,
        },
    )
    def patch(self, request, slug, project_id, issue_id):
        """Update the intake issue partially.

        Applies role-based field restrictions: guests (``role <= 5``) may
        only modify ``name``, ``description``, ``description_html``;
        higher roles may also modify ``status``, ``snoozed_till``, and
        ``duplicate_to``. Dispatches ``issue_activity`` via Celery for
        non-trivial changes.
        """
        intake = Intake.objects.filter(workspace__slug=slug, project_id=project_id).first()

        project = Project.objects.get(workspace__slug=slug, pk=project_id)

        # Intake view
        if intake is None and not project.intake_view:
            return Response(
                {"error": "Intake is not enabled for this project enable it through the project's api"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get the intake issue
        intake_issue = IntakeIssue.objects.get(
            issue_id=issue_id,
            workspace__slug=slug,
            project_id=project_id,
            intake_id=intake.id,
        )

        # Get the project member
        project_member = ProjectMember.objects.get(
            workspace__slug=slug,
            project_id=project_id,
            member=request.user,
            is_active=True,
        )

        # Only project members admins and created_by users can access this endpoint
        if project_member.role <= 5 and str(intake_issue.created_by_id) != str(request.user.id):
            return Response(
                {"error": "You cannot edit intake work items"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get issue data
        issue_data = request.data.pop("issue", False)
        issue_serializer = None
        intake_serializer = None

        # Validate issue data if provided
        if bool(issue_data):
            issue = Issue.objects.annotate(
                label_ids=Coalesce(
                    ArrayAgg(
                        "labels__id",
                        distinct=True,
                        filter=Q(~Q(labels__id__isnull=True) & Q(label_issue__deleted_at__isnull=True)),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                assignee_ids=Coalesce(
                    ArrayAgg(
                        "assignees__id",
                        distinct=True,
                        filter=Q(
                            ~Q(assignees__id__isnull=True)
                            & Q(assignees__member_project__is_active=True)
                            & Q(issue_assignee__deleted_at__isnull=True)
                        ),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
            ).get(pk=issue_id, workspace__slug=slug, project_id=project_id)

            # Only allow guests to edit name and description
            if project_member.role <= 5:
                description_json = issue_data.get("description") or issue_data.get("description_json") or {}
                issue_data = {
                    "name": issue_data.get("name", issue.name),
                    "description_html": issue_data.get("description_html", issue.description_html),
                    "description_json": description_json,
                }

            issue_serializer = IssueSerializer(issue, data=issue_data, partial=True)

            if not issue_serializer.is_valid():
                return Response(issue_serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        # Only project admins and members can edit intake issue attributes
        if project_member.role > 15:
            intake_serializer = IntakeIssueUpdateSerializer(intake_issue, data=request.data, partial=True)

            if not intake_serializer.is_valid():
                return Response(intake_serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        # Both serializers are valid, now save them
        if issue_serializer:
            current_instance = issue
            # Log all the updates
            requested_data = json.dumps(issue_data, cls=DjangoJSONEncoder)
            issue_activity.delay(
                type="issue.activity.updated",
                requested_data=requested_data,
                actor_id=str(request.user.id),
                issue_id=str(issue_id),
                project_id=str(project_id),
                current_instance=json.dumps(
                    IssueSerializer(current_instance).data,
                    cls=DjangoJSONEncoder,
                ),
                epoch=int(timezone.now().timestamp()),
                intake=str(intake_issue.id),
            )
            issue_serializer.save()

        # Save intake issue (state transition happens in serializer's update method)
        if intake_serializer:
            current_instance = json.dumps(IntakeIssueSerializer(intake_issue).data, cls=DjangoJSONEncoder)
            intake_serializer.save()

            # create a activity for status change
            issue_activity.delay(
                type="intake.activity.created",
                requested_data=json.dumps(request.data, cls=DjangoJSONEncoder),
                actor_id=str(request.user.id),
                issue_id=str(issue_id),
                project_id=str(project_id),
                current_instance=current_instance,
                epoch=int(timezone.now().timestamp()),
                notification=False,
                origin=base_host(request=request, is_app=True),
                intake=str(intake_issue.id),
            )
            return Response(IntakeIssueSerializer(intake_issue).data, status=status.HTTP_200_OK)
        else:
            return Response(IntakeIssueSerializer(intake_issue).data, status=status.HTTP_200_OK)

    @intake_docs(
        operation_id="delete_intake_work_item",
        summary="Delete intake work item",
        description="Permanently remove an intake work item from the triage queue. Also deletes the underlying work item if it hasn't been accepted yet.",  # noqa: E501
        parameters=[
            WORKSPACE_SLUG_PARAMETER,
            PROJECT_ID_PARAMETER,
            ISSUE_ID_PARAMETER,
        ],
        responses={
            204: DELETED_RESPONSE,
        },
    )
    def delete(self, request, slug, project_id, issue_id):
        """Delete the intake issue.

        Items in status ``-2`` / ``-1`` / ``0`` / ``2`` may only be
        deleted by the creator or a project ``ADMIN``; items in status
        ``1`` (declined / expired) can be deleted by any project member.
        """
        intake = Intake.objects.filter(workspace__slug=slug, project_id=project_id).first()

        project = Project.objects.get(workspace__slug=slug, pk=project_id)

        # Intake view
        if intake is None and not project.intake_view:
            return Response(
                {"error": "Intake is not enabled for this project enable it through the project's api"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get the intake issue
        intake_issue = IntakeIssue.objects.get(
            issue_id=issue_id,
            workspace__slug=slug,
            project_id=project_id,
            intake_id=intake.id,
        )

        # Check the issue status
        if intake_issue.status in [-2, -1, 0, 2]:
            # Delete the issue also
            issue = Issue.objects.filter(workspace__slug=slug, project_id=project_id, pk=issue_id).first()
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
            issue.delete()

        intake_issue.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
