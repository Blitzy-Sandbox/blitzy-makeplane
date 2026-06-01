# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Advanced workspace-scoped analytics endpoints with role / project / temporal breakdowns.

Provides the three advanced analytics surfaces consumed by the workspace
dashboard's "Advanced" tab:

* :class:`AdvanceAnalyticsEndpoint` -- overview rollups (member counts by
  role, work-item counts by state) under ``tab=overview`` /
  ``tab=work-items``.
* :class:`AdvanceAnalyticsStatsEndpoint` -- per-project grouped issue
  stats (cancelled / completed / backlog / un-started / started).
* :class:`AdvanceAnalyticsChartEndpoint` -- chart-ready payloads
  (project-level totals, custom work-item charts via
  :func:`plane.utils.build_chart.build_analytics_chart`, and month-by-
  month work-item completion series with zero-fill).

All three share :class:`AdvanceAnalyticsBaseView`, which wires
``self.filters`` from :func:`plane.utils.date_utils.get_analytics_filters`
using the request's ``date_filter`` and ``project_ids`` query parameters.
These endpoints execute heavy aggregate ``.annotate()`` / ``.values()``
queries -- subclasses MAY set ``use_read_replica = True`` on the parent
``BaseAPIView`` so ``GET`` traffic routes through the read replica.
"""

from rest_framework.response import Response
from rest_framework import status
from typing import Dict, List, Any
from django.db.models import QuerySet, Q, Count
from django.http import HttpRequest
from django.db.models.functions import TruncMonth
from django.utils import timezone
from plane.app.views.base import BaseAPIView
from plane.app.permissions import ROLE, allow_permission
from plane.db.models import (
    WorkspaceMember,
    Project,
    Issue,
    Cycle,
    Module,
    IssueView,
    ProjectPage,
    Workspace,
    ProjectMember,
)
from plane.utils.build_chart import build_analytics_chart
from plane.utils.date_utils import (
    get_analytics_filters,
)


class AdvanceAnalyticsBaseView(BaseAPIView):
    """Shared workspace-init helper for the three advanced analytics endpoints.

    Subclasses call :meth:`initialize_workspace` at the start of every
    ``get`` to populate ``self._workspace_slug`` and ``self.filters``
    (a dict with ``base_filters`` / ``project_filters`` /
    ``analytics_date_range`` / ``chart_period_range`` keys -- see
    :func:`plane.utils.date_utils.get_analytics_filters`).

    Not directly routed -- only its three subclasses
    (:class:`AdvanceAnalyticsEndpoint`,
    :class:`AdvanceAnalyticsStatsEndpoint`,
    :class:`AdvanceAnalyticsChartEndpoint`) are exposed via URL.
    """

    def initialize_workspace(self, slug: str, type: str) -> None:
        """Cache the workspace slug and build the request-scoped filter dict via :func:`get_analytics_filters`.

        ``type`` is ``"analytics"`` (populates ``analytics_date_range`` --
        current vs. previous comparison) or ``"chart"`` (populates
        ``chart_period_range`` -- a single ``(start, end)`` tuple for
        chart axes).
        """
        self._workspace_slug = slug
        self.filters = get_analytics_filters(
            slug=slug,
            type=type,
            user=self.request.user,
            date_filter=self.request.GET.get("date_filter", None),
            project_ids=self.request.GET.get("project_ids", None),
        )


class AdvanceAnalyticsEndpoint(AdvanceAnalyticsBaseView):
    """Workspace overview rollups (member counts, project totals, work-item state breakdown).

    HTTP methods + URL patterns:
        GET /api/workspaces/<slug>/advance-analytics/

    Query parameters:
        tab (str, optional, default=``"overview"``): One of
            ``"overview"`` (member / project / work-item / cycle / intake
            totals + role breakdown) or ``"work-items"`` (work-item
            counts grouped by state group).
        date_filter (str, optional): Date-range token consumed by
            :func:`get_analytics_filters` to populate
            ``analytics_date_range`` (current vs. previous comparison).
        project_ids (str, optional): Comma-separated project UUIDs to
            constrain the rollup. When supplied, member counts switch
            from ``WorkspaceMember`` to ``ProjectMember`` so role
            breakdowns reflect the chosen projects.

    Response shape (200 OK, ``tab=overview``):
        ``{"total_users": {"count": int}, "total_admins": {"count": int},
        "total_members": {"count": int}, "total_guests": {"count": int},
        "total_projects": {"count": int}, "total_work_items":
        {"count": int}, "total_cycles": {"count": int}, "total_intake":
        {"count": int}}``. ``total_intake`` counts issues whose
        ``issue_intake__status`` is in the persisted intake status set
        ``{"-2", "-1", "0", "1", "2"}``.

    Response shape (200 OK, ``tab=work-items``):
        ``{"total_work_items": {"count": int}, "started_work_items":
        {"count": int}, "backlog_work_items": {"count": int},
        "un_started_work_items": {"count": int}, "completed_work_items":
        {"count": int}, "cancelled_work_items": {"count": int}}``.

    Error responses (400 Bad Request):
        ``{"message": "Invalid tab"}`` when ``tab`` is not one of the
        recognized values.

    Permissions:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")``.
    """

    def get_filtered_counts(self, queryset: QuerySet) -> Dict[str, int]:
        """Return ``{"count": <n>}`` for the queryset.

        ``<n>`` is the queryset count restricted to the current
        ``analytics_date_range`` window when one is set, otherwise the
        unfiltered count.
        """

        def get_filtered_count() -> int:
            if self.filters["analytics_date_range"]:
                return queryset.filter(
                    created_at__gte=self.filters["analytics_date_range"]["current"]["gte"],
                    created_at__lte=self.filters["analytics_date_range"]["current"]["lte"],
                ).count()
            return queryset.count()

        def get_previous_count() -> int:
            if self.filters["analytics_date_range"] and self.filters["analytics_date_range"].get("previous"):
                return queryset.filter(
                    created_at__gte=self.filters["analytics_date_range"]["previous"]["gte"],
                    created_at__lte=self.filters["analytics_date_range"]["previous"]["lte"],
                ).count()
            return 0

        return {
            "count": get_filtered_count(),
            # "filter_count": get_previous_count(),
        }

    def get_overview_data(self) -> Dict[str, Dict[str, int]]:
        """Build the ``overview`` rollup: member counts by role, project / work-item / cycle / intake totals.

        Switches member counting from ``WorkspaceMember`` to
        ``ProjectMember`` when ``project_ids`` is supplied so the role
        breakdown reflects the selected project subset.
        """
        members_query = WorkspaceMember.objects.filter(
            workspace__slug=self._workspace_slug, is_active=True, member__is_bot=False
        )

        if self.request.GET.get("project_ids", None):
            project_ids = self.request.GET.get("project_ids", None)
            project_ids = [str(project_id) for project_id in project_ids.split(",")]
            members_query = ProjectMember.objects.filter(
                project_id__in=project_ids, is_active=True, member__is_bot=False
            )

        return {
            "total_users": self.get_filtered_counts(members_query),
            "total_admins": self.get_filtered_counts(members_query.filter(role=ROLE.ADMIN.value)),
            "total_members": self.get_filtered_counts(members_query.filter(role=ROLE.MEMBER.value)),
            "total_guests": self.get_filtered_counts(members_query.filter(role=ROLE.GUEST.value)),
            "total_projects": self.get_filtered_counts(Project.objects.filter(**self.filters["project_filters"])),
            "total_work_items": self.get_filtered_counts(Issue.issue_objects.filter(**self.filters["base_filters"])),
            "total_cycles": self.get_filtered_counts(Cycle.objects.filter(**self.filters["base_filters"])),
            "total_intake": self.get_filtered_counts(
                Issue.objects.filter(**self.filters["base_filters"]).filter(
                    issue_intake__status__in=["-2", "-1", "0", "1", "2"]  # TODO: Add description for reference.
                )
            ),
        }

    def get_work_items_stats(self) -> Dict[str, Dict[str, int]]:
        """Build the ``work-items`` rollup.

        Returns total work-item count plus per-state-group counts for
        the five state groups (started / backlog / unstarted /
        completed / cancelled).
        """
        base_queryset = Issue.issue_objects.filter(**self.filters["base_filters"])

        return {
            "total_work_items": self.get_filtered_counts(base_queryset),
            "started_work_items": self.get_filtered_counts(base_queryset.filter(state__group="started")),
            "backlog_work_items": self.get_filtered_counts(base_queryset.filter(state__group="backlog")),
            "un_started_work_items": self.get_filtered_counts(base_queryset.filter(state__group="unstarted")),
            "completed_work_items": self.get_filtered_counts(base_queryset.filter(state__group="completed")),
        }

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request: HttpRequest, slug: str) -> Response:
        """Dispatch on the ``tab`` query parameter to either the overview rollup or the work-items rollup."""
        self.initialize_workspace(slug, type="analytics")
        tab = request.GET.get("tab", "overview")

        if tab == "overview":
            return Response(
                self.get_overview_data(),
                status=status.HTTP_200_OK,
            )
        elif tab == "work-items":
            return Response(
                self.get_work_items_stats(),
                status=status.HTTP_200_OK,
            )
        return Response({"message": "Invalid tab"}, status=status.HTTP_400_BAD_REQUEST)


class AdvanceAnalyticsStatsEndpoint(AdvanceAnalyticsBaseView):
    """Per-project grouped issue statistics (cancelled / completed / backlog / un-started / started).

    HTTP methods + URL patterns:
        GET /api/workspaces/<slug>/advance-analytics-stats/

    Query parameters:
        type (str, optional, default=``"work-items"``): Only
            ``"work-items"`` is recognized; any other value returns 400.
        date_filter (str, optional): Date-range token; populates
            ``chart_period_range`` (since :meth:`initialize_workspace` is
            called with ``type="chart"``).
        project_ids (str, optional): Comma-separated project UUIDs.

    Response shape (200 OK):
        Array of ``{"project_id": UUID, "project__name": str,
        "cancelled_work_items": int, "completed_work_items": int,
        "backlog_work_items": int, "un_started_work_items": int,
        "started_work_items": int}``, ordered by ``project_id``.

    Error responses (400 Bad Request):
        ``{"message": "Invalid type"}``.

    Permissions:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")``.
    """

    def get_project_issues_stats(self) -> QuerySet:
        """Return the workspace issue queryset grouped by project.

        Annotated with per-state-group counts via
        ``Count("id", filter=Q(state__group=...))`` and restricted to
        ``chart_period_range`` when set.
        """
        # Get the base queryset with workspace and project filters
        base_queryset = Issue.issue_objects.filter(**self.filters["base_filters"])

        # Apply date range filter if available
        if self.filters["chart_period_range"]:
            start_date, end_date = self.filters["chart_period_range"]
            base_queryset = base_queryset.filter(created_at__date__gte=start_date, created_at__date__lte=end_date)

        return (
            base_queryset.values("project_id", "project__name")
            .annotate(
                cancelled_work_items=Count("id", filter=Q(state__group="cancelled")),
                completed_work_items=Count("id", filter=Q(state__group="completed")),
                backlog_work_items=Count("id", filter=Q(state__group="backlog")),
                un_started_work_items=Count("id", filter=Q(state__group="unstarted")),
                started_work_items=Count("id", filter=Q(state__group="started")),
            )
            .order_by("project_id")
        )

    def get_work_items_stats(self) -> Dict[str, Dict[str, int]]:
        """Return the per-project work-item annotation without date restriction.

        Identical to :meth:`get_project_issues_stats` except the
        ``chart_period_range`` filter is not applied.
        """
        base_queryset = Issue.issue_objects.filter(**self.filters["base_filters"])
        return (
            base_queryset.values("project_id", "project__name")
            .annotate(
                cancelled_work_items=Count("id", filter=Q(state__group="cancelled")),
                completed_work_items=Count("id", filter=Q(state__group="completed")),
                backlog_work_items=Count("id", filter=Q(state__group="backlog")),
                un_started_work_items=Count("id", filter=Q(state__group="unstarted")),
                started_work_items=Count("id", filter=Q(state__group="started")),
            )
            .order_by("project_id")
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request: HttpRequest, slug: str) -> Response:
        """Dispatch on the ``type`` query parameter and return per-project work-item stats.

        Only ``"work-items"`` is supported; any other value returns 400.
        """
        self.initialize_workspace(slug, type="chart")
        type = request.GET.get("type", "work-items")

        if type == "work-items":
            return Response(
                self.get_work_items_stats(),
                status=status.HTTP_200_OK,
            )

        return Response({"message": "Invalid type"}, status=status.HTTP_400_BAD_REQUEST)


class AdvanceAnalyticsChartEndpoint(AdvanceAnalyticsBaseView):
    """Chart-ready payloads: project totals, custom work-item charts, monthly completion series.

    HTTP methods + URL patterns:
        GET /api/workspaces/<slug>/advance-analytics-charts/

    Query parameters:
        type (str, optional, default=``"projects"``): One of
            ``"projects"`` (workspace-wide totals across 7 entity kinds),
            ``"custom-work-items"`` (delegates to
            :func:`plane.utils.build_chart.build_analytics_chart`),
            ``"work-items"`` (month-by-month created vs. completed
            series with zero-fill from workspace creation through the
            current month).
        group_by (str, optional): Forwarded to
            :func:`build_analytics_chart` -- typically a member of
            ``{"STATES", "STATE_GROUPS", "LABELS", "ASSIGNEES",
            "ESTIMATE_POINTS", "CYCLES", "MODULES", "PRIORITY",
            "START_DATE", "TARGET_DATE", "CREATED_AT", "COMPLETED_AT"}``.
        x_axis (str, optional, default=``"PRIORITY"``): Forwarded to
            :func:`build_analytics_chart`.
        date_filter (str, optional): Date-range token; populates
            ``chart_period_range``.
        project_ids (str, optional): Comma-separated project UUIDs.

    Response shape (200 OK, ``type=projects``):
        Array of seven ``{"key": str, "name": str, "count": int}``
        entries for ``work_items``, ``cycles``, ``modules``, ``intake``,
        ``members``, ``pages``, ``views``.

    Response shape (200 OK, ``type=work-items``):
        ``{"data": [{"key": "YYYY-MM-DD", "name": "YYYY-MM-DD",
        "count": int, "completed_issues": int, "created_issues": int},
        ...], "schema": {"completed_issues": "completed_issues",
        "created_issues": "created_issues"}}``. Months with zero issues
        are explicitly included; the series spans from the workspace's
        first-of-month creation date through the current month.

    Response shape (200 OK, ``type=custom-work-items``):
        Pass-through of :func:`build_analytics_chart` -- see that
        function's docstring.

    Error responses (400 Bad Request):
        ``{"message": "Invalid type"}``.

    Permissions:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")``.
    """

    def project_chart(self) -> List[Dict[str, Any]]:
        """Build the seven-entity workspace totals chart.

        Returns counts for ``work_items`` / ``cycles`` / ``modules`` /
        ``intake`` / ``members`` / ``pages`` / ``views`` under the
        current ``chart_period_range``.
        """
        # Get the base queryset with workspace and project filters
        base_queryset = Issue.issue_objects.filter(**self.filters["base_filters"])
        date_filter = {}

        # Apply date range filter if available
        if self.filters["chart_period_range"]:
            start_date, end_date = self.filters["chart_period_range"]
            date_filter = {
                "created_at__date__gte": start_date,
                "created_at__date__lte": end_date,
            }

        total_work_items = base_queryset.filter(**date_filter).count()
        total_cycles = Cycle.objects.filter(**self.filters["base_filters"], **date_filter).count()
        total_modules = Module.objects.filter(**self.filters["base_filters"], **date_filter).count()
        total_intake = Issue.objects.filter(
            issue_intake__isnull=False, **self.filters["base_filters"], **date_filter
        ).count()
        total_members = WorkspaceMember.objects.filter(
            workspace__slug=self._workspace_slug, is_active=True, **date_filter
        ).count()
        total_pages = ProjectPage.objects.filter(**self.filters["base_filters"], **date_filter).count()
        total_views = IssueView.objects.filter(**self.filters["base_filters"], **date_filter).count()

        data = {
            "work_items": total_work_items,
            "cycles": total_cycles,
            "modules": total_modules,
            "intake": total_intake,
            "members": total_members,
            "pages": total_pages,
            "views": total_views,
        }

        return [
            {
                "key": key,
                "name": key.replace("_", " ").title(),
                "count": value or 0,
            }
            for key, value in data.items()
        ]

    def work_item_completion_chart(self) -> Dict[str, Any]:
        """Build the month-by-month created vs. completed work-item series.

        Explicit zero-fill from workspace creation through the current
        month. Uses ``TruncMonth("created_at")`` to bucket issues; the
        loop between ``start_date`` (workspace first-of-month) and
        ``last_month`` (current month's first day) injects ``count=0``
        entries for months with no issues so the chart series is
        contiguous.
        """
        # Get the base queryset
        queryset = (
            Issue.issue_objects.filter(**self.filters["base_filters"])
            .select_related("workspace", "state", "parent")
            .prefetch_related("assignees", "labels", "issue_module__module", "issue_cycle__cycle")
        )

        workspace = Workspace.objects.get(slug=self._workspace_slug)
        start_date = workspace.created_at.date().replace(day=1)

        # Apply date range filter if available
        if self.filters["chart_period_range"]:
            start_date, end_date = self.filters["chart_period_range"]
            queryset = queryset.filter(created_at__date__gte=start_date, created_at__date__lte=end_date)

        # Annotate by month and count
        monthly_stats = (
            queryset.annotate(month=TruncMonth("created_at"))
            .values("month")
            .annotate(
                created_count=Count("id"),
                completed_count=Count("id", filter=Q(state__group="completed")),
            )
            .order_by("month")
        )

        # Create dictionary of month -> counts
        stats_dict = {
            stat["month"].strftime("%Y-%m-%d"): {
                "created_count": stat["created_count"],
                "completed_count": stat["completed_count"],
            }
            for stat in monthly_stats
        }

        # Generate monthly data (ensure months with 0 count are included)
        data = []
        # include the current date at the end
        end_date = timezone.now().date()
        last_month = end_date.replace(day=1)
        current_month = start_date

        while current_month <= last_month:
            date_str = current_month.strftime("%Y-%m-%d")
            stats = stats_dict.get(date_str, {"created_count": 0, "completed_count": 0})
            data.append(
                {
                    "key": date_str,
                    "name": date_str,
                    "count": stats["created_count"],
                    "completed_issues": stats["completed_count"],
                    "created_issues": stats["created_count"],
                }
            )
            # Move to next month
            if current_month.month == 12:
                current_month = current_month.replace(year=current_month.year + 1, month=1)
            else:
                current_month = current_month.replace(month=current_month.month + 1)

        schema = {
            "completed_issues": "completed_issues",
            "created_issues": "created_issues",
        }

        return {"data": data, "schema": schema}

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request: HttpRequest, slug: str) -> Response:
        """Dispatch on the ``type`` query parameter and return the chart payload.

        Supports ``projects`` / ``custom-work-items`` / ``work-items``.
        """
        self.initialize_workspace(slug, type="chart")
        type = request.GET.get("type", "projects")
        group_by = request.GET.get("group_by", None)
        x_axis = request.GET.get("x_axis", "PRIORITY")

        if type == "projects":
            return Response(self.project_chart(), status=status.HTTP_200_OK)

        elif type == "custom-work-items":
            queryset = (
                Issue.issue_objects.filter(**self.filters["base_filters"])
                .select_related("workspace", "state", "parent")
                .prefetch_related("assignees", "labels", "issue_module__module", "issue_cycle__cycle")
            )

            # Apply date range filter if available
            if self.filters["chart_period_range"]:
                start_date, end_date = self.filters["chart_period_range"]
                queryset = queryset.filter(created_at__date__gte=start_date, created_at__date__lte=end_date)

            return Response(
                build_analytics_chart(queryset, x_axis, group_by),
                status=status.HTTP_200_OK,
            )

        elif type == "work-items":
            return Response(
                self.work_item_completion_chart(),
                status=status.HTTP_200_OK,
            )

        return Response({"message": "Invalid type"}, status=status.HTTP_400_BAD_REQUEST)
