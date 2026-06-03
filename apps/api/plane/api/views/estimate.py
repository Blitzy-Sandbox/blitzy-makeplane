# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""Estimate and estimate-point endpoints for the external ``/api/v1/`` API.

Plane projects can have at most one active ``Estimate`` (a "scale" such as
T-Shirt sizes, story points, or category labels) and a set of
``EstimatePoint`` rows representing the values on that scale. The endpoints
in this module expose CRUD over both.

Authentication is via the ``X-Api-Key`` header (see
``plane.api.middleware.api_authentication.APIKeyAuthentication``).
"""

# Third party imports
from rest_framework.response import Response
from rest_framework import status
from drf_spectacular.utils import OpenApiRequest, OpenApiResponse

# Module imports
from plane.app.permissions.project import ProjectEntityPermission
from plane.api.views.base import BaseAPIView
from plane.db.models import Estimate, EstimatePoint, Project, Workspace
from plane.api.serializers import EstimateSerializer, EstimatePointSerializer
from plane.utils.openapi.decorators import estimate_docs, estimate_point_docs
from plane.utils.openapi import (
    ESTIMATE_CREATE_EXAMPLE,
    ESTIMATE_UPDATE_EXAMPLE,
    ESTIMATE_POINT_CREATE_EXAMPLE,
    ESTIMATE_POINT_UPDATE_EXAMPLE,
    ESTIMATE_EXAMPLE,
    ESTIMATE_POINT_EXAMPLE,
    DELETED_RESPONSE,
    WORKSPACE_SLUG_PARAMETER,
    PROJECT_ID_PARAMETER,
    ESTIMATE_ID_PARAMETER,
)


class ProjectEstimateAPIEndpoint(BaseAPIView):
    """CRUD over the single ``Estimate`` row for a project.

    HTTP methods + URL pattern:
        GET     /api/v1/workspaces/<slug>/projects/<uuid:project_id>/estimates/
        POST    /api/v1/workspaces/<slug>/projects/<uuid:project_id>/estimates/
        PATCH   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/estimates/
        DELETE  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/estimates/

    Request body (POST / PATCH) -- see ``EstimateSerializer``:
        name        (str, required for POST) -- Display name of the scale.
        description (str, optional)          -- Human description.
        type        (str, required for POST) -- One of the values in
            ``ESTIMATE_SYSTEM`` (e.g. ``categories``, ``points``,
            ``time``). Determines how ``EstimatePoint.value`` is rendered.
        points      (list[object], required for POST)
                                             -- Initial point list; each
            entry shaped like ``{"key": int, "value": str,
            "description": str}``.

    Response shape:
        - GET: array of estimates (currently 0 or 1) serialized via
          ``EstimateReadSerializer``.
        - POST: created estimate serialized via ``EstimateReadSerializer``.
        - PATCH: updated estimate serialized via
          ``EstimateReadSerializer``.
        - DELETE: HTTP 204 with empty body.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` -- SAFE methods require project
        membership; mutations require project ``ADMIN`` or ``MEMBER`` role.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Constraints:
        - POST returns ``409 Conflict`` if the project already has an
          estimate; only one estimate per project is allowed.
        - PATCH only permits updates to the fields enumerated in
          ``ALLOWED_FIELDS`` (``name``, ``description``); other fields are
          rejected with ``400 Bad Request``.
        - DELETE cascade-deletes all ``EstimatePoint`` rows for the
          estimate.

    Side effects on POST/PATCH/DELETE:
        Writes to ``Estimate`` (and ``EstimatePoint`` on POST). No Celery
        enqueues.
    """

    permission_classes = [ProjectEntityPermission]
    model = Estimate
    serializer_class = EstimateSerializer

    def get_queryset(self):
        """Filter estimates to the URL's workspace + project."""
        return self.model.objects.filter(workspace__slug=self.workspace_slug, project_id=self.project_id)

    @estimate_docs(
        operation_id="create_estimate",
        summary="Create an estimate",
        description="Create an estimate for a project",
        request=OpenApiRequest(
            request=EstimateSerializer,
            examples=[ESTIMATE_CREATE_EXAMPLE],
        ),
    )
    def post(self, request, slug, project_id):
        """Create the project's single ``Estimate`` plus its initial points.

        Returns ``409 Conflict`` if the project already has an estimate.
        """
        project = Project.objects.filter(id=project_id, workspace__slug=slug).first()
        if not project:
            return Response(status=status.HTTP_404_NOT_FOUND, data={"error": "Project not found"})

        workspace = Workspace.objects.filter(slug=slug).first()
        if not workspace:
            return Response(status=status.HTTP_404_NOT_FOUND, data={"error": "Workspace not found"})

        project_estimate = self.get_queryset().first()
        if project_estimate:
            # return 409 if the project estimate already exists
            return Response(
                status=status.HTTP_409_CONFLICT,
                data={"error": "An estimate already exists for this project", "id": str(project_estimate.id)},
            )
        # create the project estimate
        serializer = self.serializer_class(data=request.data, context={"workspace": workspace, "project": project})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @estimate_docs(
        operation_id="get_estimate",
        summary="Get an estimate",
        description="Get an estimate for a project",
        responses={
            200: OpenApiResponse(
                description="Estimate",
                response=EstimateSerializer,
                examples=[ESTIMATE_EXAMPLE],
            ),
        },
    )
    def get(self, request, slug, project_id):
        """Return the single estimate for the project, or an empty list."""
        estimate = self.get_queryset().first()
        if not estimate:
            return Response(status=status.HTTP_404_NOT_FOUND, data={"error": "Estimate not found"})
        serializer = self.serializer_class(estimate)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @estimate_docs(
        operation_id="update_estimate",
        summary="Update an estimate",
        description="Update an estimate for a project",
        request=OpenApiRequest(
            request=EstimateSerializer,
            examples=[ESTIMATE_UPDATE_EXAMPLE],
        ),
        responses={
            200: OpenApiResponse(
                description="Estimate",
                response=EstimateSerializer,
                examples=[ESTIMATE_EXAMPLE],
            ),
        },
    )
    def patch(self, request, slug, project_id):
        """Update the project's estimate with a partial payload.

        Only the fields listed in ``ALLOWED_FIELDS`` (``name``,
        ``description``) may be modified; other keys return
        ``400 Bad Request``.
        """
        ALLOWED_FIELDS = ["name", "description"]
        estimate = self.get_queryset().first()
        if not estimate:
            return Response(status=status.HTTP_404_NOT_FOUND, data={"error": "Estimate not found"})
        filtered_data = {k: v for k, v in request.data.items() if k in ALLOWED_FIELDS}
        if not filtered_data:
            serializer = self.serializer_class(estimate)
            return Response(serializer.data, status=status.HTTP_200_OK)
        serializer = self.serializer_class(estimate, data=filtered_data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)

    @estimate_docs(
        operation_id="delete_estimate",
        summary="Delete an estimate",
        description="Delete an estimate for a project",
        responses={
            204: DELETED_RESPONSE,
        },
    )
    def delete(self, request, slug, project_id):
        """Hard-delete the project's estimate and cascade-remove its points."""
        estimate = self.get_queryset().first()
        if not estimate:
            return Response(status=status.HTTP_404_NOT_FOUND, data={"error": "Estimate not found"})
        estimate.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class EstimatePointListCreateAPIEndpoint(BaseAPIView):
    """List and bulk-create estimate points for an estimate.

    HTTP methods + URL pattern:
        GET   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/estimates/<uuid:estimate_id>/estimate-points/
        POST  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/estimates/<uuid:estimate_id>/estimate-points/

    Request body (POST) -- see ``EstimatePointSerializer``:
        key         (int, required)  -- Sort-order key within the scale.
        value       (str, required)  -- Display value (depends on the parent
            estimate's ``type``; e.g. ``"3"`` for points or ``"M"`` for
            T-Shirt sizes).
        description (str, optional)  -- Optional point description.

    Response shape:
        - GET: array of estimate points serialized via
          ``EstimatePointSerializer``.
        - POST: created estimate point serialized via
          ``EstimatePointSerializer``.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` -- SAFE methods require project
        membership; mutations require project ``ADMIN`` or ``MEMBER`` role.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Side effects on POST:
        Writes one or more ``EstimatePoint`` rows scoped to the parent
        estimate. No Celery enqueues.
    """

    permission_classes = [ProjectEntityPermission]
    model = EstimatePoint
    serializer_class = EstimatePointSerializer

    def get_queryset(self):
        """Filter estimate points to the URL's workspace + project + estimate."""
        return self.model.objects.filter(
            estimate_id=self.kwargs["estimate_id"],
            workspace__slug=self.kwargs["slug"],
            project_id=self.kwargs["project_id"],
        ).select_related("estimate", "workspace", "project")

    @estimate_point_docs(
        operation_id="get_estimate_points",
        summary="Get estimate points",
        description="Get estimate points for an estimate",
        parameters=[
            WORKSPACE_SLUG_PARAMETER,
            PROJECT_ID_PARAMETER,
            ESTIMATE_ID_PARAMETER,
        ],
        responses={
            200: OpenApiResponse(
                description="Estimate points",
                response=EstimatePointSerializer(many=True),
                examples=[ESTIMATE_POINT_EXAMPLE],
            ),
        },
    )
    def get(self, request, slug, project_id, estimate_id):
        """List all estimate points belonging to the parent estimate."""
        estimate = Estimate.objects.filter(
            id=estimate_id,
            workspace__slug=slug,
            project_id=project_id,
        ).first()
        if not estimate:
            return Response(status=status.HTTP_404_NOT_FOUND, data={"error": "Estimate not found"})
        estimate_points = self.get_queryset()
        serializer = self.serializer_class(estimate_points, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @estimate_point_docs(
        operation_id="create_estimate_points",
        summary="Create estimate points",
        description="Create estimate points for an estimate",
        request=OpenApiRequest(
            request=EstimatePointSerializer,
            examples=[ESTIMATE_POINT_CREATE_EXAMPLE],
        ),
        responses={
            201: OpenApiResponse(
                description="Estimate points",
                response=EstimatePointSerializer(many=True),
                examples=[ESTIMATE_POINT_EXAMPLE],
            ),
        },
    )
    def post(self, request, slug, project_id, estimate_id):
        """Create a new estimate point on the parent estimate."""
        estimate = Estimate.objects.filter(
            id=estimate_id,
            workspace__slug=slug,
            project_id=project_id,
        ).first()
        if not estimate:
            return Response(status=status.HTTP_404_NOT_FOUND, data={"error": "Estimate not found"})

        estimate_points_data = (
            request.data if isinstance(request.data, list) else request.data.get("estimate_points", [])
        )
        if not estimate_points_data:
            return Response(
                status=status.HTTP_400_BAD_REQUEST,
                data={"error": "Estimate points are required"},
            )

        serializer = self.serializer_class(data=estimate_points_data, many=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        estimate_points = [
            EstimatePoint(
                estimate=estimate,
                workspace=estimate.workspace,
                project=estimate.project,
                **item,
            )
            for item in serializer.validated_data
        ]
        created = EstimatePoint.objects.bulk_create(estimate_points)
        return Response(
            self.serializer_class(created, many=True).data,
            status=status.HTTP_201_CREATED,
        )


class EstimatePointDetailAPIEndpoint(BaseAPIView):
    """Update or delete a single estimate point.

    HTTP methods + URL pattern:
        PATCH   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/estimates/
                <uuid:estimate_id>/estimate-points/<uuid:estimate_point_id>/
        DELETE  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/estimates/
                <uuid:estimate_id>/estimate-points/<uuid:estimate_point_id>/

    Request body (PATCH) -- partial ``EstimatePointSerializer`` payload:
        Only the fields listed in ``ALLOWED_FIELDS`` (``key``, ``value``,
        ``description``) may be modified; other keys return
        ``400 Bad Request``.

    Response shape:
        - PATCH: updated estimate point serialized via
          ``EstimatePointSerializer``.
        - DELETE: HTTP 204 with empty body.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectEntityPermission`` -- SAFE methods require project
        membership; mutations require project ``ADMIN`` or ``MEMBER`` role.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Side effects on PATCH/DELETE:
        Writes to or removes a single ``EstimatePoint`` row. No Celery
        enqueues.
    """

    permission_classes = [ProjectEntityPermission]
    model = EstimatePoint
    serializer_class = EstimatePointSerializer

    def get_queryset(self):
        """Filter estimate points to the URL's workspace + project + estimate."""
        return self.model.objects.filter(
            estimate_id=self.kwargs["estimate_id"],
            workspace__slug=self.kwargs["slug"],
            project_id=self.kwargs["project_id"],
        )

    @estimate_point_docs(
        operation_id="update_estimate_point",
        summary="Update an estimate point",
        description="Update an estimate point for an estimate",
        request=OpenApiRequest(
            request=EstimatePointSerializer,
            examples=[ESTIMATE_POINT_UPDATE_EXAMPLE],
        ),
        responses={
            200: OpenApiResponse(
                description="Estimate point",
                response=EstimatePointSerializer,
                examples=[ESTIMATE_POINT_EXAMPLE],
            ),
        },
    )
    def patch(self, request, slug, project_id, estimate_id, estimate_point_id):
        """Update the estimate point with a partial payload.

        Only ``key``, ``value``, and ``description`` may be modified
        (``ALLOWED_FIELDS``); other keys return ``400 Bad Request``.
        """
        estimate_point = self.get_queryset().filter(id=estimate_point_id).first()
        if not estimate_point:
            return Response(status=status.HTTP_404_NOT_FOUND, data={"error": "Estimate point not found"})
        ALLOWED_FIELDS = ["key", "value", "description"]
        filtered_data = {k: v for k, v in request.data.items() if k in ALLOWED_FIELDS}
        if not filtered_data:
            return Response(self.serializer_class(estimate_point).data, status=status.HTTP_200_OK)
        serializer = self.serializer_class(estimate_point, data=filtered_data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)

    @estimate_point_docs(
        operation_id="delete_estimate_point",
        summary="Delete an estimate point",
        description="Delete an estimate point for an estimate",
        responses={
            204: DELETED_RESPONSE,
        },
    )
    def delete(self, request, slug, project_id, estimate_id, estimate_point_id):
        """Hard-delete the estimate point."""
        estimate_point = self.get_queryset().filter(id=estimate_point_id).first()
        if not estimate_point:
            return Response(status=status.HTTP_404_NOT_FOUND, data={"error": "Estimate point not found"})
        estimate_point.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
