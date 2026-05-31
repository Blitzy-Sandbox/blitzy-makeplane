# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Module archive / unarchive HTTP endpoint and archived-module read API.

Defines :class:`ModuleArchiveUnarchiveEndpoint`, the DRF ``APIView``
subclass mounted at four URL patterns:

* ``GET    /api/workspaces/<slug>/projects/<project_id>/archived-modules/``
* ``GET    /api/workspaces/<slug>/projects/<project_id>/archived-modules/<pk>/``
* ``POST   /api/workspaces/<slug>/projects/<project_id>/modules/<module_id>/archive/``
* ``DELETE /api/workspaces/<slug>/projects/<project_id>/modules/<module_id>/archive/``

Archive semantics: only modules whose ``status`` is ``"completed"`` or
``"cancelled"`` can be archived; archiving stamps ``archived_at =
timezone.now()`` and cascades a hard delete on any matching
:class:`UserFavorite` rows so the module disappears from users' favorites
lists. Unarchiving simply nulls ``archived_at`` without restoring
favorites.

The detail-mode ``GET`` enriches the module record with per-state issue
counts, per-state estimate-point sums, assignee/label distributions, and
a burndown chart (computed via
:func:`plane.utils.analytics_plot.burndown_plot` when both ``start_date``
and ``target_date`` are set).
"""

from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField
from django.db.models import (
    Count,
    Exists,
    F,
    Func,
    IntegerField,
    OuterRef,
    Prefetch,
    Q,
    Subquery,
    UUIDField,
    Value,
    Sum,
    FloatField,
    Case,
    When,
)
from django.db.models.functions import Coalesce, Cast, Concat
from django.utils import timezone
from django.db import models

# Third party imports
from rest_framework import status
from rest_framework.response import Response
from plane.app.permissions import ProjectEntityPermission
from plane.app.serializers import ModuleDetailSerializer
from plane.db.models import Issue, Module, ModuleLink, UserFavorite, Project
from plane.utils.analytics_plot import burndown_plot
from plane.utils.timezone_converter import user_timezone_converter


# Module imports
from .. import BaseAPIView


class ModuleArchiveUnarchiveEndpoint(BaseAPIView):
    """Archive / unarchive a module and read archived-module records.

    Resource managed:
        Archived :class:`plane.db.models.Module` records (modules whose
        ``archived_at`` field is non-null) and the archive-state
        transitions that produce them. Modules are project-scoped
        cross-cycle issue groupings with a ``status`` enum, a lead user,
        a member list, and optional ``start_date`` / ``target_date``.

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<uuid:project_id>/archived-modules/
        GET    /api/workspaces/<slug>/projects/<uuid:project_id>/archived-modules/<uuid:pk>/
        POST   /api/workspaces/<slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/archive/
        DELETE /api/workspaces/<slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/archive/

        The same view class is mounted at both ``archived-modules/...``
        (for read access, URL kwarg ``pk``) and ``modules/<id>/archive/``
        (for archive mutation, URL kwarg ``module_id``). The class
        dispatches to ``get`` / ``post`` / ``delete`` based on HTTP
        method.

    Request body (POST):
        Empty -- the archive operation requires no fields. The module to
        archive is identified entirely by the URL's ``module_id`` kwarg.

    Request body (DELETE):
        Empty -- unarchive is identified entirely by the URL's
        ``module_id`` kwarg.

    Response shape (GET list):
        Array of dictionaries with the keys: ``id``, ``workspace_id``,
        ``project_id``, ``name``, ``description``, ``description_text``,
        ``description_html``, ``start_date``, ``target_date``,
        ``status``, ``lead_id``, ``member_ids``, ``view_props``,
        ``sort_order``, ``external_source``, ``external_id``,
        ``total_issues``, ``is_favorite``, ``cancelled_issues``,
        ``completed_issues``, ``started_issues``, ``unstarted_issues``,
        ``backlog_issues``, ``created_at``, ``updated_at``,
        ``archived_at``. ``created_at`` and ``updated_at`` are converted
        to the requesting user's timezone via
        :func:`plane.utils.timezone_converter.user_timezone_converter`.
        Ordered by ``-is_favorite, -created_at``.

    Response shape (GET detail):
        :class:`plane.app.serializers.ModuleDetailSerializer` output --
        all list-mode keys plus ``sub_issues``, six estimate-point sums
        (``backlog_estimate_points``, ``unstarted_estimate_points``,
        ``started_estimate_points``, ``cancelled_estimate_points``,
        ``completed_estimate_points``, ``total_estimate_points``), the
        preloaded ``link_module`` relation, plus two computed nested
        keys:

        * ``estimate_distribution`` -- present (and populated) only when
          the project has an estimate of ``type="points"``. Contains
          ``{"assignees": [...], "labels": [...], "completion_chart": {...}}``.
          The completion chart is filled only when both ``start_date``
          and ``target_date`` are set on the module.
        * ``distribution`` -- always populated. Same shape as
          ``estimate_distribution`` but counts ISSUES rather than
          estimate points.

    Response shape (POST):
        ``{"archived_at": "<iso-datetime>"}`` with HTTP 200.

    Response shape (DELETE):
        Empty body with HTTP 204.

    Permissions:
        permission_classes = [ProjectEntityPermission]

        ProjectEntityPermission requires the requesting user to be an
        active project member; for unsafe methods (POST / DELETE) the
        user must additionally have ROLE.ADMIN or ROLE.MEMBER (GUEST is
        rejected). See :class:`plane.app.permissions.project.ProjectEntityPermission`.

    Archive guard:
        ``post`` rejects with HTTP 400 ``{"error": "Only completed or
        cancelled modules can be archived"}`` if ``module.status`` is
        not in ``["completed", "cancelled"]``. Unlike
        :class:`plane.app.views.cycle.archive.CycleArchiveUnarchiveEndpoint`
        which uses a date-based completion check, module archive uses
        the explicit ``status`` enum -- modules with a ``"completed"``
        or ``"cancelled"`` status (regardless of date bounds) may be
        archived. There is no symmetric guard on ``delete``: any
        archived module (or even a non-archived module, which becomes a
        no-op save) can be unarchived.

    Side effects:
        * ``post``: stamps ``archived_at = timezone.now()`` and
          hard-deletes every :class:`UserFavorite` row pointing at this
          module (so the module disappears from every user's favorites
          list).
        * ``delete``: nulls ``archived_at`` (does NOT restore UserFavorite
          rows deleted on archive).

    Queryset filter logic (``get_queryset``):
        Restricts to archived modules (``archived_at__isnull=False``)
        in the URL's workspace (``workspace__slug``) and project
        (``project_id``). Annotations:

        * ``is_favorite`` -- Exists subquery against UserFavorite
          (per-user favorite flag).
        * Six per-state issue counts (``total_issues``,
          ``completed_issues``, ``cancelled_issues``, ``started_issues``,
          ``unstarted_issues``, ``backlog_issues``) via Count subqueries
          on ``Issue.issue_objects`` joined through ``issue_module``
          filtered by ``state__group``. The ``issue_module__deleted_at__isnull=True``
          filter excludes soft-deleted ``ModuleIssue`` rows.
        * Six per-state estimate-point sums via Subquery against
          ``Issue.issue_objects`` filtered by
          ``estimate_point__estimate__type="points"`` (T-shirt sizes
          and other estimate types are excluded).
        * ``member_ids`` -- ArrayAgg of distinct member UUIDs across
          the module's ``ModuleMember`` rows (filter excludes null IDs).
        * ``select_related("workspace", "project", "lead")`` plus
          ``prefetch_related`` on ``members`` and ``link_module``
          minimize downstream N+1 queries.

        Ordered by ``-is_favorite, -created_at``.

    Architectural notes:
        * Module aggregations are heavy -- read replica routing helps
          when ``use_read_replica = True`` is configured on the viewset
          (currently inherited as ``False`` from ``BaseAPIView``).
        * No Celery tasks are queued from this endpoint -- archive /
          unarchive are synchronous DB writes only (unlike the main
          :class:`ModuleViewSet` which queues ``model_activity`` and
          ``issue_activity`` Celery tasks via RabbitMQ).
    """

    permission_classes = [ProjectEntityPermission]

    def get_queryset(self):
        """Return the archived-module queryset for the current workspace/project.

        Annotated with per-state issue counts, estimate-point sums,
        favorite flag, and member IDs. Restricted to modules where
        ``archived_at`` is non-null, ordered by ``-is_favorite,
        -created_at``.
        """
        favorite_subquery = UserFavorite.objects.filter(
            user=self.request.user,
            entity_type="module",
            entity_identifier=OuterRef("pk"),
            project_id=self.kwargs.get("project_id"),
            workspace__slug=self.kwargs.get("slug"),
        )
        cancelled_issues = (
            Issue.issue_objects.filter(
                state__group="cancelled",
                issue_module__module_id=OuterRef("pk"),
                issue_module__deleted_at__isnull=True,
            )
            .values("issue_module__module_id")
            .annotate(cnt=Count("pk"))
            .values("cnt")
        )
        completed_issues = (
            Issue.issue_objects.filter(
                state__group="completed",
                issue_module__module_id=OuterRef("pk"),
                issue_module__deleted_at__isnull=True,
            )
            .values("issue_module__module_id")
            .annotate(cnt=Count("pk"))
            .values("cnt")
        )
        started_issues = (
            Issue.issue_objects.filter(
                state__group="started",
                issue_module__module_id=OuterRef("pk"),
                issue_module__deleted_at__isnull=True,
            )
            .values("issue_module__module_id")
            .annotate(cnt=Count("pk"))
            .values("cnt")
        )
        unstarted_issues = (
            Issue.issue_objects.filter(
                state__group="unstarted",
                issue_module__module_id=OuterRef("pk"),
                issue_module__deleted_at__isnull=True,
            )
            .values("issue_module__module_id")
            .annotate(cnt=Count("pk"))
            .values("cnt")
        )
        backlog_issues = (
            Issue.issue_objects.filter(
                state__group="backlog",
                issue_module__module_id=OuterRef("pk"),
                issue_module__deleted_at__isnull=True,
            )
            .values("issue_module__module_id")
            .annotate(cnt=Count("pk"))
            .values("cnt")
        )
        total_issues = (
            Issue.issue_objects.filter(
                issue_module__module_id=OuterRef("pk"),
                issue_module__deleted_at__isnull=True,
            )
            .values("issue_module__module_id")
            .annotate(cnt=Count("pk"))
            .values("cnt")
        )
        completed_estimate_point = (
            Issue.issue_objects.filter(
                estimate_point__estimate__type="points",
                state__group="completed",
                issue_module__module_id=OuterRef("pk"),
                issue_module__deleted_at__isnull=True,
            )
            .values("issue_module__module_id")
            .annotate(completed_estimate_points=Sum(Cast("estimate_point__value", FloatField())))
            .values("completed_estimate_points")[:1]
        )

        total_estimate_point = (
            Issue.issue_objects.filter(
                estimate_point__estimate__type="points",
                issue_module__module_id=OuterRef("pk"),
                issue_module__deleted_at__isnull=True,
            )
            .values("issue_module__module_id")
            .annotate(total_estimate_points=Sum(Cast("estimate_point__value", FloatField())))
            .values("total_estimate_points")[:1]
        )
        backlog_estimate_point = (
            Issue.issue_objects.filter(
                estimate_point__estimate__type="points",
                state__group="backlog",
                issue_module__module_id=OuterRef("pk"),
                issue_module__deleted_at__isnull=True,
            )
            .values("issue_module__module_id")
            .annotate(backlog_estimate_point=Sum(Cast("estimate_point__value", FloatField())))
            .values("backlog_estimate_point")[:1]
        )
        unstarted_estimate_point = (
            Issue.issue_objects.filter(
                estimate_point__estimate__type="points",
                state__group="unstarted",
                issue_module__module_id=OuterRef("pk"),
                issue_module__deleted_at__isnull=True,
            )
            .values("issue_module__module_id")
            .annotate(unstarted_estimate_point=Sum(Cast("estimate_point__value", FloatField())))
            .values("unstarted_estimate_point")[:1]
        )
        started_estimate_point = (
            Issue.issue_objects.filter(
                estimate_point__estimate__type="points",
                state__group="started",
                issue_module__module_id=OuterRef("pk"),
                issue_module__deleted_at__isnull=True,
            )
            .values("issue_module__module_id")
            .annotate(started_estimate_point=Sum(Cast("estimate_point__value", FloatField())))
            .values("started_estimate_point")[:1]
        )
        cancelled_estimate_point = (
            Issue.issue_objects.filter(
                estimate_point__estimate__type="points",
                state__group="cancelled",
                issue_module__module_id=OuterRef("pk"),
                issue_module__deleted_at__isnull=True,
            )
            .values("issue_module__module_id")
            .annotate(cancelled_estimate_point=Sum(Cast("estimate_point__value", FloatField())))
            .values("cancelled_estimate_point")[:1]
        )
        return (
            Module.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(archived_at__isnull=False)
            .annotate(is_favorite=Exists(favorite_subquery))
            .select_related("workspace", "project", "lead")
            .prefetch_related("members")
            .prefetch_related(
                Prefetch(
                    "link_module",
                    queryset=ModuleLink.objects.select_related("module", "created_by"),
                )
            )
            .annotate(
                completed_issues=Coalesce(
                    Subquery(completed_issues[:1]),
                    Value(0, output_field=IntegerField()),
                )
            )
            .annotate(
                cancelled_issues=Coalesce(
                    Subquery(cancelled_issues[:1]),
                    Value(0, output_field=IntegerField()),
                )
            )
            .annotate(started_issues=Coalesce(Subquery(started_issues[:1]), Value(0, output_field=IntegerField())))
            .annotate(
                unstarted_issues=Coalesce(
                    Subquery(unstarted_issues[:1]),
                    Value(0, output_field=IntegerField()),
                )
            )
            .annotate(backlog_issues=Coalesce(Subquery(backlog_issues[:1]), Value(0, output_field=IntegerField())))
            .annotate(total_issues=Coalesce(Subquery(total_issues[:1]), Value(0, output_field=IntegerField())))
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
            .annotate(
                member_ids=Coalesce(
                    ArrayAgg(
                        "members__id",
                        distinct=True,
                        filter=~Q(members__id__isnull=True),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                )
            )
            .order_by("-is_favorite", "-created_at")
        )

    def get(self, request, slug, project_id, pk=None):
        """List archived modules or retrieve a single archived module by ``pk``.

        Detail mode (``pk`` provided) adds the full estimate/issue
        assignee/label distributions plus a burndown ``completion_chart``
        (when both ``start_date`` and ``target_date`` are set).
        """
        if pk is None:
            queryset = self.get_queryset()
            modules = queryset.values(  # Required fields
                "id",
                "workspace_id",
                "project_id",
                # Model fields
                "name",
                "description",
                "description_text",
                "description_html",
                "start_date",
                "target_date",
                "status",
                "lead_id",
                "member_ids",
                "view_props",
                "sort_order",
                "external_source",
                "external_id",
                # computed fields
                "total_issues",
                "is_favorite",
                "cancelled_issues",
                "completed_issues",
                "started_issues",
                "unstarted_issues",
                "backlog_issues",
                "created_at",
                "updated_at",
                "archived_at",
            )
            datetime_fields = ["created_at", "updated_at"]
            modules = user_timezone_converter(modules, datetime_fields, request.user.user_timezone)
            return Response(modules, status=status.HTTP_200_OK)
        else:
            queryset = (
                self.get_queryset()
                .filter(pk=pk)
                .annotate(
                    sub_issues=Issue.issue_objects.filter(
                        project_id=self.kwargs.get("project_id"),
                        parent__isnull=False,
                        issue_module__module_id=pk,
                        issue_module__deleted_at__isnull=True,
                    )
                    .order_by()
                    .annotate(count=Func(F("id"), function="Count"))
                    .values("count")
                )
            )

            estimate_type = Project.objects.filter(
                workspace__slug=slug,
                pk=project_id,
                estimate__isnull=False,
                estimate__type="points",
            ).exists()

            data = ModuleDetailSerializer(queryset.first()).data
            modules = queryset.first()

            data["estimate_distribution"] = {}

            if estimate_type:
                assignee_distribution = (
                    Issue.issue_objects.filter(
                        issue_module__module_id=pk,
                        issue_module__deleted_at__isnull=True,
                        workspace__slug=slug,
                        project_id=project_id,
                    )
                    .annotate(first_name=F("assignees__first_name"))
                    .annotate(last_name=F("assignees__last_name"))
                    .annotate(assignee_id=F("assignees__id"))
                    .annotate(display_name=F("assignees__display_name"))
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
                    .values(
                        "first_name",
                        "last_name",
                        "assignee_id",
                        "avatar_url",
                        "display_name",
                    )
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
                    .order_by("first_name", "last_name")
                )

                label_distribution = (
                    Issue.issue_objects.filter(
                        issue_module__module_id=pk,
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
                data["estimate_distribution"]["assignees"] = assignee_distribution
                data["estimate_distribution"]["labels"] = label_distribution

                if modules and modules.start_date and modules.target_date:
                    data["estimate_distribution"]["completion_chart"] = burndown_plot(
                        queryset=modules,
                        slug=slug,
                        project_id=project_id,
                        plot_type="points",
                        module_id=pk,
                    )

            assignee_distribution = (
                Issue.issue_objects.filter(
                    issue_module__module_id=pk,
                    issue_module__deleted_at__isnull=True,
                    workspace__slug=slug,
                    project_id=project_id,
                )
                .annotate(first_name=F("assignees__first_name"))
                .annotate(last_name=F("assignees__last_name"))
                .annotate(assignee_id=F("assignees__id"))
                .annotate(display_name=F("assignees__display_name"))
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

            label_distribution = (
                Issue.issue_objects.filter(
                    issue_module__module_id=pk,
                    issue_module__deleted_at__isnull=True,
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
            if modules and modules.start_date and modules.target_date:
                data["distribution"]["completion_chart"] = burndown_plot(
                    queryset=modules,
                    slug=slug,
                    project_id=project_id,
                    plot_type="issues",
                    module_id=pk,
                )

            return Response(data, status=status.HTTP_200_OK)

    def post(self, request, slug, project_id, module_id):
        """Archive a completed or cancelled module by stamping ``archived_at``.

        Rejects with HTTP 400 when ``module.status`` is not in
        ``["completed", "cancelled"]``; on success, hard-deletes every
        matching :class:`UserFavorite` row so the module disappears from
        every user's favorites list.
        """
        module = Module.objects.get(pk=module_id, project_id=project_id, workspace__slug=slug)
        if module.status not in ["completed", "cancelled"]:
            return Response(
                {"error": "Only completed or cancelled modules can be archived"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        module.archived_at = timezone.now()
        module.save()
        UserFavorite.objects.filter(
            entity_type="module",
            entity_identifier=module_id,
            project_id=project_id,
            workspace__slug=slug,
        ).delete()
        return Response({"archived_at": str(module.archived_at)}, status=status.HTTP_200_OK)

    def delete(self, request, slug, project_id, module_id):
        """Unarchive a module by nulling its ``archived_at`` field.

        Does not restore :class:`UserFavorite` rows deleted when the
        module was archived; users who previously favorited the module
        must re-favorite it after unarchive.
        """
        module = Module.objects.get(pk=module_id, project_id=project_id, workspace__slug=slug)
        module.archived_at = None
        module.save()
        return Response(status=status.HTTP_204_NO_CONTENT)
