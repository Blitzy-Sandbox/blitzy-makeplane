# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace sidebar preference endpoints.

Each authenticated user has a row per ``UserPreferenceKeys`` choice in
``WorkspaceUserPreference`` that controls whether the sidebar entry is
pinned and in what order it renders. The ``get`` handler lazily backfills
missing rows so the initial sidebar render always sees a complete set
of preference entries.
"""

# Module imports
from ..base import BaseAPIView
from plane.db.models.workspace import WorkspaceUserPreference
from plane.app.serializers.workspace import WorkspaceUserPreferenceSerializer
from plane.app.permissions import allow_permission, ROLE
from plane.db.models import Workspace


# Third party imports
from rest_framework.response import Response
from rest_framework import status


class WorkspaceUserPreferenceViewSet(BaseAPIView):
    """Manage per-user sidebar preferences scoped to a workspace.

    HTTP methods + URL pattern:
        GET   /api/workspaces/<str:slug>/sidebar-preferences/
        PATCH /api/workspaces/<str:slug>/sidebar-preferences/

    Request body (PATCH):
        A JSON array of objects, each with ``key`` plus optionally
        ``is_pinned`` (bool) and/or ``sort_order`` (int). Keys not matching
        an existing row are silently skipped.

    Response shape:
        GET: a dictionary keyed by preference key, each value containing
            ``is_pinned`` and ``sort_order``.
        PATCH: ``{"message": "Successfully updated"}`` on success.

    Permissions:
        Both handlers are gated by ``@allow_permission([ROLE.ADMIN,
        ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")`` -- any active
        workspace member.

    Read replica:
        ``use_read_replica = True`` -- GET is read-only.

    Side effects:
        ``get`` lazily backfills missing ``WorkspaceUserPreference`` rows
        with a strictly increasing ``sort_order`` (65535, 75535, ...) and
        marks ``DRAFTS``, ``YOUR_WORK``, and ``STICKIES`` as pinned by
        default. Conflicts are silently ignored to keep the call idempotent.

    Notes:
        Despite the ViewSet suffix, this class extends ``BaseAPIView`` and
        implements flat HTTP handlers -- leave the class name and base
        unchanged (no refactoring, per system boundaries).
    """

    model = WorkspaceUserPreference
    use_read_replica = True

    def get_serializer_class(self):
        """Return ``WorkspaceUserPreferenceSerializer`` for every action."""
        return WorkspaceUserPreferenceSerializer

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        """Return every sidebar-preference for the caller, backfilling missing rows.

        For each ``UserPreferenceKeys`` choice the handler checks whether the
        caller already has a row and inserts the missing ones with a strictly
        increasing ``sort_order``; ``DRAFTS``, ``YOUR_WORK``, and ``STICKIES``
        are pinned by default. Conflicts are silently ignored to keep the call
        idempotent.
        """
        workspace = Workspace.objects.get(slug=slug)

        get_preference = WorkspaceUserPreference.objects.filter(user=request.user, workspace_id=workspace.id)

        create_preference_keys = []

        keys = [key for key, _ in WorkspaceUserPreference.UserPreferenceKeys.choices]

        for preference in keys:
            if preference not in get_preference.values_list("key", flat=True):
                create_preference_keys.append(preference)

                preference = WorkspaceUserPreference.objects.bulk_create(
                    [
                        WorkspaceUserPreference(
                            key=key,
                            user=request.user,
                            workspace=workspace,
                            sort_order=(65535 + (i * 10000)),
                            is_pinned=(
                                True
                                if key
                                in [
                                    WorkspaceUserPreference.UserPreferenceKeys.DRAFTS,
                                    WorkspaceUserPreference.UserPreferenceKeys.YOUR_WORK,
                                    WorkspaceUserPreference.UserPreferenceKeys.STICKIES,
                                ]
                                else False
                            ),
                        )
                        for i, key in enumerate(create_preference_keys)
                    ],
                    batch_size=10,
                    ignore_conflicts=True,
                )

        preferences = (
            WorkspaceUserPreference.objects.filter(user=request.user, workspace_id=workspace.id)
            .order_by("sort_order")
            .values("key", "is_pinned", "sort_order")
        )

        user_preferences = {}

        for preference in preferences:
            user_preferences[(str(preference["key"]))] = {
                "is_pinned": preference["is_pinned"],
                "sort_order": preference["sort_order"],
            }
        return Response(
            user_preferences,
            status=status.HTTP_200_OK,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def patch(self, request, slug):
        """Apply a batch of ``is_pinned``/``sort_order`` edits keyed by preference.

        The request body is a list of objects, each carrying a ``key`` plus
        optional ``is_pinned`` and/or ``sort_order`` fields. Rows are saved
        with ``update_fields=["is_pinned", "sort_order"]`` so other columns
        are left untouched. Missing keys are silently skipped.
        """
        for data in request.data:
            key = data.pop("key", None)
            if not key:
                continue

            preference = WorkspaceUserPreference.objects.filter(key=key, workspace__slug=slug).first()

            if not preference:
                continue

            if "is_pinned" in data:
                preference.is_pinned = data["is_pinned"]

            if "sort_order" in data:
                preference.sort_order = data["sort_order"]

            preference.save(update_fields=["is_pinned", "sort_order"])

        return Response({"message": "Successfully updated"}, status=status.HTTP_200_OK)
