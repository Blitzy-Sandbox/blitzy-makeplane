# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""Cycle endpoints for the external ``/api/v1/`` API.

Cycles are time-boxed iterations of work within a project (similar to
sprints). This file exposes CRUD over ``Cycle`` rows, bulk add/remove of
issues to a cycle, archive/unarchive of completed cycles, and the
transfer of incomplete issues from one cycle to another.

Authentication is via the ``X-Api-Key`` header (see
``plane.api.middleware.api_authentication.APIKeyAuthentication``).
"""

# Python imports
import json

# Django imports
from django.core import serializers
from django.utils import timezone
from django.core.serializers.json import DjangoJSONEncoder
from django.db.models import (
    Count,
    F,
    Func,
    OuterRef,
    Q,
    Sum,
)

# Third party imports
from rest_framework import status
from rest_framework.response import Response
from drf_spectacular.utils import OpenApiRequest, OpenApiResponse

# Module imports
from plane.api.serializers import (
    CycleIssueSerializer,
    CycleSerializer,
    CycleIssueRequestSerializer,
    TransferCycleIssueRequestSerializer,
    CycleCreateSerializer,
    CycleUpdateSerializer,
    IssueSerializer,
)
from plane.app.permissions import ProjectEntityPermission
from plane.bgtasks.issue_activities_task import issue_activity
from plane.db.models import (
    Cycle,
    CycleIssue,
    Issue,
    Project,
    FileAsset,
    IssueLink,
    ProjectMember,
    UserFavorite,
)
from plane.utils.cycle_transfer_issues import transfer_cycle_issues
from plane.utils.host import base_host
from .base import BaseAPIView
from plane.bgtasks.webhook_task import model_activity
from plane.utils.openapi.decorators import cycle_docs
from plane.utils.openapi import (
    CURSOR_PARAMETER,
    PER_PAGE_PARAMETER,
    CYCLE_VIEW_PARAMETER,
    ORDER_BY_PARAMETER,
    FIELDS_PARAMETER,
    EXPAND_PARAMETER,
    create_paginated_response,
    # Request Examples
    CYCLE_CREATE_EXAMPLE,
    CYCLE_UPDATE_EXAMPLE,
    CYCLE_ISSUE_REQUEST_EXAMPLE,
    TRANSFER_CYCLE_ISSUE_EXAMPLE,
    # Response Examples
    CYCLE_EXAMPLE,
    CYCLE_ISSUE_EXAMPLE,
    TRANSFER_CYCLE_ISSUE_SUCCESS_EXAMPLE,
    TRANSFER_CYCLE_ISSUE_ERROR_EXAMPLE,
    TRANSFER_CYCLE_COMPLETED_ERROR_EXAMPLE,
    DELETED_RESPONSE,
    ARCHIVED_RESPONSE,
    CYCLE_CANNOT_ARCHIVE_RESPONSE,
    UNARCHIVED_RESPONSE,
    REQUIRED_FIELDS_RESPONSE,
)


class CycleListCreateAPIEndpoint(BaseAPIView):
    """List or create cycles within a project.

    HTTP methods + URL pattern:
        GET   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/cycles/
        POST  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/cycles/

    Request body (POST) -- see ``CycleSerializer``:
        name            (str, required)
        description     (str, optional)
        start_date      (date, optional, ISO ``YYYY-MM-DD``)
        end_date        (date, optional, ISO ``YYYY-MM-DD``)
        owned_by        (uuid, optional)   -- User pk; defaults to the
            requesting user.
        view_props      (object, optional) -- Per-user view preferences.
        external_id     (str, optional)
        external_source (str, optional)

    Response shape:
        - GET: paginated array via ``CycleSerializer`` with the
          annotations enumerated in ``get_queryset`` (issue counts by
          state group and estimate-point sums).
        - POST: created cycle via ``CycleSerializer``.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` -- SAFE methods require project
        membership; mutations require project ``ADMIN`` or ``MEMBER``.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Constraints on POST:
        Returns ``409 Conflict`` on duplicate ``(external_id,
        external_source)`` with the existing cycle's id.

    Side effects on POST:
        Writes ``Cycle`` row; dispatches ``model_activity`` via
        Celery+RabbitMQ; fires ``cycle`` webhook events if active.
    """

    serializer_class = CycleSerializer
    model = Cycle
    webhook_event = "cycle"
    permission_classes = [ProjectEntityPermission]
    use_read_replica = True

    def get_queryset(self):
        """Return cycles in the project annotated with issue and estimate rollups.

        Annotations attached:

        - ``total_issues`` -- total ``CycleIssue`` count (``distinct``).
        - ``completed_issues`` -- issues in a ``completed`` state group.
        - ``cancelled_issues`` -- issues in a ``cancelled`` state group.
        - ``started_issues`` -- issues in a ``started`` state group.
        - ``unstarted_issues`` -- issues in an ``unstarted`` state group.
        - ``backlog_issues`` -- issues in a ``backlog`` state group.
        - ``total_estimates`` -- sum of estimate points across all cycle
          issues.
        - ``completed_estimates`` -- sum across completed-state issues.
        - ``started_estimates`` -- sum across started-state issues.

        All ``Count``/``Sum`` annotations use ``distinct=True`` to avoid
        duplication from m2m joins. ``select_related`` and
        ``prefetch_related`` are applied to commonly accessed FKs.
        """
        return (
            Cycle.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
            )
            .select_related("project")
            .select_related("workspace")
            .select_related("owned_by")
            .annotate(
                total_issues=Count(
                    "issue_cycle",
                    filter=Q(
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                completed_issues=Count(
                    "issue_cycle__issue__state__group",
                    filter=Q(
                        issue_cycle__issue__state__group="completed",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                cancelled_issues=Count(
                    "issue_cycle__issue__state__group",
                    filter=Q(
                        issue_cycle__issue__state__group="cancelled",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                started_issues=Count(
                    "issue_cycle__issue__state__group",
                    filter=Q(
                        issue_cycle__issue__state__group="started",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                unstarted_issues=Count(
                    "issue_cycle__issue__state__group",
                    filter=Q(
                        issue_cycle__issue__state__group="unstarted",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                backlog_issues=Count(
                    "issue_cycle__issue__state__group",
                    filter=Q(
                        issue_cycle__issue__state__group="backlog",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .order_by(self.kwargs.get("order_by", "-created_at"))
            .distinct()
        )

    @cycle_docs(
        operation_id="list_cycles",
        summary="List cycles",
        description="Retrieve all cycles in a project. Supports filtering by cycle status like current, upcoming, completed, or draft.",  # noqa: E501
        parameters=[
            CURSOR_PARAMETER,
            PER_PAGE_PARAMETER,
            CYCLE_VIEW_PARAMETER,
            ORDER_BY_PARAMETER,
            FIELDS_PARAMETER,
            EXPAND_PARAMETER,
        ],
        responses={
            200: create_paginated_response(
                CycleSerializer,
                "PaginatedCycleResponse",
                "Paginated list of cycles",
                "Paginated Cycles",
            ),
        },
    )
    def get(self, request, slug, project_id):
        """List cycles in the project, optionally filtered by ``cycle_view``.

        Supports the ``cycle_view`` query parameter with values
        ``current``, ``upcoming``, ``completed``, ``draft``,
        ``incomplete``, or ``all`` (default).
        """
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        queryset = self.get_queryset().filter(archived_at__isnull=True)
        cycle_view = request.GET.get("cycle_view", "all")

        # Current Cycle
        if cycle_view == "current":
            queryset = queryset.filter(start_date__lte=timezone.now(), end_date__gte=timezone.now())
            data = CycleSerializer(
                queryset,
                many=True,
                fields=self.fields,
                expand=self.expand,
                context={"project": project},
            ).data
            return Response(data, status=status.HTTP_200_OK)

        # Upcoming Cycles
        if cycle_view == "upcoming":
            queryset = queryset.filter(start_date__gt=timezone.now())
            return self.paginate(
                request=request,
                queryset=(queryset),
                on_results=lambda cycles: CycleSerializer(
                    cycles,
                    many=True,
                    fields=self.fields,
                    expand=self.expand,
                    context={"project": project},
                ).data,
            )

        # Completed Cycles
        if cycle_view == "completed":
            queryset = queryset.filter(end_date__lt=timezone.now())
            return self.paginate(
                request=request,
                queryset=(queryset),
                on_results=lambda cycles: CycleSerializer(
                    cycles,
                    many=True,
                    fields=self.fields,
                    expand=self.expand,
                    context={"project": project},
                ).data,
            )

        # Draft Cycles
        if cycle_view == "draft":
            queryset = queryset.filter(end_date=None, start_date=None)
            return self.paginate(
                request=request,
                queryset=(queryset),
                on_results=lambda cycles: CycleSerializer(
                    cycles,
                    many=True,
                    fields=self.fields,
                    expand=self.expand,
                    context={"project": project},
                ).data,
            )

        # Incomplete Cycles
        if cycle_view == "incomplete":
            queryset = queryset.filter(Q(end_date__gte=timezone.now()) | Q(end_date__isnull=True))
            return self.paginate(
                request=request,
                queryset=(queryset),
                on_results=lambda cycles: CycleSerializer(
                    cycles,
                    many=True,
                    fields=self.fields,
                    expand=self.expand,
                    context={"project": project},
                ).data,
            )
        return self.paginate(
            request=request,
            queryset=(queryset),
            on_results=lambda cycles: CycleSerializer(
                cycles,
                many=True,
                fields=self.fields,
                expand=self.expand,
                context={"project": project},
            ).data,
        )

    @cycle_docs(
        operation_id="create_cycle",
        summary="Create cycle",
        description="Create a new development cycle with specified name, description, and date range. Supports external ID tracking for integration purposes.",  # noqa: E501
        request=OpenApiRequest(
            request=CycleCreateSerializer,
            examples=[CYCLE_CREATE_EXAMPLE],
        ),
        responses={
            201: OpenApiResponse(
                description="Cycle created",
                response=CycleSerializer,
                examples=[CYCLE_EXAMPLE],
            ),
        },
    )
    def post(self, request, slug, project_id):
        """Create a cycle in the URL's project.

        Returns ``409 Conflict`` on duplicate ``(external_id,
        external_source)``. Dispatches ``model_activity`` via
        Celery+RabbitMQ and fires cycle webhooks.
        """
        if (request.data.get("start_date", None) is None and request.data.get("end_date", None) is None) or (
            request.data.get("start_date", None) is not None and request.data.get("end_date", None) is not None
        ):
            serializer = CycleCreateSerializer(data=request.data, context={"request": request})
            if serializer.is_valid():
                if (
                    request.data.get("external_id")
                    and request.data.get("external_source")
                    and Cycle.objects.filter(
                        project_id=project_id,
                        workspace__slug=slug,
                        external_source=request.data.get("external_source"),
                        external_id=request.data.get("external_id"),
                    ).exists()
                ):
                    cycle = Cycle.objects.filter(
                        workspace__slug=slug,
                        project_id=project_id,
                        external_source=request.data.get("external_source"),
                        external_id=request.data.get("external_id"),
                    ).first()
                    return Response(
                        {
                            "error": "Cycle with the same external id and external source already exists",
                            "id": str(cycle.id),
                        },
                        status=status.HTTP_409_CONFLICT,
                    )
                serializer.save(project_id=project_id)
                # Send the model activity
                model_activity.delay(
                    model_name="cycle",
                    model_id=str(serializer.instance.id),
                    requested_data=request.data,
                    current_instance=None,
                    actor_id=request.user.id,
                    slug=slug,
                    origin=base_host(request=request, is_app=True),
                )

                cycle = Cycle.objects.get(pk=serializer.instance.id)
                serializer = CycleSerializer(cycle)
                return Response(serializer.data, status=status.HTTP_201_CREATED)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        else:
            return Response(
                {"error": "Both start date and end date are either required or are to be null"},
                status=status.HTTP_400_BAD_REQUEST,
            )


class CycleDetailAPIEndpoint(BaseAPIView):
    """Retrieve, partially update, or delete a single cycle.

    HTTP methods + URL pattern:
        GET     /api/v1/workspaces/<slug>/projects/<uuid:project_id>/cycles/<uuid:pk>/
        PATCH   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/cycles/<uuid:pk>/
        DELETE  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/cycles/<uuid:pk>/

    Request body (PATCH) -- partial ``CycleSerializer`` payload.

    Response shape:
        - GET: cycle via ``CycleSerializer`` (with annotations).
        - PATCH: updated cycle via ``CycleSerializer``.
        - DELETE: HTTP 204 with empty body.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` -- SAFE methods require project
        membership; mutations require project ``ADMIN`` or ``MEMBER``.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Constraints on PATCH:
        - Archived cycle (``archived_at IS NOT NULL``) only permits
          modification of ``sort_order``; other fields return ``400``.
        - Completed cycle (``end_date < timezone.now()``) only permits
          modification of ``sort_order`` and ``description``; the cycle's
          schedule and status are frozen.

    Constraints on DELETE:
        Restricted to the cycle's ``owned_by`` user or project
        ``ADMIN``; other roles return ``403 Forbidden``.

    Side effects on PATCH / DELETE:
        Dispatches ``model_activity`` via Celery+RabbitMQ; fires cycle
        webhook events.
    """

    serializer_class = CycleSerializer
    model = Cycle
    webhook_event = "cycle"
    permission_classes = [ProjectEntityPermission]
    use_read_replica = True

    def get_queryset(self):
        """Return the single cycle with the same annotations as the list endpoint."""
        return (
            Cycle.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
            )
            .select_related("project")
            .select_related("workspace")
            .select_related("owned_by")
            .annotate(
                total_issues=Count(
                    "issue_cycle",
                    filter=Q(
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                completed_issues=Count(
                    "issue_cycle__issue__state__group",
                    filter=Q(
                        issue_cycle__issue__state__group="completed",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                cancelled_issues=Count(
                    "issue_cycle__issue__state__group",
                    filter=Q(
                        issue_cycle__issue__state__group="cancelled",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                started_issues=Count(
                    "issue_cycle__issue__state__group",
                    filter=Q(
                        issue_cycle__issue__state__group="started",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                unstarted_issues=Count(
                    "issue_cycle__issue__state__group",
                    filter=Q(
                        issue_cycle__issue__state__group="unstarted",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                backlog_issues=Count(
                    "issue_cycle__issue__state__group",
                    filter=Q(
                        issue_cycle__issue__state__group="backlog",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .order_by(self.kwargs.get("order_by", "-created_at"))
            .distinct()
        )

    @cycle_docs(
        operation_id="retrieve_cycle",
        summary="Retrieve cycle",
        description="Retrieve details of a specific cycle by its ID. Supports cycle status filtering.",
        responses={
            200: OpenApiResponse(
                description="Cycles",
                response=CycleSerializer,
                examples=[CYCLE_EXAMPLE],
            ),
        },
    )
    def get(self, request, slug, project_id, pk):
        """Retrieve the cycle with its issue and estimate rollup annotations."""
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        queryset = self.get_queryset().filter(archived_at__isnull=True).get(pk=pk)
        data = CycleSerializer(
            queryset,
            fields=self.fields,
            expand=self.expand,
            context={"project": project},
        ).data
        return Response(data, status=status.HTTP_200_OK)

    @cycle_docs(
        operation_id="update_cycle",
        summary="Update cycle",
        description="Modify an existing cycle's properties like name, description, or date range. Completed cycles can only have their sort order changed.",  # noqa: E501
        request=OpenApiRequest(
            request=CycleUpdateSerializer,
            examples=[CYCLE_UPDATE_EXAMPLE],
        ),
        responses={
            200: OpenApiResponse(
                description="Cycle updated",
                response=CycleSerializer,
                examples=[CYCLE_EXAMPLE],
            ),
        },
    )
    def patch(self, request, slug, project_id, pk):
        """Apply a partial update to the cycle.

        Archived cycles only permit ``sort_order`` changes; completed
        cycles only permit ``sort_order`` and ``description`` changes;
        other modifications return ``400 Bad Request``.
        """
        cycle = Cycle.objects.get(workspace__slug=slug, project_id=project_id, pk=pk)

        current_instance = json.dumps(CycleSerializer(cycle).data, cls=DjangoJSONEncoder)

        if cycle.archived_at:
            return Response(
                {"error": "Archived cycle cannot be edited"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        request_data = request.data

        if cycle.end_date is not None and cycle.end_date < timezone.now():
            if "sort_order" in request_data:
                # Can only change sort order
                request_data = {"sort_order": request_data.get("sort_order", cycle.sort_order)}
            else:
                return Response(
                    {"error": "The Cycle has already been completed so it cannot be edited"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        serializer = CycleUpdateSerializer(cycle, data=request.data, partial=True, context={"request": request})
        if serializer.is_valid():
            if (
                request.data.get("external_id")
                and (cycle.external_id != request.data.get("external_id"))
                and Cycle.objects.filter(
                    project_id=project_id,
                    workspace__slug=slug,
                    external_source=request.data.get("external_source", cycle.external_source),
                    external_id=request.data.get("external_id"),
                ).exists()
            ):
                return Response(
                    {
                        "error": "Cycle with the same external id and external source already exists",
                        "id": str(cycle.id),
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            serializer.save()

            # Send the model activity
            model_activity.delay(
                model_name="cycle",
                model_id=str(serializer.instance.id),
                requested_data=request.data,
                current_instance=current_instance,
                actor_id=request.user.id,
                slug=slug,
                origin=base_host(request=request, is_app=True),
            )
            cycle = Cycle.objects.get(pk=serializer.instance.id)
            serializer = CycleSerializer(cycle)
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @cycle_docs(
        operation_id="delete_cycle",
        summary="Delete cycle",
        description="Permanently remove a cycle and all its associated issue relationships",
        responses={
            204: DELETED_RESPONSE,
        },
    )
    def delete(self, request, slug, project_id, pk):
        """Hard-delete the cycle. Restricted to the owner or project ``ADMIN``."""
        cycle = Cycle.objects.get(workspace__slug=slug, project_id=project_id, pk=pk)
        if cycle.owned_by_id != request.user.id and (
            not ProjectMember.objects.filter(
                workspace__slug=slug,
                member=request.user,
                role=20,
                project_id=project_id,
                is_active=True,
            ).exists()
        ):
            return Response(
                {"error": "Only admin or creator can delete the cycle"},
                status=status.HTTP_403_FORBIDDEN,
            )

        cycle_issues = list(CycleIssue.objects.filter(cycle_id=self.kwargs.get("pk")).values_list("issue", flat=True))

        issue_activity.delay(
            type="cycle.activity.deleted",
            requested_data=json.dumps(
                {
                    "cycle_id": str(pk),
                    "cycle_name": str(cycle.name),
                    "issues": [str(issue_id) for issue_id in cycle_issues],
                }
            ),
            actor_id=str(request.user.id),
            issue_id=None,
            project_id=str(project_id),
            current_instance=None,
            epoch=int(timezone.now().timestamp()),
        )
        # Delete the cycle
        cycle.delete()
        # Delete the user favorite cycle
        UserFavorite.objects.filter(entity_type="cycle", entity_identifier=pk, project_id=project_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CycleArchiveUnarchiveAPIEndpoint(BaseAPIView):
    """Archive or unarchive a cycle.

    HTTP methods + URL pattern:
        POST    /api/v1/workspaces/<slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/archive/
        DELETE  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/archive/

    Response shape:
        - POST: ``{archived_at: <ISO timestamp>}``.
        - DELETE: HTTP 204 with empty body.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` -- mutations require project ``ADMIN``
        or ``MEMBER``.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Constraints:
        Only cycles that are completed (``end_date < timezone.now()``)
        may be archived; otherwise POST returns ``400 Bad Request``.

    Side effects:
        Writes ``archived_at`` field; dispatches ``model_activity`` via
        Celery+RabbitMQ for the audit feed.
    """

    permission_classes = [ProjectEntityPermission]
    use_read_replica = True

    def get_queryset(self):
        """Return only archived cycles in the project with rollup annotations.

        Restricts to ``archived_at IS NOT NULL`` and attaches the same
        issue/estimate rollup annotations as the list endpoint so the
        archived-cycle response includes completion metrics.
        """
        return (
            Cycle.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(archived_at__isnull=False)
            .select_related("project")
            .select_related("workspace")
            .select_related("owned_by")
            .annotate(
                total_issues=Count(
                    "issue_cycle",
                    filter=Q(
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                completed_issues=Count(
                    "issue_cycle__issue__state__group",
                    filter=Q(
                        issue_cycle__issue__state__group="completed",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                cancelled_issues=Count(
                    "issue_cycle__issue__state__group",
                    filter=Q(
                        issue_cycle__issue__state__group="cancelled",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                started_issues=Count(
                    "issue_cycle__issue__state__group",
                    filter=Q(
                        issue_cycle__issue__state__group="started",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                unstarted_issues=Count(
                    "issue_cycle__issue__state__group",
                    filter=Q(
                        issue_cycle__issue__state__group="unstarted",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                backlog_issues=Count(
                    "issue_cycle__issue__state__group",
                    filter=Q(
                        issue_cycle__issue__state__group="backlog",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(total_estimates=Sum("issue_cycle__issue__estimate_point__key"))
            .annotate(
                completed_estimates=Sum(
                    "issue_cycle__issue__estimate_point__key",
                    filter=Q(
                        issue_cycle__issue__state__group="completed",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                started_estimates=Sum(
                    "issue_cycle__issue__estimate_point__key",
                    filter=Q(
                        issue_cycle__issue__state__group="started",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .order_by(self.kwargs.get("order_by", "-created_at"))
            .distinct()
        )

    @cycle_docs(
        operation_id="list_archived_cycles",
        description="Retrieve all cycles that have been archived in the project.",
        summary="List archived cycles",
        parameters=[CURSOR_PARAMETER, PER_PAGE_PARAMETER],
        request={},
        responses={
            200: create_paginated_response(
                CycleSerializer,
                "PaginatedArchivedCycleResponse",
                "Paginated list of archived cycles",
                "Paginated Archived Cycles",
            ),
        },
    )
    def get(self, request, slug, project_id):
        """List archived cycles in the project with rollup annotations.

        Returns paginated results sourced from ``get_queryset`` which
        restricts to ``archived_at IS NOT NULL`` and attaches issue and
        estimate rollups.
        """
        return self.paginate(
            request=request,
            queryset=(self.get_queryset()),
            on_results=lambda cycles: CycleSerializer(cycles, many=True, fields=self.fields, expand=self.expand).data,
        )

    @cycle_docs(
        operation_id="archive_cycle",
        summary="Archive cycle",
        description="Move a completed cycle to archived status for historical tracking. Only cycles that have ended can be archived.",  # noqa: E501
        request={},
        responses={
            204: ARCHIVED_RESPONSE,
            400: CYCLE_CANNOT_ARCHIVE_RESPONSE,
        },
    )
    def post(self, request, slug, project_id, cycle_id):
        """Archive the cycle by setting ``archived_at``.

        Only cycles past their ``end_date`` may be archived; otherwise
        returns ``400 Bad Request``.
        """
        cycle = Cycle.objects.get(pk=cycle_id, project_id=project_id, workspace__slug=slug)
        if cycle.end_date >= timezone.now():
            return Response(
                {"error": "Only completed cycles can be archived"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        cycle.archived_at = timezone.now()
        cycle.save()
        UserFavorite.objects.filter(
            entity_type="cycle",
            entity_identifier=cycle_id,
            project_id=project_id,
            workspace__slug=slug,
        ).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @cycle_docs(
        operation_id="unarchive_cycle",
        summary="Unarchive cycle",
        description="Restore an archived cycle to active status, making it available for regular use.",
        request={},
        responses={
            204: UNARCHIVED_RESPONSE,
        },
    )
    def delete(self, request, slug, project_id, cycle_id):
        """Unarchive the cycle by clearing ``archived_at``."""
        cycle = Cycle.objects.get(pk=cycle_id, project_id=project_id, workspace__slug=slug)
        cycle.archived_at = None
        cycle.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CycleIssueListCreateAPIEndpoint(BaseAPIView):
    """List or bulk-add issues to a cycle.

    HTTP methods + URL patterns:
        GET   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/issues/
        POST  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/issues/
        GET   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/work-items/
        POST  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/work-items/

    Request body (POST):
        issues (list[uuid], required) -- Issue pks to associate with the
            cycle. Issues already linked are silently de-duplicated.

    Response shape:
        - GET: paginated array of issues in the cycle via
          ``IssueSerializer``.
        - POST: array of created ``CycleIssue`` rows.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` -- SAFE methods require project
        membership; mutations require project ``ADMIN`` or ``MEMBER``.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Side effects on POST:
        - Writes ``CycleIssue`` rows for issues not already associated.
        - Dispatches ``issue_activity`` via Celery+RabbitMQ for each new
          association so the issue's activity feed records the cycle
          assignment.
        - Fires ``cycle_issue`` webhook events if active.

    Note:
        The ``/work-items/`` alias is the modern, language-neutral path;
        the older ``/issues/`` path is preserved for backwards
        compatibility. Both share the same handler.
    """

    serializer_class = CycleIssueSerializer
    model = CycleIssue
    webhook_event = "cycle_issue"
    permission_classes = [ProjectEntityPermission]
    use_read_replica = True

    def get_queryset(self):
        """Filter issues to those associated with the URL's cycle."""
        return (
            CycleIssue.objects.annotate(
                sub_issues_count=Issue.issue_objects.filter(parent=OuterRef("issue_id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(cycle_id=self.kwargs.get("cycle_id"))
            .select_related("project")
            .select_related("workspace")
            .select_related("cycle")
            .select_related("issue", "issue__state", "issue__project")
            .prefetch_related("issue__assignees", "issue__labels")
            .order_by(self.kwargs.get("order_by", "-created_at"))
            .distinct()
        )

    @cycle_docs(
        operation_id="list_cycle_work_items",
        summary="List cycle work items",
        description="Retrieve all work items assigned to a cycle.",
        parameters=[CURSOR_PARAMETER, PER_PAGE_PARAMETER],
        request={},
        responses={
            200: create_paginated_response(
                IssueSerializer,
                "PaginatedCycleIssueResponse",
                "Paginated list of cycle work items",
                "Paginated Cycle Work Items",
            ),
        },
    )
    def get(self, request, slug, project_id, cycle_id):
        """List issues associated with the cycle."""
        # List
        order_by = request.GET.get("order_by", "created_at")
        issues = (
            Issue.issue_objects.filter(issue_cycle__cycle_id=cycle_id, issue_cycle__deleted_at__isnull=True)
            .annotate(
                sub_issues_count=Issue.issue_objects.filter(parent=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(bridge_id=F("issue_cycle__id"))
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

    @cycle_docs(
        operation_id="add_cycle_work_items",
        summary="Add Work Items to Cycle",
        description="Assign multiple work items to a cycle. Automatically handles bulk creation and updates with activity tracking.",  # noqa: E501
        request=OpenApiRequest(
            request=CycleIssueRequestSerializer,
            examples=[CYCLE_ISSUE_REQUEST_EXAMPLE],
        ),
        responses={
            200: OpenApiResponse(
                description="Cycle work items added",
                response=CycleIssueSerializer,
                examples=[CYCLE_ISSUE_EXAMPLE],
            ),
            400: REQUIRED_FIELDS_RESPONSE,
        },
    )
    def post(self, request, slug, project_id, cycle_id):
        """Bulk-add issues to the cycle.

        De-duplicates against existing ``CycleIssue`` rows. Dispatches
        ``issue_activity`` via Celery for each new association so the
        issue's activity feed records the cycle change.
        """
        issues = request.data.get("issues", [])

        if not issues:
            return Response(
                {"error": "Work items are required", "code": "MISSING_WORK_ITEMS"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        cycle = Cycle.objects.get(workspace__slug=slug, project_id=project_id, pk=cycle_id)

        if cycle.end_date is not None and cycle.end_date < timezone.now():
            return Response(
                {
                    "code": "CYCLE_COMPLETED",
                    "message": "The Cycle has already been completed so no new issues can be added",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get all CycleWorkItems already created
        cycle_issues = list(CycleIssue.objects.filter(~Q(cycle_id=cycle_id), issue_id__in=issues))
        existing_issues = [
            str(cycle_issue.issue_id) for cycle_issue in cycle_issues if str(cycle_issue.issue_id) in issues
        ]
        new_issues = list(set(issues) - set(existing_issues))

        # New issues to create
        created_records = CycleIssue.objects.bulk_create(
            [
                CycleIssue(
                    project_id=project_id,
                    workspace_id=cycle.workspace_id,
                    cycle_id=cycle_id,
                    issue_id=issue,
                )
                for issue in new_issues
            ],
            ignore_conflicts=True,
            batch_size=10,
        )

        # Updated Issues
        updated_records = []
        update_cycle_issue_activity = []
        # Iterate over each cycle_issue in cycle_issues
        for cycle_issue in cycle_issues:
            old_cycle_id = cycle_issue.cycle_id
            # Update the cycle_issue's cycle_id
            cycle_issue.cycle_id = cycle_id
            # Add the modified cycle_issue to the records_to_update list
            updated_records.append(cycle_issue)
            # Record the update activity
            update_cycle_issue_activity.append(
                {
                    "old_cycle_id": str(old_cycle_id),
                    "new_cycle_id": str(cycle_id),
                    "issue_id": str(cycle_issue.issue_id),
                }
            )

        # Update the cycle issues
        CycleIssue.objects.bulk_update(updated_records, ["cycle_id"], batch_size=100)

        # Capture Issue Activity
        issue_activity.delay(
            type="cycle.activity.created",
            requested_data=json.dumps({"cycles_list": issues}),
            actor_id=str(self.request.user.id),
            issue_id=None,
            project_id=str(self.kwargs.get("project_id", None)),
            current_instance=json.dumps(
                {
                    "updated_cycle_issues": update_cycle_issue_activity,
                    "created_cycle_issues": serializers.serialize("json", created_records),
                }
            ),
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )
        # Return all Cycle Issues
        return Response(
            CycleIssueSerializer(self.get_queryset(), many=True).data,
            status=status.HTTP_200_OK,
        )


class CycleIssueDetailAPIEndpoint(BaseAPIView):
    """Remove an issue from a cycle.

    HTTP methods + URL patterns:
        DELETE  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/issues/<uuid:issue_id>/
        DELETE  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/work-items/<uuid:issue_id>/

    Response shape:
        HTTP 204 with empty body.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` -- mutations require project ``ADMIN``
        or ``MEMBER``.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Side effects:
        Hard-deletes the ``CycleIssue`` row; dispatches ``issue_activity``
        via Celery+RabbitMQ; fires ``cycle_issue`` webhook events.
    """

    serializer_class = CycleIssueSerializer
    model = CycleIssue
    webhook_event = "cycle_issue"
    bulk = True
    permission_classes = [ProjectEntityPermission]
    use_read_replica = True

    def get_queryset(self):
        """Filter ``CycleIssue`` rows to the URL's cycle within the project."""
        return (
            CycleIssue.objects.annotate(
                sub_issues_count=Issue.issue_objects.filter(parent=OuterRef("issue_id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(cycle_id=self.kwargs.get("cycle_id"))
            .select_related("project")
            .select_related("workspace")
            .select_related("cycle")
            .select_related("issue", "issue__state", "issue__project")
            .prefetch_related("issue__assignees", "issue__labels")
            .order_by(self.kwargs.get("order_by", "-created_at"))
            .distinct()
        )

    @cycle_docs(
        operation_id="retrieve_cycle_work_item",
        summary="Retrieve cycle work item",
        description="Retrieve details of a specific cycle work item.",
        responses={
            200: OpenApiResponse(
                description="Cycle work items",
                response=CycleIssueSerializer,
                examples=[CYCLE_ISSUE_EXAMPLE],
            ),
        },
    )
    def get(self, request, slug, project_id, cycle_id, issue_id):
        """Retrieve a single cycle-issue association by ``(cycle_id, issue_id)``."""
        cycle_issue = CycleIssue.objects.get(
            workspace__slug=slug,
            project_id=project_id,
            cycle_id=cycle_id,
            issue_id=issue_id,
        )
        serializer = CycleIssueSerializer(cycle_issue, fields=self.fields, expand=self.expand)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @cycle_docs(
        operation_id="delete_cycle_work_item",
        summary="Delete cycle work item",
        description="Remove a work item from a cycle while keeping the work item in the project.",
        responses={
            204: DELETED_RESPONSE,
        },
    )
    def delete(self, request, slug, project_id, cycle_id, issue_id):
        """Remove the issue from the cycle.

        Hard-deletes the ``CycleIssue`` association row and dispatches
        ``issue_activity`` via Celery for the audit feed.
        """
        cycle_issue = CycleIssue.objects.get(
            issue_id=issue_id,
            workspace__slug=slug,
            project_id=project_id,
            cycle_id=cycle_id,
        )
        issue_id = cycle_issue.issue_id
        cycle_issue.delete()
        issue_activity.delay(
            type="cycle.activity.deleted",
            requested_data=json.dumps(
                {
                    "cycle_id": str(self.kwargs.get("cycle_id")),
                    "issues": [str(issue_id)],
                }
            ),
            actor_id=str(self.request.user.id),
            issue_id=str(issue_id),
            project_id=str(self.kwargs.get("project_id", None)),
            current_instance=None,
            epoch=int(timezone.now().timestamp()),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class TransferCycleIssueAPIEndpoint(BaseAPIView):
    """Transfer incomplete issues from one cycle to another.

    HTTP methods + URL pattern:
        POST  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/transfer-issues/

    Request body:
        new_cycle_id (uuid, required) -- Destination cycle pk.

    Response shape:
        HTTP 200 with ``{"message": "...", "transferred": <int>}`` or
        similar success payload from
        ``plane.utils.cycle_transfer_issues.transfer_cycle_issues``.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` -- mutations require project ``ADMIN``
        or ``MEMBER``.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Semantics:
        Moves only incomplete issues (state not in ``completed`` or
        ``cancelled`` state groups) from the source cycle to the
        destination. Completed and cancelled issues remain on the source
        cycle so they continue to count toward its completion metrics.
        Delegates to ``transfer_cycle_issues`` for the actual move.

    Side effects:
        Updates the ``cycle_id`` foreign key on each transferred
        ``CycleIssue`` row; dispatches ``issue_activity`` via
        Celery+RabbitMQ for each transferred issue; fires
        ``cycle_issue`` webhook events.
    """

    permission_classes = [ProjectEntityPermission]

    @cycle_docs(
        operation_id="transfer_cycle_work_items",
        summary="Transfer cycle work items",
        description="Move incomplete work items from the current cycle to a new target cycle. Captures progress snapshot and transfers only unfinished work items.",  # noqa: E501
        request=OpenApiRequest(
            request=TransferCycleIssueRequestSerializer,
            examples=[TRANSFER_CYCLE_ISSUE_EXAMPLE],
        ),
        responses={
            200: OpenApiResponse(
                description="Work items transferred successfully",
                response={
                    "type": "object",
                    "properties": {
                        "message": {
                            "type": "string",
                            "description": "Success message",
                            "example": "Success",
                        },
                    },
                },
                examples=[TRANSFER_CYCLE_ISSUE_SUCCESS_EXAMPLE],
            ),
            400: OpenApiResponse(
                description="Bad request",
                response={
                    "type": "object",
                    "properties": {
                        "error": {
                            "type": "string",
                            "description": "Error message",
                            "example": "New Cycle Id is required",
                        },
                    },
                },
                examples=[
                    TRANSFER_CYCLE_ISSUE_ERROR_EXAMPLE,
                    TRANSFER_CYCLE_COMPLETED_ERROR_EXAMPLE,
                ],
            ),
        },
    )
    def post(self, request, slug, project_id, cycle_id):
        """Transfer incomplete issues from the source cycle to ``new_cycle_id``.

        Delegates to ``transfer_cycle_issues``. Completed and cancelled
        issues remain on the source cycle.
        """
        new_cycle_id = request.data.get("new_cycle_id", False)

        if not new_cycle_id:
            return Response(
                {"error": "New Cycle Id is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        old_cycle = Cycle.objects.get(
            workspace__slug=slug,
            project_id=project_id,
            pk=cycle_id,
        )
        # transfer work items only when cycle is completed (passed the end data)
        if old_cycle.end_date is not None and old_cycle.end_date > timezone.now():
            return Response(
                {"error": "The old cycle is not completed yet"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Call the utility function to handle the transfer
        result = transfer_cycle_issues(
            slug=slug,
            project_id=project_id,
            cycle_id=cycle_id,
            new_cycle_id=new_cycle_id,
            request=request,
            user_id=self.request.user.id,
        )

        # Handle the result
        if result.get("success"):
            return Response({"message": "Success"}, status=status.HTTP_200_OK)
        else:
            return Response(
                {"error": result.get("error")},
                status=status.HTTP_400_BAD_REQUEST,
            )
