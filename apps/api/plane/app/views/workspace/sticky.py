# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace sticky-note CRUD endpoints.

Sticky notes are personal, workspace-scoped jottings owned by their
creator. Read access is open to any active workspace member, but mutation
is restricted to the row's creator via the ``creator=True`` flag on
``@allow_permission`` — neither workspace admins nor other members may
modify or delete somebody else's sticky.
"""

# Third party imports
from rest_framework.response import Response
from rest_framework import status

# Module imports
from plane.app.views.base import BaseViewSet
from plane.app.permissions import ROLE, allow_permission
from plane.db.models import Sticky, Workspace
from plane.app.serializers import StickySerializer


class WorkspaceStickyViewSet(BaseViewSet):
    """Manage workspace-scoped sticky notes owned by the calling user.

    HTTP methods + URL patterns:
        GET    /api/workspaces/<str:slug>/stickies/
        POST   /api/workspaces/<str:slug>/stickies/
        GET    /api/workspaces/<str:slug>/stickies/<uuid:pk>/
        PATCH  /api/workspaces/<str:slug>/stickies/<uuid:pk>/
        DELETE /api/workspaces/<str:slug>/stickies/<uuid:pk>/

    Request body (POST/PATCH):
        StickySerializer fields — primarily ``name``, ``description_html``,
        ``description_stripped``, ``color``, ``sort_order``.

    Response shape:
        Single ``StickySerializer`` row (CRUD) or a paginated list of 20
        rows per page ordered by ``-sort_order`` (list).

    Permissions:
        list/create: ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST],
            level="WORKSPACE")`` — any active workspace member.
        partial_update/destroy: ``@allow_permission(allowed_roles=[],
            creator=True, model=Sticky, level="WORKSPACE")`` — only the row's
            creator may mutate or delete (no role-based escalation).

    Read replica:
        ``use_read_replica = True`` — listing is offloaded from the primary
        DB.

    Queryset:
        Filtered by ``workspace__slug`` and ``owner_id=request.user.id``;
        each user only ever sees their own stickies.
    """

    serializer_class = StickySerializer
    model = Sticky
    use_read_replica = True

    def get_queryset(self):
        """Restrict the queryset to stickies the caller owns in the workspace."""
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(owner_id=self.request.user.id)
            .select_related("workspace", "owner")
            .distinct()
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def create(self, request, slug):
        """Persist a new sticky owned by the caller in the workspace."""
        workspace = Workspace.objects.get(slug=slug)
        serializer = StickySerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(workspace_id=workspace.id, owner_id=request.user.id)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug):
        """Return a paginated list of the caller's stickies (20 per page).

        When the ``query`` query parameter is present, narrows to stickies
        whose ``description_stripped`` contains that substring
        (case-insensitive). Results are ordered by descending ``sort_order``.
        """
        query = request.query_params.get("query", False)
        stickies = self.get_queryset().order_by("-sort_order")
        if query:
            stickies = stickies.filter(description_stripped__icontains=query)

        return self.paginate(
            request=request,
            queryset=(stickies),
            on_results=lambda stickies: StickySerializer(stickies, many=True).data,
            default_per_page=20,
        )

    @allow_permission(allowed_roles=[], creator=True, model=Sticky, level="WORKSPACE")
    def partial_update(self, request, *args, **kwargs):
        """Apply a partial update to a sticky (creator-only)."""
        return super().partial_update(request, *args, **kwargs)

    @allow_permission(allowed_roles=[], creator=True, model=Sticky, level="WORKSPACE")
    def destroy(self, request, *args, **kwargs):
        """Delete a sticky (creator-only)."""
        return super().destroy(request, *args, **kwargs)
