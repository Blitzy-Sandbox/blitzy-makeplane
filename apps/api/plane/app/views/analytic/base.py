# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace-scoped analytics endpoints for the Plane web client.

Defines the core workspace analytics surface: ``AnalyticsEndpoint`` for
live chart building, ``AnalyticViewViewset`` for persisted analytic
definitions, ``SavedAnalyticEndpoint`` for replaying a stored analytic
query, ``ExportAnalyticsEndpoint`` for emailed CSV exports,
``DefaultAnalyticsEndpoint`` for the workspace dashboard rollup, and
``ProjectStatsEndpoint`` for per-project totals across the workspace.

Architectural notes:

* These endpoints execute heavy ``.annotate()`` / ``.values()`` /
  ``.aggregate()`` chains; subclasses MAY set ``use_read_replica = True``
  on the parent ``BaseAPIView`` / ``BaseViewSet`` so ``GET`` traffic is
  routed through the PostgreSQL read replica.
* ``ExportAnalyticsEndpoint`` does NOT render the CSV inline -- it
  enqueues :func:`plane.bgtasks.analytic_plot_export.analytic_export_task`
  on the Celery worker (consumed from RabbitMQ; Redis is cache/session
  only per architectural context).
* Permission enforcement is per-method via the ``@allow_permission``
  decorator at ``level="WORKSPACE"`` (admin/member for live charts;
  admin/member/guest for read-only dashboards), with the exception of
  ``AnalyticViewViewset`` which uses ``permission_classes =
  [WorkSpaceAdminPermission]`` (workspace admins only can manage
  saved analytic definitions).
"""

# Django imports
from django.db.models import Count, F, Sum, Q
from django.db.models.functions import ExtractMonth
from django.utils import timezone
from django.db.models.functions import Concat
from django.db.models import Case, When, Value, OuterRef, Func
from django.db import models

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import WorkSpaceAdminPermission
from plane.app.serializers import AnalyticViewSerializer
from plane.app.views.base import BaseAPIView, BaseViewSet
from plane.bgtasks.analytic_plot_export import analytic_export_task
from plane.db.models import (
    AnalyticView,
    Issue,
    Workspace,
    Project,
    ProjectMember,
    Cycle,
    Module,
)

from plane.utils.analytics_plot import build_graph_plot, VALID_ANALYTICS_FIELDS, VALID_YAXIS
from plane.utils.issue_filters import issue_filters
from plane.app.permissions import allow_permission, ROLE


class AnalyticsEndpoint(BaseAPIView):
    """Live analytics chart-builder for a workspace.

    HTTP methods + URL patterns:
        GET /api/workspaces/<slug>/analytics/

    Request body:
        None (GET only) -- all inputs are query parameters listed below.

    Query parameters:
        x_axis (str, required): One of
            :data:`plane.utils.analytics_plot.VALID_ANALYTICS_FIELDS`
            (``state_id``, ``state__group``, ``labels__id``,
            ``assignees__id``, ``estimate_point__value``,
            ``issue_cycle__cycle_id``, ``issue_module__module_id``,
            ``priority``, ``start_date``, ``target_date``, ``created_at``,
            ``completed_at``).
        y_axis (str, required): One of
            :data:`plane.utils.analytics_plot.VALID_YAXIS`
            (``issue_count`` or ``estimate``).
        segment (str, optional): A second dimension drawn from
            ``VALID_ANALYTICS_FIELDS``; must NOT equal ``x_axis``.
        plus issue filter parameters parsed by
        :func:`plane.utils.issue_filters.issue_filters` (e.g., ``priority``,
        ``state``, ``assignees``, ``labels``, ``start_date``,
        ``target_date``, ``cycle``, ``module``).

    Response shape (200 OK):
        ``{"total": int, "distribution": <build_graph_plot output>,
        "extras": {"state_details": [...], "assignee_details": [...],
        "label_details": [...], "cycle_details": [...],
        "module_details": [...]}}``. Each ``*_details`` list is populated
        only when ``x_axis`` or ``segment`` references the matching
        dimension.

    Error responses (400 Bad Request):
        ``{"error": "x-axis and y-axis dimensions are required and the
        values should be valid"}`` when required dimensions are missing
        or invalid; ``{"error": "Both segment and x axis cannot be same
        and segment should be valid"}`` when ``segment`` is invalid.

    Permissions:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")``
        -- workspace admins and members only.

    Cross-references:
        * Permission decorator: :func:`plane.app.permissions.allow_permission`
          (``apps/api/plane/app/permissions/base.py``)
        * Filter helper: :func:`plane.utils.issue_filters.issue_filters`
          (``apps/api/plane/utils/issue_filters.py``)
        * Plot helper: :func:`plane.utils.analytics_plot.build_graph_plot`
          (``apps/api/plane/utils/analytics_plot.py``)
        * Model read: :class:`plane.db.models.Issue`
          (``apps/api/plane/db/models/issue.py``)
        * URL: ``apps/api/plane/app/urls/analytic.py``
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        """Build the live analytics chart payload for the workspace.

        Reads ``x_axis`` / ``y_axis`` / optional ``segment`` plus issue
        filters from the request query string.
        """
        x_axis = request.GET.get("x_axis", False)
        y_axis = request.GET.get("y_axis", False)
        segment = request.GET.get("segment", False)

        # Check for x-axis and y-axis as thery are required parameters
        if not x_axis or not y_axis or x_axis not in VALID_ANALYTICS_FIELDS or y_axis not in VALID_YAXIS:
            return Response(
                {"error": "x-axis and y-axis dimensions are required and the values should be valid"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # If segment is present it cannot be same as x-axis
        if segment and (segment not in VALID_ANALYTICS_FIELDS or x_axis == segment):
            return Response(
                {"error": "Both segment and x axis cannot be same and segment should be valid"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Additional filters that need to be applied
        filters = issue_filters(request.GET, "GET")

        # Get the issues for the workspace with the additional filters applied
        queryset = Issue.issue_objects.filter(workspace__slug=slug, **filters)

        # Get the total issue count
        total_issues = queryset.count()

        # Build the graph payload
        distribution = build_graph_plot(queryset=queryset, x_axis=x_axis, y_axis=y_axis, segment=segment)

        state_details = {}
        if x_axis in ["state_id"] or segment in ["state_id"]:
            state_details = (
                Issue.issue_objects.filter(workspace__slug=slug, **filters)
                .distinct("state_id")
                .order_by("state_id")
                .values("state_id", "state__name", "state__color")
            )

        label_details = {}
        if x_axis in ["labels__id"] or segment in ["labels__id"]:
            label_details = (
                Issue.objects.filter(
                    workspace__slug=slug,
                    **filters,
                    labels__id__isnull=False,
                    label_issue__deleted_at__isnull=True,
                )
                .distinct("labels__id")
                .order_by("labels__id")
                .values("labels__id", "labels__color", "labels__name")
            )

        assignee_details = {}
        if x_axis in ["assignees__id"] or segment in ["assignees__id"]:
            assignee_details = (
                Issue.issue_objects.filter(
                    Q(Q(assignees__avatar__isnull=False) | Q(assignees__avatar_asset__isnull=False)),
                    workspace__slug=slug,
                    **filters,
                )
                .annotate(
                    assignees__avatar_url=Case(
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
                        When(
                            assignees__avatar_asset__isnull=True,
                            then="assignees__avatar",
                        ),
                        default=Value(None),
                        output_field=models.CharField(),
                    )
                )
                .order_by("assignees__id")
                .distinct("assignees__id")
                .values(
                    "assignees__avatar_url",
                    "assignees__display_name",
                    "assignees__first_name",
                    "assignees__last_name",
                    "assignees__id",
                )
            )

        cycle_details = {}
        if x_axis in ["issue_cycle__cycle_id"] or segment in ["issue_cycle__cycle_id"]:
            cycle_details = (
                Issue.issue_objects.filter(
                    workspace__slug=slug,
                    **filters,
                    issue_cycle__cycle_id__isnull=False,
                    issue_cycle__deleted_at__isnull=True,
                )
                .distinct("issue_cycle__cycle_id")
                .order_by("issue_cycle__cycle_id")
                .values("issue_cycle__cycle_id", "issue_cycle__cycle__name")
            )

        module_details = {}
        if x_axis in ["issue_module__module_id"] or segment in ["issue_module__module_id"]:
            module_details = (
                Issue.issue_objects.filter(
                    workspace__slug=slug,
                    **filters,
                    issue_module__module_id__isnull=False,
                    issue_module__deleted_at__isnull=True,
                )
                .distinct("issue_module__module_id")
                .order_by("issue_module__module_id")
                .values("issue_module__module_id", "issue_module__module__name")
            )

        return Response(
            {
                "total": total_issues,
                "distribution": distribution,
                "extras": {
                    "state_details": state_details,
                    "assignee_details": assignee_details,
                    "label_details": label_details,
                    "cycle_details": cycle_details,
                    "module_details": module_details,
                },
            },
            status=status.HTTP_200_OK,
        )


class AnalyticViewViewset(BaseViewSet):
    """Persisted analytic definitions for a workspace (workspace-admin CRUD).

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/analytic-view/
        POST   /api/workspaces/<slug>/analytic-view/
        GET    /api/workspaces/<slug>/analytic-view/<uuid:pk>/
        PATCH  /api/workspaces/<slug>/analytic-view/<uuid:pk>/
        DELETE /api/workspaces/<slug>/analytic-view/<uuid:pk>/

    Request body (POST / PATCH):
        Forwarded to :class:`plane.app.serializers.AnalyticViewSerializer`
        -- typically ``{"name": str, "description": str, "query": dict,
        "query_dict": dict, ...}``. The ``query`` field stores the ORM
        filter kwargs replayed by :class:`SavedAnalyticEndpoint`;
        ``query_dict`` stores ``x_axis`` / ``y_axis`` / ``segment``
        dimensions.

    Response shape:
        :class:`AnalyticViewSerializer` representation of the
        :class:`plane.db.models.AnalyticView` row.

    Permissions:
        ``permission_classes = [WorkSpaceAdminPermission]`` -- declared on
        the class attribute (see
        ``apps/api/plane/app/views/analytic/base.py``). Only workspace
        admins can create, update, or delete saved analytic definitions.
        See :class:`plane.app.permissions.workspace.WorkSpaceAdminPermission`.

    Queryset filter logic:
        :meth:`get_queryset` constrains to ``workspace__slug =
        kwargs["slug"]`` so saved views never cross workspace boundaries.

    Cross-references:
        * Permission: :class:`plane.app.permissions.workspace.WorkSpaceAdminPermission`
          (``apps/api/plane/app/permissions/workspace.py``)
        * Serializer: :class:`plane.app.serializers.AnalyticViewSerializer`
          (``apps/api/plane/app/serializers/analytic.py``)
        * Model: :class:`plane.db.models.AnalyticView`
          (``apps/api/plane/db/models/analytic.py``)
        * URL: ``apps/api/plane/app/urls/analytic.py``
    """

    permission_classes = [WorkSpaceAdminPermission]
    model = AnalyticView
    serializer_class = AnalyticViewSerializer

    def perform_create(self, serializer):
        """Persist the new ``AnalyticView`` with ``workspace_id`` derived from the URL ``slug`` kwarg."""
        workspace = Workspace.objects.get(slug=self.kwargs.get("slug"))
        serializer.save(workspace_id=workspace.id)

    def get_queryset(self):
        """Return ``AnalyticView`` rows for the workspace identified by ``kwargs["slug"]``.

        Delegates filtering to :meth:`filter_queryset`.
        """
        return self.filter_queryset(super().get_queryset().filter(workspace__slug=self.kwargs.get("slug")))


class SavedAnalyticEndpoint(BaseAPIView):
    """Replay a previously saved ``AnalyticView`` query against the current workspace.

    HTTP methods + URL patterns:
        GET /api/workspaces/<slug>/saved-analytic-view/<uuid:analytic_id>/

    Request body:
        None (GET only) -- all inputs come from URL kwargs and query parameters.

    Query parameters:
        segment (str, optional): Override the saved ``query_dict["segment"]``;
            must NOT equal ``x_axis`` and must be a member of
            :data:`plane.utils.analytics_plot.VALID_ANALYTICS_FIELDS`.

    URL parameters:
        slug: The workspace slug.
        analytic_id: The ``AnalyticView.id`` whose ``query`` and ``query_dict``
            are replayed.

    Response shape (200 OK):
        ``{"total": int, "distribution": <build_graph_plot output>}``.

    Error responses (400 Bad Request):
        Same as :class:`AnalyticsEndpoint` -- ``x-axis``/``y-axis``
        validation and ``segment`` validation.

    Permissions:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")``.

    Cross-references:
        * Permission decorator: :func:`plane.app.permissions.allow_permission`
          (``apps/api/plane/app/permissions/base.py``)
        * Plot helper: :func:`plane.utils.analytics_plot.build_graph_plot`
          (``apps/api/plane/utils/analytics_plot.py``)
        * Model: :class:`plane.db.models.AnalyticView`
          (``apps/api/plane/db/models/analytic.py``)
        * URL: ``apps/api/plane/app/urls/analytic.py``
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug, analytic_id):
        """Replay the saved ``AnalyticView`` filter and dimensions.

        Returns the rebuilt distribution + total issue count for the
        workspace identified by ``slug``.
        """
        analytic_view = AnalyticView.objects.get(pk=analytic_id, workspace__slug=slug)

        filter = analytic_view.query
        queryset = Issue.issue_objects.filter(**filter)

        x_axis = analytic_view.query_dict.get("x_axis", False)
        y_axis = analytic_view.query_dict.get("y_axis", False)

        if not x_axis or not y_axis or x_axis not in VALID_ANALYTICS_FIELDS or y_axis not in VALID_YAXIS:
            return Response(
                {"error": "x-axis and y-axis dimensions are required and the values should be valid"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        segment = request.GET.get("segment", False)

        if segment and (segment not in VALID_ANALYTICS_FIELDS or x_axis == segment):
            return Response(
                {"error": "Both segment and x axis cannot be same and segment should be valid"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        distribution = build_graph_plot(queryset=queryset, x_axis=x_axis, y_axis=y_axis, segment=segment)
        total_issues = queryset.count()
        return Response(
            {"total": total_issues, "distribution": distribution},
            status=status.HTTP_200_OK,
        )


class ExportAnalyticsEndpoint(BaseAPIView):
    """Enqueue a Celery task that emails a CSV export of the analytics chart.

    HTTP methods + URL patterns:
        POST /api/workspaces/<slug>/export-analytics/

    Request body (POST):
        x_axis (str, required): One of ``VALID_ANALYTICS_FIELDS``.
        y_axis (str, required): One of ``VALID_YAXIS``.
        segment (str, optional): Must NOT equal ``x_axis``.
        plus arbitrary issue filter fields forwarded through to the task.

    Response shape (200 OK):
        ``{"message": "Once the export is ready it will be emailed to you
        at <user-email>"}``.

    Error responses (400 Bad Request):
        Same dimension-validation errors as :class:`AnalyticsEndpoint`.

    Permissions:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")``.

    Side effects:
        Calls
        :func:`plane.bgtasks.analytic_plot_export.analytic_export_task`
        via ``.delay(email=request.user.email, data=request.data,
        slug=slug)`` -- the actual CSV rendering and email send happen on
        the Celery worker (RabbitMQ-backed; Redis is cache/session only
        per architectural context). The HTTP response returns
        immediately; CSV delivery is asynchronous.

    Cross-references:
        * Permission decorator: :func:`plane.app.permissions.allow_permission`
          (``apps/api/plane/app/permissions/base.py``)
        * Celery task: :func:`plane.bgtasks.analytic_plot_export.analytic_export_task`
          (``apps/api/plane/bgtasks/analytic_plot_export.py``)
        * URL: ``apps/api/plane/app/urls/analytic.py``
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug):
        """Validate the chart dimensions and enqueue the CSV export task.

        Enqueues :func:`analytic_export_task` (Celery via RabbitMQ) to
        email the rendered CSV to ``request.user.email``.
        """
        x_axis = request.data.get("x_axis", False)
        y_axis = request.data.get("y_axis", False)
        segment = request.data.get("segment", False)

        # Check for x-axis and y-axis as thery are required parameters
        if not x_axis or not y_axis or x_axis not in VALID_ANALYTICS_FIELDS or y_axis not in VALID_YAXIS:
            return Response(
                {"error": "x-axis and y-axis dimensions are required and the values should be valid"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # If segment is present it cannot be same as x-axis
        if segment and (segment not in VALID_ANALYTICS_FIELDS or x_axis == segment):
            return Response(
                {"error": "Both segment and x axis cannot be same and segment should be valid"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        analytic_export_task.delay(email=request.user.email, data=request.data, slug=slug)

        return Response(
            {"message": f"Once the export is ready it will be emailed to you at {str(request.user.email)}"},
            status=status.HTTP_200_OK,
        )


class DefaultAnalyticsEndpoint(BaseAPIView):
    """Workspace dashboard rollup: state-group counts, top creators, top closers, monthly completions, estimate totals.

    HTTP methods + URL patterns:
        GET /api/workspaces/<slug>/default-analytics/

    Request body:
        None (GET only) -- all inputs are query parameters listed below.

    Query parameters:
        Issue filter parameters parsed by
        :func:`plane.utils.issue_filters.issue_filters` (e.g., ``project``,
        ``priority``, ``state``, ``assignees``, ``labels``, ``cycle``,
        ``module``, ``start_date``, ``target_date``).

    Response shape (200 OK):
        ``{"total_issues": int,
        "total_issues_classified": [{"state_group": str, "state_count":
        int}, ...],
        "open_issues": int,
        "open_issues_classified": [{"state_group": str, "state_count":
        int}, ...] for state_groups in ["backlog", "unstarted", "started"],
        "issue_completed_month_wise": [{"month": int, "count": int}, ...]
        for the current year,
        "most_issue_created_user": [<top-5 creators with avatar_url>, ...],
        "most_issue_closed_user": [<top-5 closers with avatar_url>, ...],
        "pending_issue_user": [<all pending-assignees with avatar_url>,
        ...],
        "open_estimate_sum": float | None,
        "total_estimate_sum": float | None}``.

    Avatar URL computation:
        For each user list, the response includes a computed
        ``*__avatar_url`` field that is either ``/api/assets/v2/static/<asset>/``
        (when ``avatar_asset`` is set) or the raw ``avatar`` string
        (legacy fallback) or ``None``.

    Permissions:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST],
        level="WORKSPACE")`` -- guests can also view the dashboard.

    Cross-references:
        * Permission decorator: :func:`plane.app.permissions.allow_permission`
          (``apps/api/plane/app/permissions/base.py``)
        * Filter helper: :func:`plane.utils.issue_filters.issue_filters`
          (``apps/api/plane/utils/issue_filters.py``)
        * Models read: :class:`plane.db.models.Issue`,
          :class:`plane.db.models.User`
          (``apps/api/plane/db/models/issue.py``,
          ``apps/api/plane/db/models/user.py``)
        * URL: ``apps/api/plane/app/urls/analytic.py``
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        """Compute the workspace dashboard rollup.

        Returns state-group counts, top creators / closers / pending
        users, monthly completions, and estimate totals.
        """
        filters = issue_filters(request.GET, "GET")
        base_issues = Issue.issue_objects.filter(workspace__slug=slug, **filters)

        total_issues = base_issues.count()

        state_groups = base_issues.annotate(state_group=F("state__group"))

        total_issues_classified = (
            state_groups.values("state_group").annotate(state_count=Count("state_group")).order_by("state_group")
        )

        open_issues_groups = ["backlog", "unstarted", "started"]
        open_issues_queryset = state_groups.filter(state__group__in=open_issues_groups)

        open_issues = open_issues_queryset.count()
        open_issues_classified = (
            open_issues_queryset.values("state_group")
            .annotate(state_count=Count("state_group"))
            .order_by("state_group")
        )

        current_year = timezone.now().year
        issue_completed_month_wise = (
            base_issues.filter(completed_at__year=current_year)
            .annotate(month=ExtractMonth("completed_at"))
            .values("month")
            .annotate(count=Count("*"))
            .order_by("month")
        )

        user_details = [
            "created_by__first_name",
            "created_by__last_name",
            "created_by__display_name",
            "created_by__id",
        ]

        most_issue_created_user = (
            base_issues.exclude(created_by=None)
            .values(*user_details)
            .annotate(count=Count("id"))
            .annotate(
                created_by__avatar_url=Case(
                    # If `avatar_asset` exists, use it to generate the asset URL
                    When(
                        created_by__avatar_asset__isnull=False,
                        then=Concat(
                            Value("/api/assets/v2/static/"),
                            "created_by__avatar_asset",  # Assuming avatar_asset has an id or relevant field
                            Value("/"),
                        ),
                    ),
                    # If `avatar_asset` is None, fall back to using `avatar` field directly
                    When(created_by__avatar_asset__isnull=True, then="created_by__avatar"),
                    default=Value(None),
                    output_field=models.CharField(),
                )
            )
            .order_by("-count")[:5]
        )

        user_assignee_details = [
            "assignees__first_name",
            "assignees__last_name",
            "assignees__display_name",
            "assignees__id",
        ]

        most_issue_closed_user = (
            base_issues.filter(completed_at__isnull=False)
            .exclude(assignees=None)
            .values(*user_assignee_details)
            .annotate(
                assignees__avatar_url=Case(
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
            .annotate(count=Count("id"))
            .order_by("-count")[:5]
        )

        pending_issue_user = (
            base_issues.filter(completed_at__isnull=True)
            .values(*user_assignee_details)
            .annotate(count=Count("id"))
            .annotate(
                assignees__avatar_url=Case(
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
            .order_by("-count")
        )

        open_estimate_sum = open_issues_queryset.aggregate(sum=Sum("point"))["sum"]
        total_estimate_sum = base_issues.aggregate(sum=Sum("point"))["sum"]

        return Response(
            {
                "total_issues": total_issues,
                "total_issues_classified": total_issues_classified,
                "open_issues": open_issues,
                "open_issues_classified": open_issues_classified,
                "issue_completed_month_wise": issue_completed_month_wise,
                "most_issue_created_user": most_issue_created_user,
                "most_issue_closed_user": most_issue_closed_user,
                "pending_issue_user": pending_issue_user,
                "open_estimate_sum": open_estimate_sum,
                "total_estimate_sum": total_estimate_sum,
            },
            status=status.HTTP_200_OK,
        )


class ProjectStatsEndpoint(BaseAPIView):
    """Per-project totals across the workspace (correlated-subquery counts).

    HTTP methods + URL patterns:
        GET /api/workspaces/<slug>/project-stats/

    Request body:
        None (GET only) -- all inputs are query parameters listed below.

    Query parameters:
        fields (str, optional): Comma-separated subset of
            ``{"total_issues", "completed_issues", "total_members",
            "total_cycles", "total_modules"}``. Empty / missing / invalid
            values fall back to the full set.
        project_ids (str, optional): Comma-separated UUIDs to constrain
            the response; defaults to all projects in the workspace.

    Response shape (200 OK):
        Array of ``{"id": UUID, ...requested_field_counts}`` where each
        requested field is an integer count computed via
        :func:`django.db.models.Func` over a correlated
        :func:`django.db.models.OuterRef` subquery. ``completed_issues``
        counts state groups ``"completed"`` AND ``"cancelled"``;
        ``total_members`` counts ``ProjectMember`` rows with
        ``member__is_bot=False`` AND ``is_active=True``.

    Permissions:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST],
        level="WORKSPACE")``.

    Cross-references:
        * Permission decorator: :func:`plane.app.permissions.allow_permission`
          (``apps/api/plane/app/permissions/base.py``)
        * Models read: :class:`plane.db.models.Project`,
          :class:`plane.db.models.Issue`, :class:`plane.db.models.Cycle`,
          :class:`plane.db.models.Module`,
          :class:`plane.db.models.ProjectMember`
          (``apps/api/plane/db/models/``)
        * URL: ``apps/api/plane/app/urls/analytic.py``
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        """Return per-project totals for the requested ``fields`` (default: all five) over the workspace's projects."""
        fields = request.GET.get("fields", "").split(",")
        project_ids = request.GET.get("project_ids", "")

        valid_fields = {
            "total_issues",
            "completed_issues",
            "total_members",
            "total_cycles",
            "total_modules",
        }
        requested_fields = set(filter(None, fields)) & valid_fields

        if not requested_fields:
            requested_fields = valid_fields

        projects = Project.objects.filter(workspace__slug=slug)
        if project_ids:
            projects = projects.filter(id__in=project_ids.split(","))

        annotations = {}
        if "total_issues" in requested_fields:
            annotations["total_issues"] = (
                Issue.issue_objects.filter(project_id=OuterRef("pk"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )

        if "completed_issues" in requested_fields:
            annotations["completed_issues"] = (
                Issue.issue_objects.filter(project_id=OuterRef("pk"), state__group__in=["completed", "cancelled"])
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )

        if "total_cycles" in requested_fields:
            annotations["total_cycles"] = (
                Cycle.objects.filter(project_id=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )

        if "total_modules" in requested_fields:
            annotations["total_modules"] = (
                Module.objects.filter(project_id=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )

        if "total_members" in requested_fields:
            annotations["total_members"] = (
                ProjectMember.objects.filter(project_id=OuterRef("id"), member__is_bot=False, is_active=True)
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )

        projects = projects.annotate(**annotations).values("id", *requested_fields)
        return Response(projects, status=status.HTTP_200_OK)
