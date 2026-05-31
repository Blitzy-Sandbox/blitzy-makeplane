# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""Workspace- and project-member endpoints for the external ``/api/v1/`` API.

Exposes:
- ``GET /api/v1/workspaces/<slug>/members/`` for workspace members
- ``GET|POST /api/v1/workspaces/<slug>/projects/<project_id>/members/`` and
  ``GET|PATCH|DELETE`` on the detail variant for project members.

Authentication is via the ``X-Api-Key`` header (see
``plane.api.middleware.api_authentication.APIKeyAuthentication``).
"""

# Third Party imports
from rest_framework.response import Response
from rest_framework import status
from drf_spectacular.utils import (
    extend_schema,
    OpenApiResponse,
    OpenApiRequest,
)

# Module imports
from .base import BaseAPIView
from plane.api.serializers import UserLiteSerializer, ProjectMemberSerializer
from plane.db.models import User, Workspace, WorkspaceMember, ProjectMember
from plane.utils.permissions import ProjectMemberPermission, WorkSpaceAdminPermission, ProjectAdminPermission
from plane.utils.openapi import (
    WORKSPACE_SLUG_PARAMETER,
    PROJECT_ID_PARAMETER,
    UNAUTHORIZED_RESPONSE,
    FORBIDDEN_RESPONSE,
    WORKSPACE_NOT_FOUND_RESPONSE,
    PROJECT_NOT_FOUND_RESPONSE,
    WORKSPACE_MEMBER_EXAMPLE,
    PROJECT_MEMBER_EXAMPLE,
)


class WorkspaceMemberAPIEndpoint(BaseAPIView):
    """List members of a workspace (admin-only).

    HTTP methods + URL pattern:
        GET /api/v1/workspaces/<slug>/members/

    Request body:
        None.

    Response shape:
        JSON array of ``UserLite`` objects merged with an integer ``role``
        field. Each item has the fields exposed by ``UserLiteSerializer``
        plus ``role`` from the underlying ``WorkspaceMember`` row.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``WorkSpaceAdminPermission`` — only workspace ``ADMIN`` role.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Side effects:
        Read-only — no DB writes, no Celery enqueues.
    """

    permission_classes = [WorkSpaceAdminPermission]
    use_read_replica = True

    @extend_schema(
        operation_id="get_workspace_members",
        summary="List workspace members",
        description="Retrieve all users who are members of the specified workspace.",
        tags=["Members"],
        parameters=[WORKSPACE_SLUG_PARAMETER],
        responses={
            200: OpenApiResponse(
                description="List of workspace members with their roles",
                response={
                    "type": "array",
                    "items": {
                        "allOf": [
                            {"$ref": "#/components/schemas/UserLite"},
                            {
                                "type": "object",
                                "properties": {
                                    "role": {
                                        "type": "integer",
                                        "description": "Member role in the workspace",
                                    }
                                },
                            },
                        ]
                    },
                },
                examples=[WORKSPACE_MEMBER_EXAMPLE],
            ),
            401: UNAUTHORIZED_RESPONSE,
            403: FORBIDDEN_RESPONSE,
            404: WORKSPACE_NOT_FOUND_RESPONSE,
        },
    )
    # Get all the users that are present inside the workspace
    def get(self, request, slug):
        """List workspace members.

        Retrieve all users who are members of the specified workspace.
        Returns user profiles with their respective workspace roles and permissions.
        """
        # Check if the workspace exists
        if not Workspace.objects.filter(slug=slug).exists():
            return Response(
                {"error": "Provided workspace does not exist"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        workspace_members = WorkspaceMember.objects.filter(workspace__slug=slug).select_related("member")

        # Get all the users with their roles
        users_with_roles = []
        for workspace_member in workspace_members:
            user_data = UserLiteSerializer(workspace_member.member).data
            user_data["role"] = workspace_member.role
            users_with_roles.append(user_data)

        return Response(users_with_roles, status=status.HTTP_200_OK)


class ProjectMemberListCreateAPIEndpoint(BaseAPIView):
    """List members of a project or add a new project member.

    HTTP methods + URL patterns:
        GET   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/members/
        POST  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/members/
        GET   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/project-members/
        POST  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/project-members/

    Request body (POST) — see ``ProjectMemberSerializer``:
        member (uuid, required) – User pk to add to the project.
        role   (int,  optional) – ``ROLE`` enum value; default per
            ``ProjectMemberSerializer``.

    Response shape:
        - GET: JSON array of ``UserLite`` objects (see
          ``UserLiteSerializer``) for users in the project.
        - POST: ``ProjectMember`` serialized via
          ``ProjectMemberSerializer``.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        Dispatched dynamically by ``get_permissions``:
            - GET   → ``ProjectMemberPermission`` (any project member)
            - POST  → ``ProjectAdminPermission`` (project ``ADMIN`` only)
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Side effects on POST:
        Writes a single ``ProjectMember`` row. No Celery enqueues.
    """

    permission_classes = [ProjectMemberPermission]
    use_read_replica = True

    def get_permissions(self):
        """Select permission class per HTTP method.

        ``GET`` uses ``ProjectMemberPermission`` so any active project
        member can read the member roster, while non-safe methods
        (currently ``POST``) require ``ProjectAdminPermission``.
        """
        if self.request.method == "GET":
            return [ProjectMemberPermission()]
        return [ProjectAdminPermission()]

    @extend_schema(
        operation_id="get_project_members",
        summary="List project members",
        description="Retrieve all users who are members of the specified project.",
        tags=["Members"],
        parameters=[WORKSPACE_SLUG_PARAMETER, PROJECT_ID_PARAMETER],
        responses={
            200: OpenApiResponse(
                description="List of project members with their roles",
                response=UserLiteSerializer,
                examples=[PROJECT_MEMBER_EXAMPLE],
            ),
            401: UNAUTHORIZED_RESPONSE,
            403: FORBIDDEN_RESPONSE,
            404: PROJECT_NOT_FOUND_RESPONSE,
        },
    )
    # Get all the users that are present inside the workspace
    def get(self, request, slug, project_id):
        """List project members.

        Retrieve all users who are members of the specified project.
        Returns user profiles with their project-specific roles and access levels.
        """
        # Check if the workspace exists
        if not Workspace.objects.filter(slug=slug).exists():
            return Response(
                {"error": "Provided workspace does not exist"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get the workspace members that are present inside the workspace
        project_members = ProjectMember.objects.filter(project_id=project_id, workspace__slug=slug).values_list(
            "member_id", flat=True
        )

        # Get all the users that are present inside the workspace
        users = UserLiteSerializer(User.objects.filter(id__in=project_members), many=True).data
        return Response(users, status=status.HTTP_200_OK)

    @extend_schema(
        operation_id="create_project_member",
        summary="Create project member",
        description="Create a new project member",
        tags=["Members"],
        parameters=[WORKSPACE_SLUG_PARAMETER, PROJECT_ID_PARAMETER],
        responses={201: OpenApiResponse(description="Project member created", response=ProjectMemberSerializer)},
        request=OpenApiRequest(request=ProjectMemberSerializer),
    )
    def post(self, request, slug, project_id):
        """Create a new project member.

        Writes a single ``ProjectMember`` row scoped to the URL's
        ``(workspace_slug, project_id)``. The serializer resolves the
        target user from the request body's ``member`` field.
        """
        serializer = ProjectMemberSerializer(data=request.data, context={"slug": slug})
        serializer.is_valid(raise_exception=True)
        serializer.save(project_id=project_id)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


# API endpoint to get and update a project member
class ProjectMemberDetailAPIEndpoint(ProjectMemberListCreateAPIEndpoint):
    """Retrieve, update, or deactivate a single project member.

    HTTP methods + URL patterns:
        GET     /api/v1/workspaces/<slug>/projects/<uuid:project_id>/members/<uuid:pk>/
        PATCH   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/members/<uuid:pk>/
        DELETE  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/members/<uuid:pk>/
        GET     /api/v1/workspaces/<slug>/projects/<uuid:project_id>/project-members/<uuid:pk>/
        PATCH   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/project-members/<uuid:pk>/
        DELETE  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/project-members/<uuid:pk>/

    Request body (PATCH) — partial ``ProjectMemberSerializer`` payload:
        Any subset of the writable ``ProjectMember`` fields (typically
        ``role``).

    Response shape:
        - GET: ``UserLiteSerializer`` payload (the underlying user, not the
          ``ProjectMember`` row).
        - PATCH: ``ProjectMemberSerializer`` payload.
        - DELETE: empty body with HTTP 204.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        Inherits ``get_permissions`` from the parent class:
            - GET   → ``ProjectMemberPermission``
            - PATCH → ``ProjectAdminPermission``
            - DELETE → ``ProjectAdminPermission``

    Side effects on DELETE:
        Soft-deactivates the member by setting ``is_active=False`` rather
        than removing the row, preserving historical references. No
        Celery enqueues.
    """

    @extend_schema(
        operation_id="get_project_member",
        summary="Get project member",
        description="Retrieve a project member by ID.",
        tags=["Members"],
        parameters=[WORKSPACE_SLUG_PARAMETER, PROJECT_ID_PARAMETER],
        responses={
            200: OpenApiResponse(description="Project member", response=ProjectMemberSerializer),
            401: UNAUTHORIZED_RESPONSE,
            403: FORBIDDEN_RESPONSE,
            404: PROJECT_NOT_FOUND_RESPONSE,
        },
    )
    # Get a project member by ID
    def get(self, request, slug, project_id, pk):
        """Get project member.

        Retrieve a project member by ID.
        Returns a project member with their project-specific roles and access levels.
        """
        # Check if the workspace exists
        if not Workspace.objects.filter(slug=slug).exists():
            return Response(
                {"error": "Provided workspace does not exist"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get the workspace members that are present inside the workspace
        project_members = ProjectMember.objects.get(project_id=project_id, workspace__slug=slug, pk=pk)
        user = User.objects.get(id=project_members.member_id)
        user = UserLiteSerializer(user).data
        return Response(user, status=status.HTTP_200_OK)

    @extend_schema(
        operation_id="update_project_member",
        summary="Update project member",
        description="Update a project member",
        tags=["Members"],
        parameters=[WORKSPACE_SLUG_PARAMETER, PROJECT_ID_PARAMETER],
        responses={200: OpenApiResponse(description="Project member updated", response=ProjectMemberSerializer)},
        request=OpenApiRequest(request=ProjectMemberSerializer),
    )
    def patch(self, request, slug, project_id, pk):
        """Apply a partial update to a project member's attributes (typically role)."""
        project_member = ProjectMember.objects.get(project_id=project_id, workspace__slug=slug, pk=pk)
        serializer = ProjectMemberSerializer(project_member, data=request.data, partial=True, context={"slug": slug})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        operation_id="delete_project_member",
        summary="Delete project member",
        description="Delete a project member",
        tags=["Members"],
        parameters=[WORKSPACE_SLUG_PARAMETER, PROJECT_ID_PARAMETER],
        responses={204: OpenApiResponse(description="Project member deleted")},
    )
    def delete(self, request, slug, project_id, pk):
        """Soft-deactivate a project member by setting ``is_active=False``.

        The row is preserved for historical references (audit logs, activity
        feeds, prior assignments).
        """
        project_member = ProjectMember.objects.get(project_id=project_id, workspace__slug=slug, pk=pk)
        project_member.is_active = False
        project_member.save()
        return Response(status=status.HTTP_204_NO_CONTENT)
