# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""Workspace-level state aggregation endpoint.

Returns every non-triage workflow state across projects the caller can
reach in a workspace, with each state's ``order`` rewritten in-memory to
a normalized fraction so the frontend can render group-relative ordering
without further math.
"""

# Third party modules
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.serializers import StateSerializer
from plane.app.views.base import BaseAPIView
from plane.db.models import State
from plane.app.permissions import WorkspaceEntityPermission
from collections import defaultdict


class WorkspaceStatesEndpoint(BaseAPIView):
    """Return every workspace state grouped by state-group order.

    HTTP methods + URL pattern:
        GET /api/workspaces/<str:slug>/states/

    Request body: none.

    Response shape:
        List[StateSerializer] -- every non-triage ``State`` reachable through
        the caller's active, non-archived project memberships. Each row's
        ``order`` field is rewritten in-memory to ``index / count`` per
        state group before serialization (see the loop in ``get`` for the
        grouping math).

    Permissions:
        permission_classes = [WorkspaceEntityPermission] -- read access for
        every active workspace member; mutations would require Admin/Member,
        but this endpoint is GET-only.

    Read replica:
        ``use_read_replica = True`` -- cross-project listing is read-only.
    """

    permission_classes = [WorkspaceEntityPermission]
    use_read_replica = True

    def get(self, request, slug):
        """List workspace states with per-group fractional ordering.

        Pulls every non-triage ``State`` reachable via the caller's active,
        non-archived project memberships, groups them by ``state.group``, then
        rewrites each state's ``order`` to ``index / count`` within its group
        so the frontend can sort groups independently. Returns the serialized
        list.
        """
        states = State.objects.filter(
            workspace__slug=slug,
            project__project_projectmember__member=request.user,
            project__project_projectmember__is_active=True,
            project__archived_at__isnull=True,
            is_triage=False,
        )

        grouped_states = defaultdict(list)
        for state in states:
            grouped_states[state.group].append(state)

        for group, group_states in grouped_states.items():
            count = len(group_states)

            for index, state in enumerate(group_states, start=1):
                state.order = index / count

        serializer = StateSerializer(states, many=True).data
        return Response(serializer, status=status.HTTP_200_OK)
