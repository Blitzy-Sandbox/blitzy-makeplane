# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Instance-administration endpoints for managing workspaces.

Provides instance-admin views that probe workspace-slug availability and
list or create workspaces on the singleton instance. These views back the
admin-onboarding panel that runs after the migrator container has applied
the schema and the bootstrap admin has signed in.
"""

# Third party imports
from rest_framework.response import Response
from rest_framework import status
from django.db import IntegrityError
from django.db.models import OuterRef, Func, F

# Module imports
from plane.app.views.base import BaseAPIView
from plane.license.api.permissions import InstanceAdminPermission
from plane.db.models import Workspace, WorkspaceMember, Project
from plane.license.api.serializers import WorkspaceSerializer
from plane.utils.constants import RESTRICTED_WORKSPACE_SLUGS


class InstanceWorkSpaceAvailabilityCheckEndpoint(BaseAPIView):
    """Reports whether a workspace slug is available for creation.

    HTTP methods + URL patterns:
        GET /api/instances/workspace-slug-check/?slug=<slug>

    Query parameters:
        slug (str, required): candidate workspace slug to test.

    Response shape:
        {"status": bool}  # True iff the slug is unused and not reserved
        {"error": str}    # 400 when ``slug`` is missing or empty

    Permissions:
        ``permission_classes = [InstanceAdminPermission]``.

    Notes:
        Extends ``plane.app.views.base.BaseAPIView`` (not the local
        ``BaseAPIView`` in ``views/base.py``) so ``get_queryset`` is not
        overridden — availability is computed directly via a single
        ``Workspace.objects.filter(slug__iexact=...).exists()`` probe
        combined with a ``RESTRICTED_WORKSPACE_SLUGS`` deny-list check.
    """

    permission_classes = [InstanceAdminPermission]

    def get(self, request):
        """Return ``{"status": True}`` when the slug is free, ``False`` when taken or reserved."""
        slug = request.GET.get("slug", False)

        if not slug or slug == "":
            return Response(
                {"error": "Workspace Slug is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        workspace = Workspace.objects.filter(slug__iexact=slug).exists() or slug in RESTRICTED_WORKSPACE_SLUGS
        return Response({"status": not workspace}, status=status.HTTP_200_OK)


class InstanceWorkSpaceEndpoint(BaseAPIView):
    """Lists and creates workspaces from the instance-admin console.

    HTTP methods + URL patterns:
        GET  /api/instances/workspaces/
        POST /api/instances/workspaces/

    Query parameters (GET):
        search (str, optional): case-insensitive substring match on ``name``.

    Request body (POST):
        name (str, required, max length 80): human-readable workspace name.
        slug (str, required, max length 48): URL slug (validated against
            ``RESTRICTED_WORKSPACE_SLUGS`` plus case-insensitive uniqueness).
        company_role (str, optional): persisted on the seeded
            ``WorkspaceMember`` row for the requesting admin.

    Response shape:
        GET: paginated ``WorkspaceSerializer`` payloads each augmented with
            two annotated counts:
                total_projects (int): count of ``Project`` rows owned by
                    the workspace.
                total_members (int): count of ``WorkspaceMember`` rows
                    whose member is not a bot and is active.
        POST 201: serialized newly-created workspace.
        POST 400: ``{"error": str}`` for missing fields or length violations,
            or a list of first serializer-error strings per field.
        POST 409: ``{"slug": "The workspace with the slug already exists"}``
            when the database raises ``IntegrityError`` containing
            "already exists".

    Permissions:
        ``permission_classes = [InstanceAdminPermission]``.

    Notes:
        Extends ``plane.app.views.base.BaseAPIView`` (the application-wide
        base, not the local module-scoped ``BaseAPIView``), so paginator
        helpers and exception translation come from the app stack rather
        than from ``views/base.py``. ``get_queryset`` is not overridden;
        the list is materialised inline via ``Workspace.objects.annotate``.
        POST is NON-idempotent — repeated requests with the same slug
        return HTTP 409 instead of recreating the workspace.
    """

    model = Workspace
    serializer_class = WorkspaceSerializer
    permission_classes = [InstanceAdminPermission]

    def get(self, request):
        """List workspaces with annotated project + active non-bot member counts.

        Applies optional ``?search=`` substring filter on ``name`` and
        paginates the result with ``max_per_page=10``.
        """
        project_count = (
            Project.objects.filter(workspace_id=OuterRef("id"))
            .order_by()
            .annotate(count=Func(F("id"), function="Count"))
            .values("count")
        )

        member_count = (
            WorkspaceMember.objects.filter(workspace=OuterRef("id"), member__is_bot=False, is_active=True)
            .select_related("owner")
            .order_by()
            .annotate(count=Func(F("id"), function="Count"))
            .values("count")
        )

        workspaces = Workspace.objects.annotate(total_projects=project_count, total_members=member_count)

        # Add search functionality
        search = request.query_params.get("search", None)
        if search:
            workspaces = workspaces.filter(name__icontains=search)

        return self.paginate(
            request=request,
            queryset=workspaces,
            on_results=lambda results: WorkspaceSerializer(results, many=True).data,
            max_per_page=10,
            default_per_page=10,
        )

    def post(self, request):
        """Create a workspace and seed the requesting admin as a role-20 member.

        Validates ``name`` (<=80 chars) and ``slug`` (<=48 chars) inline,
        delegates field-level validation to ``WorkspaceSerializer``, and
        on success also inserts the bootstrap ``WorkspaceMember`` row.
        Maps unique-slug ``IntegrityError`` to HTTP 409 Conflict.
        """
        try:
            serializer = WorkspaceSerializer(data=request.data)

            slug = request.data.get("slug", False)
            name = request.data.get("name", False)

            if not name or not slug:
                return Response(
                    {"error": "Both name and slug are required"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if len(name) > 80 or len(slug) > 48:
                return Response(
                    {"error": "The maximum length for name is 80 and for slug is 48"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if serializer.is_valid(raise_exception=True):
                serializer.save(owner=request.user)
                # Create Workspace member
                _ = WorkspaceMember.objects.create(
                    workspace_id=serializer.data["id"],
                    member=request.user,
                    role=20,
                    company_role=request.data.get("company_role", ""),
                )
                return Response(serializer.data, status=status.HTTP_201_CREATED)
            return Response(
                [serializer.errors[error][0] for error in serializer.errors],
                status=status.HTTP_400_BAD_REQUEST,
            )

        except IntegrityError as e:
            if "already exists" in str(e):
                return Response(
                    {"slug": "The workspace with the slug already exists"},
                    status=status.HTTP_409_CONFLICT,
                )
