# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace home-dashboard widget preference endpoints.

Each authenticated user has a row per ``HomeWidgetKeys`` choice in
``WorkspaceHomePreference`` controlling whether the widget is enabled and
in what order it renders on the workspace home dashboard. The ``get``
handler lazily backfills missing rows for each known key so the frontend
can rely on a fully-populated set.
"""

# Module imports
from ..base import BaseAPIView
from plane.db.models.workspace import WorkspaceHomePreference
from plane.app.permissions import allow_permission, ROLE
from plane.db.models import Workspace
from plane.app.serializers.workspace import WorkspaceHomePreferenceSerializer

# Third party imports
from rest_framework.response import Response
from rest_framework import status


class WorkspaceHomePreferenceViewSet(BaseAPIView):
    """Manage per-user home-dashboard widget preferences in a workspace.

    HTTP methods + URL patterns:
        GET   /api/workspaces/<str:slug>/home-preferences/
        PATCH /api/workspaces/<str:slug>/home-preferences/<str:key>/

    Request body (PATCH):
        WorkspaceHomePreferenceSerializer fields — typically ``is_enabled``
        (bool), ``config`` (JSON object), ``sort_order`` (int).

    Response shape:
        GET: a list of objects with ``key``, ``is_enabled``, ``config``,
            ``sort_order`` — one per known ``HomeWidgetKeys`` choice
            (excluding ``quick_tutorial`` and ``new_at_plane``, which are
            intentionally suppressed in the lazy backfill).
        PATCH: ``WorkspaceHomePreferenceSerializer`` instance for the
            updated row.

    Permissions:
        Enforced by ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST],
        level="WORKSPACE")`` on each handler — any active workspace member.

    Side effects:
        ``get`` lazily creates missing ``WorkspaceHomePreference`` rows via
        ``bulk_create(..., ignore_conflicts=True)`` so the initial dashboard
        load returns a complete widget set.

    Notes:
        Despite the ViewSet suffix, this class extends ``BaseAPIView`` and
        implements two flat HTTP handlers rather than DRF ``ModelViewSet``
        actions — leave the class name and base unchanged (no refactoring,
        per system boundaries).

    Cross-references:
        * Serializer: ``WorkspaceHomePreferenceSerializer`` in
          ``apps/api/plane/app/serializers/workspace.py``.
        * Models: ``WorkspaceHomePreference``,
          ``HomeWidgetKeys``, ``Workspace`` in
          ``apps/api/plane/db/models/workspace.py``.
        * Permissions: ``allow_permission`` decorator in
          ``apps/api/plane/app/permissions/base.py``.
        * URL registration:
          ``apps/api/plane/app/urls/workspace.py``.
    """

    model = WorkspaceHomePreference

    def get_serializer_class(self):
        """Return ``WorkspaceHomePreferenceSerializer`` for every action."""
        return WorkspaceHomePreferenceSerializer

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        """Return every home-widget preference for the caller, backfilling missing rows.

        For each ``HomeWidgetKeys`` choice except ``quick_tutorial`` and
        ``new_at_plane``, the handler checks whether the caller already has a
        row and inserts the missing ones with descending ``sort_order`` (1000,
        999, 998, ...) so newly-introduced widgets appear at the top of the
        list. Conflicts are silently ignored to keep the call idempotent.
        """
        workspace = Workspace.objects.get(slug=slug)

        get_preference = WorkspaceHomePreference.objects.filter(user=request.user, workspace_id=workspace.id)

        create_preference_keys = []

        keys = [
            key
            for key, _ in WorkspaceHomePreference.HomeWidgetKeys.choices
            if key not in ["quick_tutorial", "new_at_plane"]
        ]

        sort_order_counter = 1

        for preference in keys:
            if preference not in get_preference.values_list("key", flat=True):
                create_preference_keys.append(preference)

                sort_order = 1000 - sort_order_counter

                preference = WorkspaceHomePreference.objects.bulk_create(
                    [
                        WorkspaceHomePreference(
                            key=key,
                            user=request.user,
                            workspace=workspace,
                            sort_order=sort_order,
                        )
                        for key in create_preference_keys
                    ],
                    batch_size=10,
                    ignore_conflicts=True,
                )
                sort_order_counter += 1

        preference = WorkspaceHomePreference.objects.filter(user=request.user, workspace_id=workspace.id)

        return Response(
            preference.values("key", "is_enabled", "config", "sort_order"),
            status=status.HTTP_200_OK,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def patch(self, request, slug, key):
        """Update the caller's preference row identified by ``key`` (partial update).

        Returns HTTP 400 with ``{"detail": "Preference not found"}`` if no row
        matches the caller, workspace, and key — including when ``get`` has
        not yet been called to backfill the row.
        """
        preference = WorkspaceHomePreference.objects.filter(key=key, workspace__slug=slug, user=request.user).first()

        if preference:
            serializer = WorkspaceHomePreferenceSerializer(preference, data=request.data, partial=True)

            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data, status=status.HTTP_200_OK)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        return Response({"detail": "Preference not found"}, status=status.HTTP_400_BAD_REQUEST)
