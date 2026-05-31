# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace quick-link CRUD endpoints.

Quick links are personal, per-user navigation shortcuts scoped to a
workspace. Each row is owned by its creator and is invisible to other
users — even workspace admins cannot read another user's quick links
because every query filters by ``owner=request.user``.
"""

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.db.models import WorkspaceUserLink, Workspace
from plane.app.serializers import WorkspaceUserLinkSerializer
from ..base import BaseViewSet
from plane.app.permissions import allow_permission, ROLE


class QuickLinkViewSet(BaseViewSet):
    """Manage per-user quick links scoped to a workspace.

    HTTP methods + URL patterns:
        GET    /api/workspaces/<str:slug>/quick-links/
        POST   /api/workspaces/<str:slug>/quick-links/
        GET    /api/workspaces/<str:slug>/quick-links/<uuid:pk>/
        PATCH  /api/workspaces/<str:slug>/quick-links/<uuid:pk>/
        DELETE /api/workspaces/<str:slug>/quick-links/<uuid:pk>/

    Request body (POST/PATCH):
        ``WorkspaceUserLinkSerializer`` fields — typically ``title``,
        ``url``.

    Response shape:
        Single ``WorkspaceUserLinkSerializer`` row (CRUD) or list of the
        caller's quick links (list).

    Permissions:
        Every handler is gated by ``@allow_permission([ROLE.ADMIN,
        ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")`` — any active
        workspace member.

    Read replica:
        ``use_read_replica = True`` — read-only listing is offloaded from
        the primary DB.

    Notes:
        There is no class-level ``get_queryset`` override; every handler
        filters explicitly by ``workspace__slug`` and ``owner=request.user``
        to enforce per-user scoping.
    """

    model = WorkspaceUserLink
    use_read_replica = True

    def get_serializer_class(self):
        """Return ``WorkspaceUserLinkSerializer`` for every action."""
        return WorkspaceUserLinkSerializer

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def create(self, request, slug):
        """Persist a new quick link owned by the caller in the workspace."""
        workspace = Workspace.objects.get(slug=slug)
        serializer = WorkspaceUserLinkSerializer(data=request.data)

        if serializer.is_valid():
            serializer.save(workspace_id=workspace.id, owner_id=request.user.id)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def partial_update(self, request, slug, pk):
        """Apply a partial update to one of the caller's quick links.

        Returns HTTP 404 if no quick link matches the supplied ``pk`` for the
        caller in the workspace (silently scoped so admins cannot edit other
        users' quick links).
        """
        quick_link = WorkspaceUserLink.objects.filter(pk=pk, workspace__slug=slug, owner=request.user).first()

        if quick_link:
            serializer = WorkspaceUserLinkSerializer(quick_link, data=request.data, partial=True)
            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data, status=status.HTTP_200_OK)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        return Response({"detail": "Quick link not found."}, status=status.HTTP_404_NOT_FOUND)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def retrieve(self, request, slug, pk):
        """Return a single quick link belonging to the caller, or 404."""
        try:
            quick_link = WorkspaceUserLink.objects.get(pk=pk, workspace__slug=slug, owner=request.user)
            serializer = WorkspaceUserLinkSerializer(quick_link)
            return Response(serializer.data, status=status.HTTP_200_OK)
        except WorkspaceUserLink.DoesNotExist:
            return Response({"error": "Quick link not found."}, status=status.HTTP_404_NOT_FOUND)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def destroy(self, request, slug, pk):
        """Delete one of the caller's quick links."""
        quick_link = WorkspaceUserLink.objects.get(pk=pk, workspace__slug=slug, owner=request.user)
        quick_link.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug):
        """Return every quick link the caller owns in the workspace."""
        quick_links = WorkspaceUserLink.objects.filter(workspace__slug=slug, owner=request.user)

        serializer = WorkspaceUserLinkSerializer(quick_links, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)
