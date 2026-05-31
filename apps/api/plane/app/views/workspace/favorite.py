# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace favorites endpoints.

Favorites are personal bookmarks pointing at heterogeneous workspace
entities (projects, cycles, modules, views, pages, ...) keyed by
``entity_type`` and ``entity_identifier``. A favorite may either be a
leaf or a group (folder) containing nested favorites — the group
endpoint exposes the children of one such folder.
"""

# Third party modules
from rest_framework import status
from rest_framework.response import Response

# Django modules
from django.db.models import Q
from django.db import IntegrityError

# Module imports
from plane.app.views.base import BaseAPIView
from plane.db.models import UserFavorite, Workspace
from plane.app.serializers import UserFavoriteSerializer
from plane.app.permissions import allow_permission, ROLE


class WorkspaceFavoriteEndpoint(BaseAPIView):
    """Manage per-user favorites scoped to a workspace.

    HTTP methods + URL patterns:
        GET    /api/workspaces/<str:slug>/user-favorites/
        POST   /api/workspaces/<str:slug>/user-favorites/
        PATCH  /api/workspaces/<str:slug>/user-favorites/<uuid:favorite_id>/
        DELETE /api/workspaces/<str:slug>/user-favorites/<uuid:favorite_id>/

    Request body (POST):
        ``UserFavoriteSerializer`` fields — primarily ``entity_type``,
        ``entity_identifier``, ``project_id``, optional ``parent`` (UUID of
        a folder/group).

    Request body (PATCH):
        Partial subset of ``UserFavoriteSerializer`` fields — typically
        used to rename a folder or reparent a favorite.

    Response shape:
        GET: List[UserFavoriteSerializer] — only top-level favorites
            (``parent__isnull=True``) that are either project-less and not
            of type ``"page"``, or are scoped to a project where the caller
            is an active project member.
        POST: ``UserFavoriteSerializer`` — returns the existing row when an
            ``(entity_type, entity_identifier)`` pair already exists for the
            caller, rather than creating a duplicate.
        PATCH/DELETE: single row or 204.

    Permissions:
        Enforced by ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER],
        level="WORKSPACE")`` on every handler — guests cannot manage
        favorites.

    Read replica:
        ``use_read_replica = True`` — GET is offloaded from the primary DB.

    Side effects:
        DELETE uses ``favorite.delete(soft=False)`` — favorites are removed
        permanently, not soft-deleted, so previously-favorited items do not
        linger in the user's history.
    """

    use_read_replica = True

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        """List the caller's top-level favorites visible in the workspace.

        Returns favorites with ``parent__isnull=True`` that are either
        project-less (excluding ``entity_type="page"``) or scoped to a project
        the caller is an active member of.
        """
        # the second filter is to check if the user is a member of the project
        favorites = UserFavorite.objects.filter(user=request.user, workspace__slug=slug, parent__isnull=True).filter(
            Q(project__isnull=True) & ~Q(entity_type="page")
            | (
                Q(project__isnull=False)
                & Q(project__project_projectmember__member=request.user)
                & Q(project__project_projectmember__is_active=True)
            )
        )
        serializer = UserFavoriteSerializer(favorites, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug):
        """Create or return an existing favorite for the caller.

        If a favorite with the supplied ``entity_type`` /
        ``entity_identifier`` already exists for the caller in the workspace,
        the existing serialized row is returned with HTTP 200 instead of
        creating a duplicate. ``IntegrityError`` returns HTTP 400 with
        ``{"error": "Favorite already exists"}``.
        """
        try:
            workspace = Workspace.objects.get(slug=slug)

            # If the favorite exists return
            if request.data.get("entity_identifier"):
                user_favorites = UserFavorite.objects.filter(
                    workspace=workspace,
                    user_id=request.user.id,
                    entity_type=request.data.get("entity_type"),
                    entity_identifier=request.data.get("entity_identifier"),
                ).first()

                # If the favorite exists return
                if user_favorites:
                    serializer = UserFavoriteSerializer(user_favorites)
                    return Response(serializer.data, status=status.HTTP_200_OK)

            # else create a new favorite
            serializer = UserFavoriteSerializer(data=request.data)
            if serializer.is_valid():
                serializer.save(
                    user_id=request.user.id,
                    workspace=workspace,
                    project_id=request.data.get("project_id", None),
                )
                return Response(serializer.data, status=status.HTTP_200_OK)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError:
            return Response({"error": "Favorite already exists"}, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def patch(self, request, slug, favorite_id):
        """Apply a partial update to one of the caller's favorites by id."""
        favorite = UserFavorite.objects.get(user=request.user, workspace__slug=slug, pk=favorite_id)
        serializer = UserFavoriteSerializer(favorite, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def delete(self, request, slug, favorite_id):
        """Permanently delete one of the caller's favorites.

        Uses ``delete(soft=False)`` to bypass soft-deletion so the row is
        truly removed (favorites are personal navigation state, not
        auditable business data).
        """
        favorite = UserFavorite.objects.get(user=request.user, workspace__slug=slug, pk=favorite_id)
        favorite.delete(soft=False)
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkspaceFavoriteGroupEndpoint(BaseAPIView):
    """Return the children of a favorite folder owned by the caller.

    HTTP methods + URL pattern:
        GET /api/workspaces/<str:slug>/user-favorites/<uuid:favorite_id>/group/

    Request body: none.

    Response shape:
        List[UserFavoriteSerializer] — favorites with
        ``parent=favorite_id`` that are either project-less or scoped to a
        project the caller is an active member of.

    Permissions:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")``
        — guests cannot read favorite groups.
    """

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug, favorite_id):
        """List the caller's child favorites under the supplied folder id."""
        favorites = UserFavorite.objects.filter(user=request.user, workspace__slug=slug, parent_id=favorite_id).filter(
            Q(project__isnull=True)
            | (
                Q(project__isnull=False)
                & Q(project__project_projectmember__member=request.user)
                & Q(project__project_projectmember__is_active=True)
            )
        )
        serializer = UserFavoriteSerializer(favorites, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)
