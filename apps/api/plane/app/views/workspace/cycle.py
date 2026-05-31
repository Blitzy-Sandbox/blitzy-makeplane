# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace-level cycle aggregation endpoint.

Returns every non-archived ``Cycle`` in a workspace with derived
issue-state counts (total / completed / cancelled / started / unstarted
/ backlog) annotated at query time so the dashboard can render cycle
progress without further API calls.
"""

# Django imports
from django.db.models import Q, Count

# Third party modules
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.views.base import BaseAPIView
from plane.db.models import Cycle
from plane.app.permissions import WorkspaceViewerPermission
from plane.app.serializers.cycle import CycleSerializer


class WorkspaceCyclesEndpoint(BaseAPIView):
    """Return every non-archived cycle in a workspace with state-count annotations.

    HTTP methods + URL pattern:
        GET /api/workspaces/<str:slug>/cycles/

    Request body: none. Query parameters:
        order_by (str, optional, default ``"-created_at"``): consumed from
            ``self.kwargs`` rather than ``request.query_params``; sort field
            passed straight to ``order_by``.

    Response shape:
        List[CycleSerializer] -- each row enriched with ``total_issues``,
        ``completed_issues``, ``cancelled_issues``, ``started_issues``,
        ``unstarted_issues``, and ``backlog_issues`` counters that exclude
        archived, draft, and soft-deleted ``CycleIssue`` rows.

    Permissions:
        permission_classes = [WorkspaceViewerPermission] -- any active
        workspace member.

    Performance:
        ``select_related("project", "workspace", "owned_by")`` keeps the row
        count low. Each per-state ``Count`` filters out
        ``issue_cycle__deleted_at`` and
        ``issue_cycle__issue__deleted_at`` so soft-deleted associations are
        not double-counted.
    """

    permission_classes = [WorkspaceViewerPermission]

    def get(self, request, slug):
        """List non-archived cycles across the workspace with derived counts.

        Builds a single annotated queryset filtered by ``workspace__slug`` and
        ``archived_at__isnull=True``, eager-loads ``project``, ``workspace``,
        ``owned_by``, then attaches ``total_issues`` plus per-state counts
        (``completed_issues``, ``cancelled_issues``, ``started_issues``,
        ``unstarted_issues``, ``backlog_issues``) that exclude
        archived/draft/soft-deleted ``CycleIssue`` rows. Ordering follows
        ``self.kwargs["order_by"]`` (default ``-created_at``).
        """
        cycles = (
            Cycle.objects.filter(workspace__slug=slug)
            .select_related("project")
            .select_related("workspace")
            .select_related("owned_by")
            .filter(archived_at__isnull=True)
            .annotate(
                total_issues=Count(
                    "issue_cycle",
                    filter=Q(
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__deleted_at__isnull=True,
                        issue_cycle__issue__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                completed_issues=Count(
                    "issue_cycle__issue__state__group",
                    filter=Q(
                        issue_cycle__issue__state__group="completed",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__issue__deleted_at__isnull=True,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                cancelled_issues=Count(
                    "issue_cycle__issue__state__group",
                    filter=Q(
                        issue_cycle__issue__state__group="cancelled",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__issue__deleted_at__isnull=True,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                started_issues=Count(
                    "issue_cycle__issue__state__group",
                    filter=Q(
                        issue_cycle__issue__state__group="started",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__issue__deleted_at__isnull=True,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                unstarted_issues=Count(
                    "issue_cycle__issue__state__group",
                    filter=Q(
                        issue_cycle__issue__state__group="unstarted",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__issue__deleted_at__isnull=True,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                backlog_issues=Count(
                    "issue_cycle__issue__state__group",
                    filter=Q(
                        issue_cycle__issue__state__group="backlog",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__issue__deleted_at__isnull=True,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .order_by(self.kwargs.get("order_by", "-created_at"))
            .distinct()
        )
        serializer = CycleSerializer(cycles, many=True).data
        return Response(serializer, status=status.HTTP_200_OK)
