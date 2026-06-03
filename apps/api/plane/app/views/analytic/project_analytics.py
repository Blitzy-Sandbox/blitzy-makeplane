# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Project-scoped advanced analytics endpoints with optional cycle / module narrowing.

Mirrors the workspace-level surface in
:mod:`plane.app.views.analytic.advance` but constrains every queryset to
a single project (and optionally to a single cycle or module). The three
endpoints are:

* :class:`ProjectAdvanceAnalyticsEndpoint` -- compact work-item state
  counts (overall / cycle-scoped / module-scoped).
* :class:`ProjectAdvanceAnalyticsStatsEndpoint` -- grouped stats either
  by project or by assignee (with avatar URL computed from
  ``avatar_asset`` or ``avatar``).
* :class:`ProjectAdvanceAnalyticsChartEndpoint` -- completion-trend
  charts: day-by-day for cycle / module windows, month-by-month with
  zero-fill for project-wide scope.

All three share :class:`ProjectAdvanceAnalyticsBaseView`, which wires
``self.filters`` from :func:`plane.utils.date_utils.get_analytics_filters`
(``date_filter`` + ``project_ids`` query parameters). These endpoints
execute heavy aggregate ``.annotate()`` / ``.values()`` queries -- the
parent ``BaseAPIView`` MAY set ``use_read_replica = True`` to route
``GET`` traffic through the read replica.
"""

from rest_framework.response import Response
from rest_framework import status
from typing import Dict, Any
from django.db.models import QuerySet, Q, Count
from django.http import HttpRequest
from django.db.models.functions import TruncMonth
from django.utils import timezone
from datetime import timedelta
from plane.app.views.base import BaseAPIView
from plane.app.permissions import ROLE, allow_permission
from plane.db.models import (
    Project,
    Issue,
    Cycle,
    Module,
    CycleIssue,
    ModuleIssue,
)
from django.db import models
from django.db.models import F, Case, When, Value
from django.db.models.functions import Concat
from plane.utils.build_chart import build_analytics_chart
from plane.utils.date_utils import (
    get_analytics_filters,
)


class ProjectAdvanceAnalyticsBaseView(BaseAPIView):
    """Shared workspace-init helper for the three project-scoped analytics endpoints.

    Subclasses call :meth:`initialize_workspace` at the start of every
    ``get`` to populate ``self._workspace_slug`` and ``self.filters``
    (a dict with ``base_filters`` / ``project_filters`` /
    ``analytics_date_range`` / ``chart_period_range`` keys -- see
    :func:`plane.utils.date_utils.get_analytics_filters`).

    Not directly routed -- only its three subclasses
    (:class:`ProjectAdvanceAnalyticsEndpoint`,
    :class:`ProjectAdvanceAnalyticsStatsEndpoint`,
    :class:`ProjectAdvanceAnalyticsChartEndpoint`) are exposed via URL.
    """

    def initialize_workspace(self, slug: str, type: str) -> None:
        """Cache the workspace slug and build the request-scoped filter dict.

        Delegates to :func:`get_analytics_filters`; ``type`` is
        ``"analytics"`` or ``"chart"``.
        """
        self._workspace_slug = slug
        self.filters = get_analytics_filters(
            slug=slug,
            type=type,
            user=self.request.user,
            date_filter=self.request.GET.get("date_filter", None),
            project_ids=self.request.GET.get("project_ids", None),
        )


class ProjectAdvanceAnalyticsEndpoint(ProjectAdvanceAnalyticsBaseView):
    """Compact work-item state counts for a project (optionally narrowed to a cycle or module).

    HTTP methods + URL patterns:
        GET /api/workspaces/<slug>/projects/<uuid:project_id>/advance-analytics/

    Request body:
        None (GET only) -- all inputs come from URL kwargs and query parameters.

    Query parameters:
        cycle_id (UUID, optional): When supplied, the base queryset
            switches to ``Issue.issue_objects.filter(id__in=<CycleIssue
            issue_ids for this cycle>)`` so counts reflect only issues
            assigned to the cycle.
        module_id (UUID, optional): When supplied, the base queryset
            switches to ``Issue.issue_objects.filter(id__in=<ModuleIssue
            issue_ids for this module>)``. Ignored when ``cycle_id`` is
            also present (cycle takes precedence).
        date_filter (str, optional): Date-range token passed to
            :func:`get_analytics_filters` (``type="analytics"``).
        project_ids (str, optional): Forwarded to
            :func:`get_analytics_filters` for the ``base_filters`` dict.

    URL parameters:
        slug: The workspace slug.
        project_id: The project UUID; used directly when no cycle / module
            scope is supplied.

    Response shape (200 OK):
        ``{"total_work_items": {"count": int}, "started_work_items":
        {"count": int}, "backlog_work_items": {"count": int},
        "un_started_work_items": {"count": int}, "completed_work_items":
        {"count": int}}``. Counts are restricted to the current
        ``analytics_date_range`` window when set.

    Permissions:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER])`` -- project-level
        admin or member (no explicit ``level=`` kwarg; defaults to
        project scope per :func:`plane.app.permissions.base.allow_permission`).

    Cross-references:
        * Permission decorator: :func:`plane.app.permissions.allow_permission`
          (``apps/api/plane/app/permissions/base.py``)
        * Filter helper: :func:`plane.utils.date_utils.get_analytics_filters`
          (``apps/api/plane/utils/date_utils.py``)
        * Models read: :class:`plane.db.models.Issue`,
          :class:`plane.db.models.CycleIssue`,
          :class:`plane.db.models.ModuleIssue`
          (``apps/api/plane/db/models/``)
        * URL: ``apps/api/plane/app/urls/analytic.py``
    """

    def get_filtered_counts(self, queryset: QuerySet) -> Dict[str, int]:
        """Return ``{"count": <count>}`` for the supplied queryset.

        ``<count>`` is restricted to the current ``analytics_date_range``
        window when set; otherwise it is the unfiltered queryset count.
        """
        def get_filtered_count() -> int:
            if self.filters["analytics_date_range"]:
                return queryset.filter(
                    created_at__gte=self.filters["analytics_date_range"]["current"]["gte"],
                    created_at__lte=self.filters["analytics_date_range"]["current"]["lte"],
                ).count()
            return queryset.count()

        return {
            "count": get_filtered_count(),
        }

    def get_work_items_stats(self, project_id, cycle_id=None, module_id=None) -> Dict[str, Dict[str, int]]:
        """Return per-state-group counts for the project, cycle, or module scope.

        Categories: started / backlog / unstarted / completed.
        When ``cycle_id`` is supplied the base queryset is built from
        ``CycleIssue`` issue IDs; when ``module_id`` is supplied it is
        built from ``ModuleIssue`` issue IDs; otherwise it is filtered
        directly by ``project_id``. ``cycle_id`` takes precedence over
        ``module_id``.
        """
        base_queryset = None
        if cycle_id is not None:
            cycle_issues = CycleIssue.objects.filter(**self.filters["base_filters"], cycle_id=cycle_id).values_list(
                "issue_id", flat=True
            )
            base_queryset = Issue.issue_objects.filter(id__in=cycle_issues)
        elif module_id is not None:
            module_issues = ModuleIssue.objects.filter(**self.filters["base_filters"], module_id=module_id).values_list(
                "issue_id", flat=True
            )
            base_queryset = Issue.issue_objects.filter(id__in=module_issues)
        else:
            base_queryset = Issue.issue_objects.filter(**self.filters["base_filters"], project_id=project_id)

        return {
            "total_work_items": self.get_filtered_counts(base_queryset),
            "started_work_items": self.get_filtered_counts(base_queryset.filter(state__group="started")),
            "backlog_work_items": self.get_filtered_counts(base_queryset.filter(state__group="backlog")),
            "un_started_work_items": self.get_filtered_counts(base_queryset.filter(state__group="unstarted")),
            "completed_work_items": self.get_filtered_counts(base_queryset.filter(state__group="completed")),
        }

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request: HttpRequest, slug: str, project_id: str) -> Response:
        """Return per-state-group work-item counts for the project.

        Optionally narrowed to the supplied ``cycle_id`` or ``module_id``
        query parameters.
        """
        self.initialize_workspace(slug, type="analytics")

        # Optionally accept cycle_id or module_id as query params
        cycle_id = request.GET.get("cycle_id", None)
        module_id = request.GET.get("module_id", None)
        return Response(
            self.get_work_items_stats(cycle_id=cycle_id, module_id=module_id, project_id=project_id),
            status=status.HTTP_200_OK,
        )


class ProjectAdvanceAnalyticsStatsEndpoint(ProjectAdvanceAnalyticsBaseView):
    """Grouped issue statistics either by project or by assignee for the project (with avatar URL).

    HTTP methods + URL patterns:
        GET /api/workspaces/<slug>/projects/<uuid:project_id>/advance-analytics-stats/

    Request body:
        None (GET only) -- all inputs come from URL kwargs and query parameters.

    Query parameters:
        type (str, optional, default=``"work-items"``): Only
            ``"work-items"`` is recognized; any other value returns 400.
        cycle_id (UUID, optional): When supplied, group-by-assignee mode
            scopes to ``CycleIssue`` issue IDs for the cycle.
        module_id (UUID, optional): When supplied, group-by-assignee mode
            scopes to ``ModuleIssue`` issue IDs for the module.
        date_filter (str, optional): Date-range token; populates
            ``chart_period_range``.
        project_ids (str, optional): Forwarded to
            :func:`get_analytics_filters`.

    URL parameters:
        slug: The workspace slug.
        project_id: The project UUID.

    Response shape (200 OK):
        For the ``work-items`` type: array of ``{"display_name": str,
        "assignee_id": UUID, "avatar_url": str | None,
        "cancelled_work_items": int, "completed_work_items": int,
        "backlog_work_items": int, "un_started_work_items": int,
        "started_work_items": int}``, ordered by ``display_name``.
        ``avatar_url`` is computed: ``/api/assets/v2/static/<asset>/``
        when ``avatar_asset`` is set, otherwise the legacy ``avatar``
        string, otherwise ``None``. State-group counts use
        ``distinct=True`` to avoid double counting from
        ``assignees`` and ``labels`` joins.

    Error responses (400 Bad Request):
        ``{"message": "Invalid type"}``.

    Permissions:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER])`` -- project-level
        admin or member.

    Cross-references:
        * Permission decorator: :func:`plane.app.permissions.allow_permission`
          (``apps/api/plane/app/permissions/base.py``)
        * Filter helper: :func:`plane.utils.date_utils.get_analytics_filters`
          (``apps/api/plane/utils/date_utils.py``)
        * Models read: :class:`plane.db.models.Issue`,
          :class:`plane.db.models.User`,
          :class:`plane.db.models.CycleIssue`,
          :class:`plane.db.models.ModuleIssue`
          (``apps/api/plane/db/models/``)
        * URL: ``apps/api/plane/app/urls/analytic.py``
    """

    def get_project_issues_stats(self) -> QuerySet:
        """Return per-project grouped state-group counts.

        Bound by the current ``chart_period_range``. Not used in the
        current dispatch path -- preserved for symmetry with
        ``advance.AdvanceAnalyticsStatsEndpoint``.
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

    def get_work_items_stats(self, project_id, cycle_id=None, module_id=None) -> Dict[str, Dict[str, int]]:
        """Return per-assignee grouped state-group counts for the project / cycle / module scope.

        Each row is annotated with an avatar URL: ``avatar_asset`` ->
        ``/api/assets/v2/static/<asset>/`` when set, otherwise the
        legacy ``avatar`` field as a fallback.
        """
        base_queryset = None
        if cycle_id is not None:
            cycle_issues = CycleIssue.objects.filter(**self.filters["base_filters"], cycle_id=cycle_id).values_list(
                "issue_id", flat=True
            )
            base_queryset = Issue.issue_objects.filter(id__in=cycle_issues)
        elif module_id is not None:
            module_issues = ModuleIssue.objects.filter(**self.filters["base_filters"], module_id=module_id).values_list(
                "issue_id", flat=True
            )
            base_queryset = Issue.issue_objects.filter(id__in=module_issues)
        else:
            base_queryset = Issue.issue_objects.filter(**self.filters["base_filters"], project_id=project_id)
        return (
            base_queryset.annotate(display_name=F("assignees__display_name"))
            .annotate(assignee_id=F("assignees__id"))
            .annotate(avatar=F("assignees__avatar"))
            .annotate(
                avatar_url=Case(
                    # If `avatar_asset` exists, use it to generate the asset URL
                    When(
                        assignees__avatar_asset__isnull=False,
                        then=Concat(
                            Value("/api/assets/v2/static/"),
                            "assignees__avatar_asset",  # Assuming avatar_asset has an id or relevant field
                            Value("/"),
                        ),
                    ),
                    # If `avatar_asset` is None, fall back to using `avatar` field directly
                    When(assignees__avatar_asset__isnull=True, then="assignees__avatar"),
                    default=Value(None),
                    output_field=models.CharField(),
                )
            )
            .values("display_name", "assignee_id", "avatar_url")
            .annotate(
                cancelled_work_items=Count("id", filter=Q(state__group="cancelled"), distinct=True),
                completed_work_items=Count("id", filter=Q(state__group="completed"), distinct=True),
                backlog_work_items=Count("id", filter=Q(state__group="backlog"), distinct=True),
                un_started_work_items=Count("id", filter=Q(state__group="unstarted"), distinct=True),
                started_work_items=Count("id", filter=Q(state__group="started"), distinct=True),
            )
            .order_by("display_name")
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request: HttpRequest, slug: str, project_id: str) -> Response:
        """Dispatch on ``type`` and return per-assignee state-group counts.

        Only ``"work-items"`` is supported. Optionally narrowed by
        ``cycle_id`` / ``module_id`` query parameters.
        """
        self.initialize_workspace(slug, type="chart")
        type = request.GET.get("type", "work-items")

        if type == "work-items":
            # Optionally accept cycle_id or module_id as query params
            cycle_id = request.GET.get("cycle_id", None)
            module_id = request.GET.get("module_id", None)
            return Response(
                self.get_work_items_stats(project_id=project_id, cycle_id=cycle_id, module_id=module_id),
                status=status.HTTP_200_OK,
            )

        return Response({"message": "Invalid type"}, status=status.HTTP_400_BAD_REQUEST)


class ProjectAdvanceAnalyticsChartEndpoint(ProjectAdvanceAnalyticsBaseView):
    """Completion-trend chart payload for a project (day-by-day cycle / module scope, month-by-month project scope).

    HTTP methods + URL patterns:
        GET /api/workspaces/<slug>/projects/<uuid:project_id>/advance-analytics-charts/

    Request body:
        None (GET only) -- all inputs come from URL kwargs and query parameters.

    Query parameters:
        type (str, optional, default=``"projects"``): One of
            ``"custom-work-items"`` (delegates to
            :func:`plane.utils.build_chart.build_analytics_chart`) or
            ``"work-items"`` (completion-trend series). Any other value
            (including the default ``"projects"``) falls through to a
            400 ``"Invalid type"`` response since the project chart
            endpoint does not implement a ``"projects"`` branch.
        group_by (str, optional): Forwarded to
            :func:`build_analytics_chart`.
        x_axis (str, optional, default=``"PRIORITY"``): Forwarded to
            :func:`build_analytics_chart`.
        cycle_id (UUID, optional): When supplied with ``type=work-items``,
            the completion chart uses ``cycle.start_date`` to
            ``cycle.end_date`` as a day-by-day window. With
            ``type=custom-work-items``, the queryset is restricted to
            ``CycleIssue`` issue IDs for the cycle.
        module_id (UUID, optional): When supplied with
            ``type=work-items``, the completion chart uses
            ``module.start_date`` to ``module.target_date`` as a
            day-by-day window. With ``type=custom-work-items``, the
            queryset is restricted to ``ModuleIssue`` issue IDs.
        date_filter (str, optional): Date-range token; populates
            ``chart_period_range``.
        project_ids (str, optional): Forwarded to
            :func:`get_analytics_filters`.

    URL parameters:
        slug: The workspace slug.
        project_id: The project UUID.

    Response shape (200 OK, ``type=work-items``):
        ``{"data": [{"key": "YYYY-MM-DD", "name": "YYYY-MM-DD",
        "count": int, "completed_issues": int, "created_issues": int},
        ...], "schema": {"completed_issues": "completed_issues",
        "created_issues": "created_issues"}}``. With ``cycle_id`` /
        ``module_id`` the series is day-by-day and ``count`` is
        ``created_count + completed_count``; without them the series is
        month-by-month with zero-fill from project creation through the
        current month and ``count`` is ``created_count`` only.

    Response shape (200 OK, ``type=work-items`` with empty cycle/module):
        ``{"data": [], "schema": {}}`` when the cycle / module has no
        ``start_date`` or the project has no ``created_at``.

    Response shape (200 OK, ``type=custom-work-items``):
        Pass-through of :func:`build_analytics_chart`.

    Error responses (400 Bad Request):
        ``{"message": "Invalid type"}`` for any ``type`` not in
        ``{"custom-work-items", "work-items"}``.

    Permissions:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])``
        -- project-level admin, member, or guest can view charts.

    Cross-references:
        * Permission decorator: :func:`plane.app.permissions.allow_permission`
          (``apps/api/plane/app/permissions/base.py``)
        * Chart builder: :func:`plane.utils.build_chart.build_analytics_chart`
          (``apps/api/plane/utils/build_chart.py``)
        * Models read: :class:`plane.db.models.Issue`,
          :class:`plane.db.models.Project`, :class:`plane.db.models.Cycle`,
          :class:`plane.db.models.Module`,
          :class:`plane.db.models.CycleIssue`,
          :class:`plane.db.models.ModuleIssue`
          (``apps/api/plane/db/models/``)
        * URL: ``apps/api/plane/app/urls/analytic.py``
    """

    def work_item_completion_chart(self, project_id, cycle_id=None, module_id=None) -> Dict[str, Any]:
        """Build the completion-trend series for the project / cycle / module scope.

        Cycle and module scopes use the cycle's / module's
        ``start_date`` -> ``end_date`` / ``target_date`` window with
        day-by-day buckets. Project scope buckets by month with
        ``TruncMonth("created_at")`` and zero-fills missing months from
        the project's first-of-month creation date through the current
        month. Returns ``{"data": [], "schema": {}}`` when the scope's
        start date is unset.
        """
        # Get the base queryset
        queryset = (
            Issue.issue_objects.filter(**self.filters["base_filters"])
            .filter(project_id=project_id)
            .select_related("workspace", "state", "parent")
            .prefetch_related("assignees", "labels", "issue_module__module", "issue_cycle__cycle")
        )

        if cycle_id is not None:
            cycle_issues = CycleIssue.objects.filter(**self.filters["base_filters"], cycle_id=cycle_id).values_list(
                "issue_id", flat=True
            )
            cycle = Cycle.objects.filter(id=cycle_id).first()
            if cycle and cycle.start_date:
                start_date = cycle.start_date.date()
                end_date = cycle.end_date.date()
            else:
                return {"data": [], "schema": {}}
            queryset = cycle_issues

        elif module_id is not None:
            module_issues = ModuleIssue.objects.filter(**self.filters["base_filters"], module_id=module_id).values_list(
                "issue_id", flat=True
            )
            module = Module.objects.filter(id=module_id).first()
            if module and module.start_date:
                start_date = module.start_date
                end_date = module.target_date
            else:
                return {"data": [], "schema": {}}
            queryset = module_issues

        else:
            project = Project.objects.filter(id=project_id).first()
            if project.created_at:
                start_date = project.created_at.date().replace(day=1)
            else:
                return {"data": [], "schema": {}}

        if cycle_id or module_id:
            # Get daily stats with optimized query
            daily_stats = (
                queryset.values("created_at__date")
                .annotate(
                    created_count=Count("id"),
                    completed_count=Count("id", filter=Q(issue__state__group="completed")),
                )
                .order_by("created_at__date")
            )

            # Create a dictionary of existing stats with summed counts
            stats_dict = {
                stat["created_at__date"].strftime("%Y-%m-%d"): {
                    "created_count": stat["created_count"],
                    "completed_count": stat["completed_count"],
                }
                for stat in daily_stats
            }

            # Generate data for all days in the range
            data = []
            current_date = start_date
            while current_date <= end_date:
                date_str = current_date.strftime("%Y-%m-%d")
                stats = stats_dict.get(date_str, {"created_count": 0, "completed_count": 0})
                data.append(
                    {
                        "key": date_str,
                        "name": date_str,
                        "count": stats["created_count"] + stats["completed_count"],
                        "completed_issues": stats["completed_count"],
                        "created_issues": stats["created_count"],
                    }
                )
                current_date += timedelta(days=1)
        else:
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

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request: HttpRequest, slug: str, project_id: str) -> Response:
        """Dispatch on ``type`` and return the chart payload.

        ``custom-work-items`` -> :func:`build_analytics_chart`;
        ``work-items`` -> :meth:`work_item_completion_chart`.
        """
        self.initialize_workspace(slug, type="chart")
        type = request.GET.get("type", "projects")
        group_by = request.GET.get("group_by", None)
        x_axis = request.GET.get("x_axis", "PRIORITY")
        cycle_id = request.GET.get("cycle_id", None)
        module_id = request.GET.get("module_id", None)

        if type == "custom-work-items":
            queryset = (
                Issue.issue_objects.filter(**self.filters["base_filters"])
                .filter(project_id=project_id)
                .select_related("workspace", "state", "parent")
                .prefetch_related("assignees", "labels", "issue_module__module", "issue_cycle__cycle")
            )

            # Apply cycle/module filters if present
            if cycle_id is not None:
                cycle_issues = CycleIssue.objects.filter(**self.filters["base_filters"], cycle_id=cycle_id).values_list(
                    "issue_id", flat=True
                )
                queryset = queryset.filter(id__in=cycle_issues)

            elif module_id is not None:
                module_issues = ModuleIssue.objects.filter(
                    **self.filters["base_filters"], module_id=module_id
                ).values_list("issue_id", flat=True)
                queryset = queryset.filter(id__in=module_issues)

            # Apply date range filter if available
            if self.filters["chart_period_range"]:
                start_date, end_date = self.filters["chart_period_range"]
                queryset = queryset.filter(created_at__date__gte=start_date, created_at__date__lte=end_date)

            return Response(
                build_analytics_chart(queryset, x_axis, group_by),
                status=status.HTTP_200_OK,
            )

        elif type == "work-items":
            # Optionally accept cycle_id or module_id as query params
            cycle_id = request.GET.get("cycle_id", None)
            module_id = request.GET.get("module_id", None)

            return Response(
                self.work_item_completion_chart(project_id=project_id, cycle_id=cycle_id, module_id=module_id),
                status=status.HTTP_200_OK,
            )

        return Response({"message": "Invalid type"}, status=status.HTTP_400_BAD_REQUEST)
