# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workflow-state endpoints for the external ``/api/v1/`` API surface.

Exposes two endpoints under
``/api/v1/workspaces/<slug>/projects/<project_id>/states/`` for managing
the per-project workflow states used by work items (issues). Authentication
is via the ``X-Api-Key`` header (see
``plane.api.middleware.api_authentication.APIKeyAuthentication``).
"""

# Django imports
from django.db import IntegrityError

# Third party imports
from rest_framework import status
from rest_framework.response import Response
from drf_spectacular.utils import OpenApiResponse, OpenApiRequest

# Module imports
from plane.api.serializers import StateSerializer
from plane.app.permissions import ProjectEntityPermission
from plane.db.models import Issue, State
from .base import BaseAPIView
from plane.utils.openapi import (
    state_docs,
    STATE_ID_PARAMETER,
    CURSOR_PARAMETER,
    PER_PAGE_PARAMETER,
    FIELDS_PARAMETER,
    EXPAND_PARAMETER,
    create_paginated_response,
    # Request Examples
    STATE_CREATE_EXAMPLE,
    STATE_UPDATE_EXAMPLE,
    # Response Examples
    STATE_EXAMPLE,
    INVALID_REQUEST_RESPONSE,
    STATE_NAME_EXISTS_RESPONSE,
    DELETED_RESPONSE,
    STATE_CANNOT_DELETE_RESPONSE,
    EXTERNAL_ID_EXISTS_RESPONSE,
)


class StateListCreateAPIEndpoint(BaseAPIView):
    """List and create workflow states within a project.

    HTTP methods + URL pattern:
        GET    /api/v1/workspaces/<slug>/projects/<uuid:project_id>/states/
        POST   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/states/

    Request body (POST) — see ``StateSerializer``:
        name             (str, required)   – display name; unique per project.
        color            (str, optional)   – hex color (e.g. ``"#26b5ce"``).
        group            (str, optional)   – one of ``backlog | unstarted |
                                              started | completed | cancelled``.
        description      (str, optional)   – plain-text description.
        sequence         (float, optional) – ordering hint within the group.
        external_id      (str, optional)   – integration de-duplication key.
        external_source  (str, optional)   – integration source identifier.

    Response shape — see ``StateSerializer``:
        ``id``, ``name``, ``color``, ``group``, ``description``, ``sequence``,
        ``project``, ``workspace``, ``is_triage``, ``default``,
        ``external_id``, ``external_source``, ``created_at``, ``updated_at``,
        ``created_by``, ``updated_by``. List responses are paginated via
        ``BasePaginator``.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` — workspace member for safe methods,
        project ``ADMIN`` or ``MEMBER`` role for ``POST``.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Side effects on POST:
        Writes a single ``State`` row scoped to the current
        ``(workspace, project)``. No Celery enqueues. On
        ``IntegrityError`` (duplicate name) or matching
        ``external_id``/``external_source`` tuple, responds with HTTP 409
        and the existing row's ``id``.
    """

    serializer_class = StateSerializer
    model = State
    permission_classes = [ProjectEntityPermission]
    use_read_replica = True

    def get_queryset(self):
        """Return non-triage workflow states scoped to the request route.

        Filter chain: workspace ``slug`` and ``project_id`` from URL kwargs,
        plus ``is_triage=False`` to hide the triage state used internally
        for intake, plus the project-member visibility filter
        (``project_projectmember__member=self.request.user`` and
        ``is_active=True``), plus ``project__archived_at__isnull=True`` to
        hide states of archived projects. ``select_related`` joins
        ``project`` and ``workspace``; ``distinct()`` is required because
        the project-member filter joins through a many-to-many relation.
        """
        return (
            State.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(is_triage=False)
            .filter(project__archived_at__isnull=True)
            .select_related("project")
            .select_related("workspace")
            .distinct()
        )

    @state_docs(
        operation_id="create_state",
        summary="Create state",
        description="Create a new workflow state for a project with specified name, color, and group.",
        request=OpenApiRequest(
            request=StateSerializer,
            examples=[STATE_CREATE_EXAMPLE],
        ),
        responses={
            200: OpenApiResponse(
                description="State created",
                response=StateSerializer,
                examples=[STATE_EXAMPLE],
            ),
            400: INVALID_REQUEST_RESPONSE,
            409: STATE_NAME_EXISTS_RESPONSE,
        },
    )
    def post(self, request, slug, project_id):
        """Create state

        Create a new workflow state for a project with specified name, color, and group.
        Supports external ID tracking for integration purposes.
        """
        try:
            serializer = StateSerializer(data=request.data, context={"project_id": project_id})
            if serializer.is_valid():
                if (
                    request.data.get("external_id")
                    and request.data.get("external_source")
                    and State.objects.filter(
                        project_id=project_id,
                        workspace__slug=slug,
                        external_source=request.data.get("external_source"),
                        external_id=request.data.get("external_id"),
                    ).exists()
                ):
                    state = State.objects.filter(
                        workspace__slug=slug,
                        project_id=project_id,
                        external_id=request.data.get("external_id"),
                        external_source=request.data.get("external_source"),
                    ).first()
                    return Response(
                        {
                            "error": "State with the same external id and external source already exists",
                            "id": str(state.id),
                        },
                        status=status.HTTP_409_CONFLICT,
                    )

                serializer.save(project_id=project_id)
                return Response(serializer.data, status=status.HTTP_200_OK)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            state = State.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                name=request.data.get("name"),
            ).first()
            return Response(
                {
                    "error": "State with the same name already exists in the project",
                    "id": str(state.id),
                },
                status=status.HTTP_409_CONFLICT,
            )

    @state_docs(
        operation_id="list_states",
        summary="List states",
        description="Retrieve all workflow states for a project.",
        parameters=[
            CURSOR_PARAMETER,
            PER_PAGE_PARAMETER,
            FIELDS_PARAMETER,
            EXPAND_PARAMETER,
        ],
        responses={
            200: create_paginated_response(
                StateSerializer,
                "PaginatedStateResponse",
                "Paginated list of states",
                "Paginated States",
            ),
        },
    )
    def get(self, request, slug, project_id):
        """List states

        Retrieve all workflow states for a project.
        Returns paginated results when listing all states.
        """
        return self.paginate(
            request=request,
            queryset=(self.get_queryset()),
            on_results=lambda states: StateSerializer(states, many=True, fields=self.fields, expand=self.expand).data,
        )


class StateDetailAPIEndpoint(BaseAPIView):
    """Retrieve, partially update, or delete a single workflow state.

    HTTP methods + URL pattern:
        GET     /api/v1/workspaces/<slug>/projects/<uuid:project_id>/states/<uuid:state_id>/
        PATCH   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/states/<uuid:state_id>/
        DELETE  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/states/<uuid:state_id>/

    Request body (PATCH) — partial ``StateSerializer`` payload:
        Any subset of ``name``, ``color``, ``group``, ``description``,
        ``sequence``, ``external_id``, ``external_source``.

    Response shape — see ``StateSerializer`` (same fields as
    ``StateListCreateAPIEndpoint``).

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` — workspace member for ``GET``, project
        ``ADMIN`` or ``MEMBER`` role for ``PATCH``/``DELETE``.

    Constraints on DELETE:
        - Cannot delete a state with ``default=True`` (returns HTTP 400).
        - Cannot delete a state that has work items assigned (returns HTTP
          400 with ``"only empty states can be deleted"``).

    Constraints on PATCH:
        - If ``external_id`` is changed and the new
          ``(external_source, external_id)`` already exists on another
          state of the same ``(workspace, project)``, responds with
          HTTP 409 and the conflicting state ``id``.

    Side effects:
        No Celery enqueues. State changes do not directly produce activity
        log entries.
    """

    serializer_class = StateSerializer
    model = State
    permission_classes = [ProjectEntityPermission]
    use_read_replica = True

    def get_queryset(self):
        """Return non-triage workflow states scoped to the request route.

        Same filter chain as
        ``StateListCreateAPIEndpoint.get_queryset`` — both classes use the
        identical scoping to ensure consistent visibility across list and
        detail surfaces.
        """
        return (
            State.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(is_triage=False)
            .filter(project__archived_at__isnull=True)
            .select_related("project")
            .select_related("workspace")
            .distinct()
        )

    @state_docs(
        operation_id="retrieve_state",
        summary="Retrieve state",
        description="Retrieve details of a specific state.",
        parameters=[
            STATE_ID_PARAMETER,
        ],
        responses={
            200: OpenApiResponse(
                description="State retrieved",
                response=StateSerializer,
                examples=[STATE_EXAMPLE],
            ),
        },
    )
    def get(self, request, slug, project_id, state_id):
        """Retrieve state

        Retrieve details of a specific state.
        Returns paginated results when listing all states.
        """
        serializer = StateSerializer(
            self.get_queryset().get(pk=state_id),
            fields=self.fields,
            expand=self.expand,
        )
        return Response(serializer.data, status=status.HTTP_200_OK)

    @state_docs(
        operation_id="delete_state",
        summary="Delete state",
        description="Permanently remove a workflow state from a project. Default states and states with existing work items cannot be deleted.",  # noqa: E501
        parameters=[
            STATE_ID_PARAMETER,
        ],
        responses={
            204: DELETED_RESPONSE,
            400: STATE_CANNOT_DELETE_RESPONSE,
        },
    )
    def delete(self, request, slug, project_id, state_id):
        """Delete state

        Permanently remove a workflow state from a project.
        Default states and states with existing work items cannot be deleted.
        """
        state = State.objects.get(is_triage=False, pk=state_id, project_id=project_id, workspace__slug=slug)

        if state.default:
            return Response(
                {"error": "Default state cannot be deleted"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check for any issues in the state
        issue_exist = Issue.objects.filter(state=state_id).exists()

        if issue_exist:
            return Response(
                {"error": "The state is not empty, only empty states can be deleted"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        state.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @state_docs(
        operation_id="update_state",
        summary="Update state",
        description="Partially update an existing workflow state's properties like name, color, or group.",
        parameters=[
            STATE_ID_PARAMETER,
        ],
        request=OpenApiRequest(
            request=StateSerializer,
            examples=[STATE_UPDATE_EXAMPLE],
        ),
        responses={
            200: OpenApiResponse(
                description="State updated",
                response=StateSerializer,
                examples=[STATE_EXAMPLE],
            ),
            400: INVALID_REQUEST_RESPONSE,
            409: EXTERNAL_ID_EXISTS_RESPONSE,
        },
    )
    def patch(self, request, slug, project_id, state_id):
        """Update state

        Partially update an existing workflow state's properties like name, color, or group.
        Validates external ID uniqueness if provided.
        """
        state = State.objects.get(workspace__slug=slug, project_id=project_id, pk=state_id)
        serializer = StateSerializer(state, data=request.data, partial=True)
        if serializer.is_valid():
            if (
                request.data.get("external_id")
                and (state.external_id != str(request.data.get("external_id")))
                and State.objects.filter(
                    project_id=project_id,
                    workspace__slug=slug,
                    external_source=request.data.get("external_source", state.external_source),
                    external_id=request.data.get("external_id"),
                ).exists()
            ):
                return Response(
                    {
                        "error": "State with the same external id and external source already exists",
                        "id": str(state.id),
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
