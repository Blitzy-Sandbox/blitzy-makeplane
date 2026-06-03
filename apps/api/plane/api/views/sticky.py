# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""User sticky-note endpoints for the external ``/api/v1/`` API.

Stickies are short, workspace-scoped, user-owned notes mounted at
``/api/v1/workspaces/<slug>/stickies/``. Each row is private to its owner
even though the permission class only verifies workspace membership — the
queryset filters by ``owner=request.user``.

Authentication is via the ``X-Api-Key`` header (see
``plane.api.middleware.api_authentication.APIKeyAuthentication``).
"""

from rest_framework.response import Response
from rest_framework import status

from plane.api.views.base import BaseViewSet
from plane.app.permissions import WorkspaceUserPermission
from plane.db.models import Sticky, Workspace
from plane.api.serializers import StickySerializer

# OpenAPI imports
from plane.utils.openapi.decorators import sticky_docs

from drf_spectacular.utils import OpenApiRequest, OpenApiResponse
from plane.utils.openapi import (
    STICKY_EXAMPLE,
    create_paginated_response,
    DELETED_RESPONSE,
)


class StickyViewSet(BaseViewSet):
    """CRUD over the requesting user's stickies within a workspace.

    HTTP methods + URL patterns (DRF router):
        GET     /api/v1/workspaces/<slug>/stickies/
        POST    /api/v1/workspaces/<slug>/stickies/
        GET     /api/v1/workspaces/<slug>/stickies/<uuid:pk>/
        PATCH   /api/v1/workspaces/<slug>/stickies/<uuid:pk>/
        PUT     /api/v1/workspaces/<slug>/stickies/<uuid:pk>/
        DELETE  /api/v1/workspaces/<slug>/stickies/<uuid:pk>/

    Request body (POST / PATCH / PUT) — see ``StickySerializer``:
        name        (str, required for POST) – Title of the sticky.
        description (object, optional)       – Rich-text body (Plane
            ProseMirror JSON shape).
        color       (str, optional)          – Hex color code for the
            sticky background.
        sort_order  (float, optional)        – Client-controlled ordering
            key.

    Response shape:
        ``StickySerializer`` payload(s). List endpoints page through the
        requesting user's own stickies only.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication``
        (inherited from ``BaseViewSet``).
    Permissions:
        ``WorkspaceUserPermission`` — any active workspace member.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Visibility:
        The queryset is restricted to ``owner=request.user`` regardless of
        the caller's role. Even workspace ``ADMIN`` users cannot see or
        mutate another user's stickies through this endpoint.

    Side effects:
        Writes a single ``Sticky`` row on POST/PATCH/PUT, deletes on
        DELETE. No Celery enqueues, no webhook fan-out.
    """

    serializer_class = StickySerializer
    model = Sticky
    use_read_replica = True
    permission_classes = [WorkspaceUserPermission]

    def get_queryset(self):
        """Return the requesting user's stickies in the URL's workspace.

        Filters by ``workspace__slug=slug`` and ``owner=request.user``
        so the endpoint is effectively per-user even though
        ``WorkspaceUserPermission`` allows any workspace member.
        """
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(owner_id=self.request.user.id)
            .distinct()
        )

    @sticky_docs(
        operation_id="create_sticky",
        summary="Create a new sticky",
        description="Create a new sticky in the workspace",
        request=OpenApiRequest(request=StickySerializer),
        responses={
            201: OpenApiResponse(description="Sticky created", response=StickySerializer, examples=[STICKY_EXAMPLE])
        },
    )
    def create(self, request, slug):
        """Create a sticky in the workspace, owned by the requesting user.

        Resolves ``slug`` to a ``Workspace`` and persists the new row with
        ``workspace_id`` and ``owner_id`` injected from the URL and the
        authenticated request, never from the request body.
        """
        workspace = Workspace.objects.get(slug=slug)
        serializer = StickySerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(workspace_id=workspace.id, owner_id=request.user.id)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @sticky_docs(
        operation_id="list_stickies",
        summary="List stickies",
        description="List all stickies in the workspace",
        responses={
            200: create_paginated_response(
                StickySerializer, "Sticky", "List of stickies", example_name="List of stickies"
            )
        },
    )
    def list(self, request, slug):
        """List the requesting user's stickies, optionally filtered by a search query.

        The ``query`` query-string parameter narrows results by case-insensitive
        substring match on ``description_stripped``. Results are ordered by
        ``-created_at`` and paginated (20 per page by default) through
        ``BasePaginator.paginate``.
        """
        query = request.query_params.get("query", False)
        stickies = self.get_queryset().order_by("-created_at")
        if query:
            stickies = stickies.filter(description_stripped__icontains=query)

        return self.paginate(
            request=request,
            queryset=(stickies),
            on_results=lambda stickies: StickySerializer(stickies, many=True).data,
            default_per_page=20,
        )

    @sticky_docs(
        operation_id="retrieve_sticky",
        summary="Retrieve a sticky",
        description="Retrieve a sticky by its ID",
        responses={200: OpenApiResponse(description="Sticky", response=StickySerializer, examples=[STICKY_EXAMPLE])},
    )
    def retrieve(self, request, slug, pk):
        """Retrieve a single sticky by its primary key.

        ``self.get_object()`` enforces the per-user, per-workspace filter
        from :meth:`get_queryset`, so a 404 is returned for stickies owned
        by other users even within the same workspace.
        """
        sticky = self.get_object()
        return Response(StickySerializer(sticky).data)

    @sticky_docs(
        operation_id="update_sticky",
        summary="Update a sticky",
        description="Update a sticky by its ID",
        request=OpenApiRequest(request=StickySerializer),
        responses={200: OpenApiResponse(description="Sticky", response=StickySerializer, examples=[STICKY_EXAMPLE])},
    )
    def partial_update(self, request, slug, pk):
        """Update one or more fields on a sticky owned by the requesting user.

        ``StickySerializer`` is invoked with ``partial=True`` so any subset of
        writable fields may be supplied. Ownership is enforced by
        :meth:`get_queryset`; ``workspace_id`` and ``owner_id`` are not
        mutable through this endpoint.
        """
        sticky = self.get_object()
        serializer = StickySerializer(sticky, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @sticky_docs(
        operation_id="delete_sticky",
        summary="Delete a sticky",
        description="Delete a sticky by its ID",
        responses={204: DELETED_RESPONSE},
    )
    def destroy(self, request, slug, pk):
        """Delete a sticky owned by the requesting user.

        ``self.get_object()`` ensures only the owner can target the row;
        callers attempting to delete another user's sticky receive a 404.
        Returns HTTP 204 on success with no body.
        """
        sticky = self.get_object()
        sticky.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
