# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Cycle archive / unarchive HTTP endpoint and archived-cycle read API.

Defines :class:`CycleArchiveUnarchiveEndpoint`, the DRF ``APIView``
subclass mounted at three URL patterns:

* ``GET    /api/workspaces/<slug>/projects/<project_id>/archived-cycles/``
* ``GET    /api/workspaces/<slug>/projects/<project_id>/archived-cycles/<pk>/``
* ``POST   /api/workspaces/<slug>/projects/<project_id>/cycles/<cycle_id>/archive/``
* ``DELETE /api/workspaces/<slug>/projects/<project_id>/cycles/<cycle_id>/archive/``

Archive semantics: only cycles whose ``end_date`` has passed (completed
cycles) can be archived; archiving stamps ``archived_at = timezone.now()``
and cascades a hard delete on any matching :class:`UserFavorite` rows so
the cycle disappears from users' favorites lists. Unarchiving simply nulls
``archived_at`` without restoring favorites.

The detail-mode ``GET`` enriches the cycle record with per-state issue
counts, per-state estimate-point sums, assignee/label distributions, and a
burndown chart (computed via :func:`plane.utils.analytics_plot.burndown_plot`
when both ``start_date`` and ``end_date`` are set). Cycle status is derived
from the current time relative to those date bounds (CURRENT / UPCOMING /
COMPLETED / DRAFT).
"""

# Django imports
from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.db.models import (
    Case,
    CharField,
    Count,
    Exists,
    F,
    Func,
    OuterRef,
    Prefetch,
    Q,
    UUIDField,
    Value,
    When,
    Subquery,
    Sum,
    FloatField,
)
from django.db.models.functions import Coalesce, Cast, Concat
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response
from plane.app.permissions import allow_permission, ROLE
from plane.db.models import Cycle, UserFavorite, Issue, Label, User, Project
from plane.utils.analytics_plot import burndown_plot

# Module imports
from .. import BaseAPIView


class CycleArchiveUnarchiveEndpoint(BaseAPIView):
    """Archive / unarchive a cycle and read archived-cycle records.

    Resource managed:
        Archived :class:`plane.db.models.Cycle` records (cycles whose
        ``archived_at`` field is non-null) and the archive-state
        transitions that produce them.

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<project_id>/archived-cycles/
        GET    /api/workspaces/<slug>/projects/<project_id>/archived-cycles/<uuid:pk>/
        POST   /api/workspaces/<slug>/projects/<project_id>/cycles/<uuid:cycle_id>/archive/
        DELETE /api/workspaces/<slug>/projects/<project_id>/cycles/<uuid:cycle_id>/archive/

    Request body (POST):
        Empty -- the archive operation requires no fields. The cycle to
        archive is identified entirely by the URL's ``cycle_id`` kwarg.

    Request body (DELETE):
        Empty -- unarchive is identified entirely by the URL's
        ``cycle_id`` kwarg.

    Response shape (GET list):
        Array of dictionaries with the keys: ``id``, ``workspace_id``,
        ``project_id``, ``name``, ``description``, ``start_date``,
        ``end_date``, ``owned_by_id``, ``view_props``, ``sort_order``,
        ``external_source``, ``external_id``, ``progress_snapshot``,
        ``total_issues``, ``is_favorite``, ``cancelled_issues``,
        ``completed_issues``, ``started_issues``, ``unstarted_issues``,
        ``backlog_issues``, ``assignee_ids``, ``status``, ``archived_at``.
        Ordered by ``-is_favorite, -created_at``.

    Response shape (GET detail):
        Single dictionary with the list-mode keys plus ``sub_issues``,
        ``logo_props``, ``completed_estimate_points``,
        ``total_estimate_points``, ``created_by``, and two nested keys:

        * ``estimate_distribution`` -- present (and populated) only when
          the project has an estimate of ``type="points"``. Contains
          ``{"assignees": [...], "labels": [...], "completion_chart": {...}}``.
          The completion chart is filled only when both ``start_date`` and
          ``end_date`` are set on the cycle.
        * ``distribution`` -- always populated. Same shape as
          ``estimate_distribution`` but counts ISSUES rather than
          estimate points.

    Response shape (POST):
        ``{"archived_at": "<iso-datetime>"}`` with HTTP 200.

    Response shape (DELETE):
        Empty body with HTTP 204.

    Permissions:
        permission_classes = [IsAuthenticated]
            (inherited from :class:`plane.app.views.base.BaseAPIView`)

        Per-method via the ``@allow_permission`` decorator:
            * ``get``   -- ROLE.ADMIN, ROLE.MEMBER
            * ``post``  -- ROLE.ADMIN, ROLE.MEMBER
            * ``delete`` -- ROLE.ADMIN, ROLE.MEMBER

        Note: archived-cycle READ is restricted to ADMIN+MEMBER (no
        GUEST), unlike the active-cycle list which permits GUEST. The
        archive/unarchive MUTATIONS are also ADMIN+MEMBER (not
        ADMIN-only) -- per project policy, members can archive cycles
        they did not create as long as the cycle is completed.

    Archive guard:
        ``post`` rejects with HTTP 400 ``{"error": "Only completed cycles
        can be archived"}`` if ``cycle.end_date >= timezone.now()`` --
        i.e., only cycles whose end date has passed may be archived. There
        is no symmetric guard on ``delete``: any archived cycle (or even a
        non-archived cycle, which becomes a no-op) can be unarchived.

    Side effects:
        * ``post``: stamps ``archived_at = timezone.now()`` and hard-deletes
          every :class:`UserFavorite` row pointing at this cycle (so the
          cycle disappears from every user's favorites list).
        * ``delete``: nulls ``archived_at`` (does NOT restore favorites).

    Queryset filter logic (``get_queryset``):
        Restricts to archived cycles (``archived_at__isnull=False``) in
        the current workspace and project where the requesting user is an
        ACTIVE member of the project and the project itself is not
        archived. Heavy annotations follow:

        * ``is_favorite`` -- Exists subquery against UserFavorite.
        * Six per-state issue counts (``total_issues``,
          ``completed_issues``, ``cancelled_issues``, ``started_issues``,
          ``unstarted_issues``, ``backlog_issues``) via distinct Count
          on ``issue_cycle__issue__id`` filtered by state group.
        * Six per-state estimate-point sums (matching the issue counts)
          via Subquery against issues with
          ``estimate_point__estimate__type="points"``.
        * ``status`` -- Case expression yielding ``CURRENT`` /
          ``UPCOMING`` / ``COMPLETED`` / ``DRAFT`` based on ``timezone.now()``
          vs. ``start_date`` / ``end_date``. NOTE: this uses raw
          ``timezone.now()`` (UTC) rather than the project-timezone-aware
          comparison used by :class:`plane.app.views.cycle.base.CycleViewSet`
          -- archived cycles are by definition completed so the
          discrepancy has no practical effect.
        * ``assignee_ids`` -- ArrayAgg of all assignee UUIDs across all
          issues in the cycle.

        Heavy ``.annotate(Count(...))`` aggregation -- read replica
        routing helps when this endpoint is called frequently (subclasses
        of BaseAPIView may set ``use_read_replica = True``).

    Architectural notes:
        * Cycle progress snapshots are written by a Celery task (queued
          via RabbitMQ per the shared architectural context) when a cycle
          is transferred; this endpoint does NOT consult the snapshot --
          it always computes distributions live from the cycle's current
          issues (unlike :class:`CycleAnalyticsEndpoint` which prefers
          the snapshot when present).

    Cross-references:
        * Permission decorator: :func:`plane.app.permissions.allow_permission`
          (``apps/api/plane/app/permissions/base.py``)
        * Burndown helper: :func:`plane.utils.analytics_plot.burndown_plot`
          (``apps/api/plane/utils/analytics_plot.py``)
        * Models: :class:`plane.db.models.Cycle`,
          :class:`plane.db.models.Issue`,
          :class:`plane.db.models.UserFavorite`,
          :class:`plane.db.models.Label`,
          :class:`plane.db.models.User`,
          :class:`plane.db.models.Project`
          (``apps/api/plane/db/models/``)
        * URL: ``apps/api/plane/app/urls/cycle.py``
    """

    def get_queryset(self):
        """Return the archived-cycle queryset for the current workspace/project.

        Annotated with per-state issue counts, estimate-point sums, favorite
        flag, assignee IDs, and derived status (see class docstring for the
        full annotation list).
        """
        favorite_subquery = UserFavorite.objects.filter(
            user=self.request.user,
            entity_type="cycle",
            entity_identifier=OuterRef("pk"),
            project_id=self.kwargs.get("project_id"),
            workspace__slug=self.kwargs.get("slug"),
        )
        backlog_estimate_point = (
            Issue.issue_objects.filter(
                estimate_point__estimate__type="points",
                state__group="backlog",
                issue_cycle__cycle_id=OuterRef("pk"),
                issue_cycle__deleted_at__isnull=True,
            )
            .values("issue_cycle__cycle_id")
            .annotate(backlog_estimate_point=Sum(Cast("estimate_point__value", FloatField())))
            .values("backlog_estimate_point")[:1]
        )
        unstarted_estimate_point = (
            Issue.issue_objects.filter(
                estimate_point__estimate__type="points",
                state__group="unstarted",
                issue_cycle__cycle_id=OuterRef("pk"),
                issue_cycle__deleted_at__isnull=True,
            )
            .values("issue_cycle__cycle_id")
            .annotate(unstarted_estimate_point=Sum(Cast("estimate_point__value", FloatField())))
            .values("unstarted_estimate_point")[:1]
        )
        started_estimate_point = (
            Issue.issue_objects.filter(
                estimate_point__estimate__type="points",
                state__group="started",
                issue_cycle__cycle_id=OuterRef("pk"),
                issue_cycle__deleted_at__isnull=True,
            )
            .values("issue_cycle__cycle_id")
            .annotate(started_estimate_point=Sum(Cast("estimate_point__value", FloatField())))
            .values("started_estimate_point")[:1]
        )
        cancelled_estimate_point = (
            Issue.issue_objects.filter(
                estimate_point__estimate__type="points",
                state__group="cancelled",
                issue_cycle__cycle_id=OuterRef("pk"),
                issue_cycle__deleted_at__isnull=True,
            )
            .values("issue_cycle__cycle_id")
            .annotate(cancelled_estimate_point=Sum(Cast("estimate_point__value", FloatField())))
            .values("cancelled_estimate_point")[:1]
        )
        completed_estimate_point = (
            Issue.issue_objects.filter(
                estimate_point__estimate__type="points",
                state__group="completed",
                issue_cycle__cycle_id=OuterRef("pk"),
                issue_cycle__deleted_at__isnull=True,
            )
            .values("issue_cycle__cycle_id")
            .annotate(completed_estimate_points=Sum(Cast("estimate_point__value", FloatField())))
            .values("completed_estimate_points")[:1]
        )
        total_estimate_point = (
            Issue.issue_objects.filter(
                estimate_point__estimate__type="points",
                issue_cycle__cycle_id=OuterRef("pk"),
                issue_cycle__deleted_at__isnull=True,
            )
            .values("issue_cycle__cycle_id")
            .annotate(total_estimate_points=Sum(Cast("estimate_point__value", FloatField())))
            .values("total_estimate_points")[:1]
        )
        return (
            Cycle.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(archived_at__isnull=False)
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(project__archived_at__isnull=True)
            .select_related("project", "workspace", "owned_by")
            .prefetch_related(
                Prefetch(
                    "issue_cycle__issue__assignees",
                    queryset=User.objects.only("avatar_asset", "first_name", "id").distinct(),
                )
            )
            .prefetch_related(
                Prefetch(
                    "issue_cycle__issue__labels",
                    queryset=Label.objects.only("name", "color", "id").distinct(),
                )
            )
            .annotate(is_favorite=Exists(favorite_subquery))
            .annotate(
                total_issues=Count(
                    "issue_cycle__issue__id",
                    distinct=True,
                    filter=Q(
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__issue__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                completed_issues=Count(
                    "issue_cycle__issue__id",
                    distinct=True,
                    filter=Q(
                        issue_cycle__issue__state__group="completed",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__issue__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                cancelled_issues=Count(
                    "issue_cycle__issue__id",
                    distinct=True,
                    filter=Q(
                        issue_cycle__issue__state__group="cancelled",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__issue__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                started_issues=Count(
                    "issue_cycle__issue__id",
                    distinct=True,
                    filter=Q(
                        issue_cycle__issue__state__group="started",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__issue__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                unstarted_issues=Count(
                    "issue_cycle__issue__id",
                    distinct=True,
                    filter=Q(
                        issue_cycle__issue__state__group="unstarted",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__issue__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                backlog_issues=Count(
                    "issue_cycle__issue__id",
                    distinct=True,
                    filter=Q(
                        issue_cycle__issue__state__group="backlog",
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__issue__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                status=Case(
                    When(
                        Q(start_date__lte=timezone.now()) & Q(end_date__gte=timezone.now()),
                        then=Value("CURRENT"),
                    ),
                    When(start_date__gt=timezone.now(), then=Value("UPCOMING")),
                    When(end_date__lt=timezone.now(), then=Value("COMPLETED")),
                    When(
                        Q(start_date__isnull=True) & Q(end_date__isnull=True),
                        then=Value("DRAFT"),
                    ),
                    default=Value("DRAFT"),
                    output_field=CharField(),
                )
            )
            .annotate(
                assignee_ids=Coalesce(
                    ArrayAgg(
                        "issue_cycle__issue__assignees__id",
                        distinct=True,
                        filter=~Q(issue_cycle__issue__assignees__id__isnull=True),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                )
            )
            .annotate(
                backlog_estimate_points=Coalesce(
                    Subquery(backlog_estimate_point),
                    Value(0, output_field=FloatField()),
                )
            )
            .annotate(
                unstarted_estimate_points=Coalesce(
                    Subquery(unstarted_estimate_point),
                    Value(0, output_field=FloatField()),
                )
            )
            .annotate(
                started_estimate_points=Coalesce(
                    Subquery(started_estimate_point),
                    Value(0, output_field=FloatField()),
                )
            )
            .annotate(
                cancelled_estimate_points=Coalesce(
                    Subquery(cancelled_estimate_point),
                    Value(0, output_field=FloatField()),
                )
            )
            .annotate(
                completed_estimate_points=Coalesce(
                    Subquery(completed_estimate_point),
                    Value(0, output_field=FloatField()),
                )
            )
            .annotate(
                total_estimate_points=Coalesce(Subquery(total_estimate_point), Value(0, output_field=FloatField()))
            )
            .order_by("-is_favorite", "name")
            .distinct()
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id, pk=None):
        """List archived cycles or retrieve a single archived cycle by ``pk``.

        Detail mode (``pk`` provided) adds the full estimate/issue
        distribution and a burndown completion chart.
        """
        if pk is None:
            queryset = (
                self.get_queryset().values(
                    # necessary fields
                    "id",
                    "workspace_id",
                    "project_id",
                    # model fields
                    "name",
                    "description",
                    "start_date",
                    "end_date",
                    "owned_by_id",
                    "view_props",
                    "sort_order",
                    "external_source",
                    "external_id",
                    "progress_snapshot",
                    # meta fields
                    "total_issues",
                    "is_favorite",
                    "cancelled_issues",
                    "completed_issues",
                    "started_issues",
                    "unstarted_issues",
                    "backlog_issues",
                    "assignee_ids",
                    "status",
                    "archived_at",
                )
            ).order_by("-is_favorite", "-created_at")
            return Response(queryset, status=status.HTTP_200_OK)
        else:
            queryset = self.get_queryset().filter(archived_at__isnull=False).filter(pk=pk)
            data = (
                self.get_queryset()
                .filter(pk=pk)
                .annotate(
                    sub_issues=Issue.issue_objects.filter(
                        project_id=self.kwargs.get("project_id"),
                        parent__isnull=False,
                        issue_cycle__cycle_id=pk,
                        issue_cycle__deleted_at__isnull=True,
                    )
                    .order_by()
                    .annotate(count=Func(F("id"), function="Count"))
                    .values("count")
                )
                .values(
                    # necessary fields
                    "id",
                    "workspace_id",
                    "project_id",
                    # model fields
                    "name",
                    "description",
                    "start_date",
                    "end_date",
                    "owned_by_id",
                    "view_props",
                    "sort_order",
                    "external_source",
                    "external_id",
                    "progress_snapshot",
                    "sub_issues",
                    "logo_props",
                    # meta fields
                    "completed_estimate_points",
                    "total_estimate_points",
                    "is_favorite",
                    "total_issues",
                    "cancelled_issues",
                    "completed_issues",
                    "started_issues",
                    "unstarted_issues",
                    "backlog_issues",
                    "assignee_ids",
                    "status",
                    "created_by",
                    "archived_at",
                )
                .first()
            )
            queryset = queryset.first()

            estimate_type = Project.objects.filter(
                workspace__slug=slug,
                pk=project_id,
                estimate__isnull=False,
                estimate__type="points",
            ).exists()

            data["estimate_distribution"] = {}
            if estimate_type:
                assignee_distribution = (
                    Issue.issue_objects.filter(
                        issue_cycle__cycle_id=pk,
                        issue_cycle__deleted_at__isnull=True,
                        workspace__slug=slug,
                        project_id=project_id,
                    )
                    .annotate(display_name=F("assignees__display_name"))
                    .annotate(assignee_id=F("assignees__id"))
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
                            When(
                                assignees__avatar_asset__isnull=True,
                                then="assignees__avatar",
                            ),
                            default=Value(None),
                            output_field=models.CharField(),
                        )
                    )
                    .values("display_name", "assignee_id", "avatar_url")
                    .annotate(total_estimates=Sum(Cast("estimate_point__value", FloatField())))
                    .annotate(
                        completed_estimates=Sum(
                            Cast("estimate_point__value", FloatField()),
                            filter=Q(
                                completed_at__isnull=False,
                                archived_at__isnull=True,
                                is_draft=False,
                            ),
                        )
                    )
                    .annotate(
                        pending_estimates=Sum(
                            Cast("estimate_point__value", FloatField()),
                            filter=Q(
                                completed_at__isnull=True,
                                archived_at__isnull=True,
                                is_draft=False,
                            ),
                        )
                    )
                    .order_by("display_name")
                )

                label_distribution = (
                    Issue.issue_objects.filter(
                        issue_cycle__cycle_id=pk,
                        issue_cycle__deleted_at__isnull=True,
                        workspace__slug=slug,
                        project_id=project_id,
                    )
                    .annotate(label_name=F("labels__name"))
                    .annotate(color=F("labels__color"))
                    .annotate(label_id=F("labels__id"))
                    .values("label_name", "color", "label_id")
                    .annotate(total_estimates=Sum(Cast("estimate_point__value", FloatField())))
                    .annotate(
                        completed_estimates=Sum(
                            Cast("estimate_point__value", FloatField()),
                            filter=Q(
                                completed_at__isnull=False,
                                archived_at__isnull=True,
                                is_draft=False,
                            ),
                        )
                    )
                    .annotate(
                        pending_estimates=Sum(
                            Cast("estimate_point__value", FloatField()),
                            filter=Q(
                                completed_at__isnull=True,
                                archived_at__isnull=True,
                                is_draft=False,
                            ),
                        )
                    )
                    .order_by("label_name")
                )
                data["estimate_distribution"] = {
                    "assignees": assignee_distribution,
                    "labels": label_distribution,
                    "completion_chart": {},
                }

                if data["start_date"] and data["end_date"]:
                    data["estimate_distribution"]["completion_chart"] = burndown_plot(
                        queryset=queryset,
                        slug=slug,
                        project_id=project_id,
                        plot_type="points",
                        cycle_id=pk,
                    )

            # Assignee Distribution
            assignee_distribution = (
                Issue.issue_objects.filter(
                    issue_cycle__cycle_id=pk,
                    issue_cycle__deleted_at__isnull=True,
                    workspace__slug=slug,
                    project_id=project_id,
                )
                .annotate(first_name=F("assignees__first_name"))
                .annotate(last_name=F("assignees__last_name"))
                .annotate(assignee_id=F("assignees__id"))
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
                        When(
                            assignees__avatar_asset__isnull=True,
                            then="assignees__avatar",
                        ),
                        default=Value(None),
                        output_field=models.CharField(),
                    )
                )
                .annotate(display_name=F("assignees__display_name"))
                .values(
                    "first_name",
                    "last_name",
                    "assignee_id",
                    "avatar_url",
                    "display_name",
                )
                .annotate(total_issues=Count("id", filter=Q(archived_at__isnull=True, is_draft=False)))
                .annotate(
                    completed_issues=Count(
                        "id",
                        filter=Q(
                            completed_at__isnull=False,
                            archived_at__isnull=True,
                            is_draft=False,
                        ),
                    )
                )
                .annotate(
                    pending_issues=Count(
                        "id",
                        filter=Q(
                            completed_at__isnull=True,
                            archived_at__isnull=True,
                            is_draft=False,
                        ),
                    )
                )
                .order_by("first_name", "last_name")
            )

            # Label Distribution
            label_distribution = (
                Issue.issue_objects.filter(
                    issue_cycle__cycle_id=pk,
                    issue_cycle__deleted_at__isnull=True,
                    workspace__slug=slug,
                    project_id=project_id,
                )
                .annotate(label_name=F("labels__name"))
                .annotate(color=F("labels__color"))
                .annotate(label_id=F("labels__id"))
                .values("label_name", "color", "label_id")
                .annotate(total_issues=Count("id", filter=Q(archived_at__isnull=True, is_draft=False)))
                .annotate(
                    completed_issues=Count(
                        "id",
                        filter=Q(
                            completed_at__isnull=False,
                            archived_at__isnull=True,
                            is_draft=False,
                        ),
                    )
                )
                .annotate(
                    pending_issues=Count(
                        "id",
                        filter=Q(
                            completed_at__isnull=True,
                            archived_at__isnull=True,
                            is_draft=False,
                        ),
                    )
                )
                .order_by("label_name")
            )

            data["distribution"] = {
                "assignees": assignee_distribution,
                "labels": label_distribution,
                "completion_chart": {},
            }

            if queryset.start_date and queryset.end_date:
                data["distribution"]["completion_chart"] = burndown_plot(
                    queryset=queryset,
                    slug=slug,
                    project_id=project_id,
                    plot_type="issues",
                    cycle_id=pk,
                )

            return Response(data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, cycle_id):
        """Archive a completed cycle by stamping ``archived_at = timezone.now()``.

        Rejects with HTTP 400 when ``cycle.end_date >= timezone.now()`` and
        cascades a hard delete of every :class:`UserFavorite` row pointing
        at the cycle.
        """
        cycle = Cycle.objects.get(pk=cycle_id, project_id=project_id, workspace__slug=slug)

        if cycle.end_date >= timezone.now():
            return Response(
                {"error": "Only completed cycles can be archived"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        cycle.archived_at = timezone.now()
        cycle.save()
        UserFavorite.objects.filter(
            entity_type="cycle",
            entity_identifier=cycle_id,
            project_id=project_id,
            workspace__slug=slug,
        ).delete()
        return Response({"archived_at": str(cycle.archived_at)}, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def delete(self, request, slug, project_id, cycle_id):
        """Unarchive a cycle by nulling its ``archived_at`` field.

        Does not restore :class:`UserFavorite` rows deleted when the cycle
        was archived.
        """
        cycle = Cycle.objects.get(pk=cycle_id, project_id=project_id, workspace__slug=slug)
        cycle.archived_at = None
        cycle.save()
        return Response(status=status.HTTP_204_NO_CONTENT)
