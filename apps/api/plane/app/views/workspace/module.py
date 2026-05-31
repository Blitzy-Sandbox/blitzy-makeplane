# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace-level module aggregation endpoint.

Returns every non-archived ``Module`` in a workspace with derived
issue-state counts (total / completed / cancelled / started / unstarted
/ backlog) annotated at query time so the dashboard can render module
progress without further API calls.
"""

# Django imports
from django.db.models import Prefetch, Q, Count

# Third party modules
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.views.base import BaseAPIView
from plane.db.models import Module, ModuleLink
from plane.app.permissions import WorkspaceViewerPermission
from plane.app.serializers.module import ModuleSerializer


class WorkspaceModulesEndpoint(BaseAPIView):
    """Return every non-archived module in a workspace with state-count annotations.

    HTTP methods + URL pattern:
        GET /api/workspaces/<str:slug>/modules/

    Request body: none. Query parameters:
        order_by (str, optional, default ``"-created_at"``): consumed from
            ``self.kwargs`` rather than ``request.query_params``; sort field
            passed straight to ``order_by``.

    Response shape:
        List[ModuleSerializer] — each row enriched with ``total_issues``,
        ``completed_issues``, ``cancelled_issues``, ``started_issues``,
        ``unstarted_issues``, and ``backlog_issues`` counters that exclude
        archived, draft, and soft-deleted ``ModuleIssue`` rows.

    Permissions:
        permission_classes = [WorkspaceViewerPermission] — any active
        workspace member.

    Performance:
        Eager loading via ``select_related("project", "workspace", "lead")``
        and ``prefetch_related("members", "link_module")`` keeps the row
        count low. Each per-state ``Count`` uses ``distinct=True`` to avoid
        double-counting when the inner join fans out.
    """

    permission_classes = [WorkspaceViewerPermission]

    def get(self, request, slug):
        """List non-archived modules across the workspace with derived counts.

        Builds a single annotated queryset filtered by ``workspace__slug`` and
        ``archived_at__isnull=True``, eager-loads ``project``, ``workspace``,
        ``lead`` and the related ``members`` and ``link_module``, then attaches
        ``total_issues`` plus per-state counts (``completed_issues``,
        ``cancelled_issues``, ``started_issues``, ``unstarted_issues``,
        ``backlog_issues``) that exclude archived/draft/soft-deleted entries.
        Ordering follows ``self.kwargs["order_by"]`` (default ``-created_at``).
        """
        modules = (
            Module.objects.filter(workspace__slug=slug)
            .select_related("project")
            .select_related("workspace")
            .select_related("lead")
            .prefetch_related("members")
            .filter(archived_at__isnull=True)
            .prefetch_related(
                Prefetch(
                    "link_module",
                    queryset=ModuleLink.objects.select_related("module", "created_by"),
                )
            )
            .annotate(
                total_issues=Count(
                    "issue_module",
                    filter=Q(
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                completed_issues=Count(
                    "issue_module",
                    filter=Q(
                        issue_module__issue__state__group="completed",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                cancelled_issues=Count(
                    "issue_module",
                    filter=Q(
                        issue_module__issue__state__group="cancelled",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                started_issues=Count(
                    "issue_module",
                    filter=Q(
                        issue_module__issue__state__group="started",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                unstarted_issues=Count(
                    "issue_module",
                    filter=Q(
                        issue_module__issue__state__group="unstarted",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .annotate(
                backlog_issues=Count(
                    "issue_module",
                    filter=Q(
                        issue_module__issue__state__group="backlog",
                        issue_module__issue__archived_at__isnull=True,
                        issue_module__issue__is_draft=False,
                        issue_module__deleted_at__isnull=True,
                    ),
                    distinct=True,
                )
            )
            .order_by(self.kwargs.get("order_by", "-created_at"))
        )

        serializer = ModuleSerializer(modules, many=True).data
        return Response(serializer, status=status.HTTP_200_OK)
