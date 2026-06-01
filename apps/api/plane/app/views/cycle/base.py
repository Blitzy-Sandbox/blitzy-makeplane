# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Cycle CRUD, favorites, transfer, progress, analytics, and user preferences endpoints.

This module defines the seven DRF views that constitute Plane's main
cycle API surface, all mounted at
``/api/workspaces/<slug>/projects/<project_id>/cycles/...`` (the archive /
unarchive subset lives in :mod:`plane.app.views.cycle.archive`; the
cycle-issue membership in :mod:`plane.app.views.cycle.issue`):

* :class:`CycleViewSet` -- main ``ModelViewSet`` for cycle CRUD.
* :class:`CycleDateCheckEndpoint` -- POST validator that flags
  prospective ``start_date`` / ``end_date`` ranges overlapping any
  existing cycle in the project.
* :class:`CycleFavoriteViewSet` -- toggles per-user favorite flag on
  cycles via :class:`plane.db.models.UserFavorite`.
* :class:`TransferCycleIssueEndpoint` -- moves an active cycle's
  uncompleted issues to a successor cycle, persisting the source cycle's
  ``progress_snapshot`` for downstream analytics.
* :class:`CycleUserPropertiesEndpoint` -- read / patch the requesting
  user's cycle filter and display preferences
  (:class:`plane.db.models.CycleUserProperties`).
* :class:`CycleProgressEndpoint` -- aggregate cycle progress: per-state
  issue counts and per-state estimate-point sums. Reads the cycle's
  ``progress_snapshot`` for completed cycles (snapshot is written by a
  Celery task at cycle transfer / completion) and falls back to a live
  ``.count()`` aggregation otherwise.
* :class:`CycleAnalyticsEndpoint` -- assignee distribution, label
  distribution, and burndown chart for a cycle. Supports both ``points``
  and ``issues`` analytics types.

A cycle is a time-boxed iteration with a project-scoped name,
``start_date`` and ``end_date``, an ``owned_by`` user, and a derived
``status`` (DRAFT / UPCOMING / CURRENT / COMPLETED) computed from the
project-local current time vs. the cycle's bounds. Cycle issue counts
use heavy ``.annotate(Count(...))`` aggregation -- read replicas help
when ``use_read_replica = True`` is enabled by subclasses. Mutations
queue ``model_activity`` / ``issue_activity`` Celery tasks (RabbitMQ-
backed) for audit logging and webhook fan-out (``webhook_event =
"cycle"``).

All date comparisons use the PROJECT TIMEZONE: dates are stored UTC-
naive in the database but compared after converting ``timezone.now()``
to the project's IANA zone (``pytz.timezone(project.timezone)``) and
then back to UTC.
"""

# Python imports
import json
import pytz


# Django imports
from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField
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
    Sum,
    FloatField,
)
from django.db import models
from django.db.models.functions import Coalesce, Cast, Concat
from django.utils import timezone
from django.core.serializers.json import DjangoJSONEncoder

# Third party imports
from rest_framework import status
from rest_framework.response import Response
from plane.app.permissions import allow_permission, ROLE
from plane.app.serializers import (
    CycleSerializer,
    CycleUserPropertiesSerializer,
    CycleWriteSerializer,
)
from plane.bgtasks.issue_activities_task import issue_activity
from plane.db.models import (
    Cycle,
    CycleIssue,
    UserFavorite,
    CycleUserProperties,
    Issue,
    Label,
    User,
    Project,
    UserRecentVisit,
)
from plane.utils.analytics_plot import burndown_plot
from plane.bgtasks.recent_visited_task import recent_visited_task
from plane.utils.host import base_host
from plane.utils.cycle_transfer_issues import transfer_cycle_issues
from .. import BaseAPIView, BaseViewSet
from plane.bgtasks.webhook_task import model_activity
from plane.utils.timezone_converter import convert_to_utc, user_timezone_converter


class CycleViewSet(BaseViewSet):
    """Project cycle CRUD: list / create / retrieve / partial_update / destroy.

    Resource managed:
        :class:`plane.db.models.Cycle` -- time-boxed project iterations
        with ``start_date``, ``end_date``, ``owned_by``, ``view_props``
        (JSONField), ``sort_order``, ``external_source``,
        ``external_id``, ``progress_snapshot`` (JSONField populated on
        completion), ``logo_props`` (JSONField), ``timezone``, and
        ``version``.

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<uuid:project_id>/cycles/
        POST   /api/workspaces/<slug>/projects/<uuid:project_id>/cycles/
        GET    /api/workspaces/<slug>/projects/<uuid:project_id>/cycles/<uuid:pk>/
        PUT    /api/workspaces/<slug>/projects/<uuid:project_id>/cycles/<uuid:pk>/
        PATCH  /api/workspaces/<slug>/projects/<uuid:project_id>/cycles/<uuid:pk>/
        DELETE /api/workspaces/<slug>/projects/<uuid:project_id>/cycles/<uuid:pk>/

    Request body (POST / PATCH):
        name (str, required for POST): cycle name.
        description (str, optional): free-form description.
        start_date (date, optional): IANA-zone-naive date interpreted in
            the project's timezone. MUST be paired with ``end_date`` --
            both null OR both set; POST rejects with HTTP 400 otherwise.
            Converted to UTC by :class:`CycleWriteSerializer.validate`.
        end_date (date, optional): see ``start_date``.
        owned_by_id (UUID, optional on POST -- defaults to ``request.user``).
        view_props (JSONField, optional): default ``{}``.
        sort_order (float, optional): used to order cycles in the UI.
        external_source / external_id (str, optional): for imported cycles.
        logo_props (JSONField, optional): default ``{}``.

        Read-only fields (set by the server): ``workspace``, ``project``,
        ``owned_by``, ``archived_at``.

        Edit gates on PATCH:
            * Archived cycles (``archived_at IS NOT NULL``) reject with
              HTTP 400 ``{"error": "Archived cycle cannot be updated"}``.
            * Completed cycles (``end_date < timezone.now()``) permit
              ONLY ``sort_order`` changes; any other field returns HTTP
              400 ``{"error": "The Cycle has already been completed so it
              cannot be edited"}``.

    Response shape:
        :class:`plane.app.serializers.CycleSerializer` shape PLUS
        annotations:
            * ``id``, ``workspace_id``, ``project_id`` (necessary keys)
            * ``name``, ``description``, ``start_date``, ``end_date``,
              ``owned_by_id``, ``view_props``, ``sort_order``,
              ``external_source``, ``external_id``, ``progress_snapshot``,
              ``logo_props``, ``version``, ``created_by`` (model fields)
            * ``is_favorite`` (bool) -- user-specific Exists annotation
            * ``total_issues``, ``completed_issues``, ``cancelled_issues``
              (int) -- per-state distinct Count annotations
            * ``assignee_ids`` (list[UUID]) -- ArrayAgg of distinct
              issue-assignee UUIDs across the cycle's issues
            * ``status`` (str) -- one of ``CURRENT`` / ``UPCOMING`` /
              ``COMPLETED`` / ``DRAFT``, derived from the project-local
              current time vs. ``start_date`` / ``end_date``

        Detail (``retrieve``) additionally includes ``sub_issues``
        (int -- count of cycle issues with non-null parent) and
        ``logo_props``. ``start_date`` and ``end_date`` are converted to
        the project timezone via
        :func:`plane.utils.timezone_converter.user_timezone_converter`
        before being returned to the client.

    Query parameters (GET list):
        cycle_view (str, optional, default=``"all"``):
            If ``"current"`` is supplied, the queryset is further
            filtered to cycles where ``start_date <= now <= end_date``
            (in project timezone). If no such cycle exists, the
            non-current full list is returned instead.

    Permissions:
        permission_classes = [IsAuthenticated]
            (inherited from :class:`plane.app.views.base.BaseViewSet`)

        Per-method via the ``@allow_permission`` decorator:
            * ``list``           -- ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST
            * ``create``         -- ROLE.ADMIN, ROLE.MEMBER
            * ``partial_update`` -- ROLE.ADMIN, ROLE.MEMBER
            * ``retrieve``       -- ROLE.ADMIN, ROLE.MEMBER
            * ``destroy``        -- ROLE.ADMIN (with ``creator=True,
              model=Cycle`` -- a non-admin MEMBER may delete a cycle they
              themselves created)

    Side effects:
        All ``.delay()`` enqueues below go through Celery via RabbitMQ
        (Redis is caching / session only per the architectural context).

        * ``create`` queues ``model_activity.delay(model_name="cycle",
          ...)`` -- emits an audit row and a ``cycle`` webhook delivery
          via the workspace's configured webhooks (per tech spec §5.2.10).
        * ``partial_update`` queues ``model_activity.delay(...)`` with the
          current_instance JSON for diff tracking.
        * ``retrieve`` queues ``recent_visited_task.delay(...)`` to record
          the cycle visit into :class:`plane.db.models.UserRecentVisit`.
        * ``destroy`` queues ``issue_activity.delay(
          type="cycle.activity.deleted", ...)`` with the full issue ID
          list, then hard-deletes the cycle (TODO note at source: soft
          delete is not yet wired to break the one-to-one cycle-issue
          relationship), then hard-deletes related ``UserFavorite`` and
          ``UserRecentVisit`` rows.

    Queryset filter logic (``get_queryset``):
        Restricts to cycles in the URL workspace and project where the
        requesting user is an ACTIVE project member and the project is
        not archived. Computes ``current_time_in_utc`` by converting
        ``timezone.now()`` to ``project.timezone`` (IANA zone) and back
        to UTC -- this is the comparison value used by the ``status``
        Case. Annotations:

        * ``is_favorite`` -- Exists subquery against UserFavorite.
        * ``total_issues``, ``completed_issues``, ``cancelled_issues`` --
          distinct Counts on ``issue_cycle__issue__id`` filtered by
          ``archived_at IS NULL``, ``is_draft = False``, and (for
          per-state counts) ``state__group`` membership.
        * ``status`` -- Case yielding ``CURRENT`` (``start_date <= now <=
          end_date``), ``UPCOMING`` (``start_date > now``), ``COMPLETED``
          (``end_date < now``), or ``DRAFT`` (both dates null).
        * ``assignee_ids`` -- ArrayAgg of distinct
          ``issue_cycle__issue__assignees__id`` excluding null and
          deleted assignments.

        ``select_related("project", "workspace", "owned_by")`` plus
        ``prefetch_related`` on issue assignees and labels minimize
        downstream N+1 queries.

        Architectural note: this aggregation is heavy -- read replicas
        help when ``use_read_replica = True`` is configured on the
        viewset (currently inherited as ``False`` from BaseViewSet).

    Cross-references:
        * Permission decorator: :func:`plane.app.permissions.allow_permission`
          (``apps/api/plane/app/permissions/base.py``)
        * Serializers: :class:`plane.app.serializers.CycleSerializer`,
          :class:`plane.app.serializers.CycleWriteSerializer`
          (``apps/api/plane/app/serializers/cycle.py``)
        * Models: :class:`plane.db.models.Cycle`,
          :class:`plane.db.models.UserFavorite`,
          :class:`plane.db.models.UserRecentVisit`,
          :class:`plane.db.models.Project`
          (``apps/api/plane/db/models/``)
        * Celery tasks: :func:`plane.bgtasks.issue_activities_task.issue_activity`,
          :func:`plane.bgtasks.issue_activities_task.model_activity`,
          :func:`plane.bgtasks.recent_visited_task.recent_visited_task`
          (``apps/api/plane/bgtasks/``)
        * URL: ``apps/api/plane/app/urls/cycle.py``
    """

    serializer_class = CycleSerializer
    model = Cycle
    webhook_event = "cycle"

    def get_queryset(self):
        """Return cycle queryset annotated with favorite, counts, status, and assignee IDs.

        Restricts to the URL workspace/project. Uses the project timezone for
        ``status`` derivation.
        """
        favorite_subquery = UserFavorite.objects.filter(
            user=self.request.user,
            entity_identifier=OuterRef("pk"),
            entity_type="cycle",
            project_id=self.kwargs.get("project_id"),
            workspace__slug=self.kwargs.get("slug"),
        )

        project = Project.objects.get(id=self.kwargs.get("project_id"))

        # Fetch project for the specific record or pass project_id dynamically
        project_timezone = project.timezone

        # Convert the current time (timezone.now()) to the project's timezone
        local_tz = pytz.timezone(project_timezone)
        current_time_in_project_tz = timezone.now().astimezone(local_tz)

        # Convert project local time back to UTC for comparison (start_date is stored in UTC)
        current_time_in_utc = current_time_in_project_tz.astimezone(pytz.utc)

        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
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
                        issue_cycle__deleted_at__isnull=True,
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
                        issue_cycle__deleted_at__isnull=True,
                        issue_cycle__issue__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                cancelled_issues=Count(
                    "issue_cycle__issue__id",
                    distinct=True,
                    filter=Q(
                        issue_cycle__issue__state__group__in=["cancelled"],
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__deleted_at__isnull=True,
                        issue_cycle__issue__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(
                status=Case(
                    When(
                        Q(start_date__lte=current_time_in_utc) & Q(end_date__gte=current_time_in_utc),
                        then=Value("CURRENT"),
                    ),
                    When(start_date__gt=current_time_in_utc, then=Value("UPCOMING")),
                    When(end_date__lt=current_time_in_utc, then=Value("COMPLETED")),
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
                        filter=~Q(issue_cycle__issue__assignees__id__isnull=True)
                        & (Q(issue_cycle__issue__issue_assignee__deleted_at__isnull=True)),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                )
            )
            .order_by("-is_favorite", "name")
            .distinct()
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def list(self, request, slug, project_id):
        """List active (non-archived) cycles for the project.

        With ``?cycle_view=current`` filters to cycles whose ``start_date`` /
        ``end_date`` bracket the current project-local time.
        """
        queryset = self.get_queryset().filter(archived_at__isnull=True)
        cycle_view = request.GET.get("cycle_view", "all")

        # Update the order by
        queryset = queryset.order_by("-is_favorite", "-created_at")

        project = Project.objects.get(id=self.kwargs.get("project_id"))

        # Fetch project for the specific record or pass project_id dynamically
        project_timezone = project.timezone

        # Convert the current time (timezone.now()) to the project's timezone
        local_tz = pytz.timezone(project_timezone)
        current_time_in_project_tz = timezone.now().astimezone(local_tz)

        # Convert project local time back to UTC for comparison (start_date is stored in UTC)
        current_time_in_utc = current_time_in_project_tz.astimezone(pytz.utc)

        # Current Cycle
        if cycle_view == "current":
            queryset = queryset.filter(start_date__lte=current_time_in_utc, end_date__gte=current_time_in_utc)

            data = queryset.values(
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
                "logo_props",
                "is_favorite",
                "total_issues",
                "completed_issues",
                "cancelled_issues",
                "assignee_ids",
                "status",
                "version",
                "created_by",
            )
            datetime_fields = ["start_date", "end_date"]
            data = user_timezone_converter(data, datetime_fields, project_timezone)

            if data:
                return Response(data, status=status.HTTP_200_OK)

        data = queryset.values(
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
            "logo_props",
            # meta fields
            "is_favorite",
            "total_issues",
            "cancelled_issues",
            "completed_issues",
            "assignee_ids",
            "status",
            "version",
            "created_by",
        )
        datetime_fields = ["start_date", "end_date"]
        data = user_timezone_converter(data, datetime_fields, project_timezone)
        return Response(data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def create(self, request, slug, project_id):
        """Create a cycle and queue a ``model_activity`` Celery audit event (Celery via RabbitMQ).

        ``start_date`` and ``end_date`` MUST both be null or both set; ``owned_by``
        is assigned to the requesting user.
        """
        if (request.data.get("start_date", None) is None and request.data.get("end_date", None) is None) or (
            request.data.get("start_date", None) is not None and request.data.get("end_date", None) is not None
        ):
            serializer = CycleWriteSerializer(data=request.data, context={"project_id": project_id})
            if serializer.is_valid():
                serializer.save(project_id=project_id, owned_by=request.user)
                cycle = (
                    self.get_queryset()
                    .filter(pk=serializer.data["id"])
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
                        "logo_props",
                        "version",
                        # meta fields
                        "is_favorite",
                        "total_issues",
                        "completed_issues",
                        "assignee_ids",
                        "status",
                        "created_by",
                    )
                    .first()
                )

                # Fetch the project timezone
                project = Project.objects.get(id=self.kwargs.get("project_id"))
                project_timezone = project.timezone

                datetime_fields = ["start_date", "end_date"]
                cycle = user_timezone_converter(cycle, datetime_fields, project_timezone)

                # Send the model activity
                model_activity.delay(
                    model_name="cycle",
                    model_id=str(cycle["id"]),
                    requested_data=request.data,
                    current_instance=None,
                    actor_id=request.user.id,
                    slug=slug,
                    origin=base_host(request=request, is_app=True),
                )
                return Response(cycle, status=status.HTTP_201_CREATED)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        else:
            return Response(
                {"error": "Both start date and end date are either required or are to be null"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def partial_update(self, request, slug, project_id, pk):
        """Patch a cycle and queue a ``model_activity`` Celery audit event (Celery via RabbitMQ).

        Archived cycles reject all changes (HTTP 400); completed cycles accept only
        ``sort_order`` updates.
        """
        queryset = self.get_queryset().filter(workspace__slug=slug, project_id=project_id, pk=pk)
        cycle = queryset.first()
        if cycle.archived_at:
            return Response(
                {"error": "Archived cycle cannot be updated"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        current_instance = json.dumps(CycleSerializer(cycle).data, cls=DjangoJSONEncoder)

        request_data = request.data

        if cycle.end_date is not None and cycle.end_date < timezone.now():
            if "sort_order" in request_data:
                # Can only change sort order for a completed cycle``
                request_data = {"sort_order": request_data.get("sort_order", cycle.sort_order)}
            else:
                return Response(
                    {"error": "The Cycle has already been completed so it cannot be edited"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        serializer = CycleWriteSerializer(cycle, data=request.data, partial=True, context={"project_id": project_id})
        if serializer.is_valid():
            serializer.save()
            cycle = queryset.values(
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
                "logo_props",
                "version",
                # meta fields
                "is_favorite",
                "total_issues",
                "completed_issues",
                "assignee_ids",
                "status",
                "created_by",
            ).first()

            # Fetch the project timezone
            project = Project.objects.get(id=self.kwargs.get("project_id"))
            project_timezone = project.timezone

            datetime_fields = ["start_date", "end_date"]
            cycle = user_timezone_converter(cycle, datetime_fields, project_timezone)

            # Send the model activity
            model_activity.delay(
                model_name="cycle",
                model_id=str(cycle["id"]),
                requested_data=request.data,
                current_instance=current_instance,
                actor_id=request.user.id,
                slug=slug,
                origin=base_host(request=request, is_app=True),
            )

            return Response(cycle, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def retrieve(self, request, slug, project_id, pk):
        """Retrieve a single non-archived cycle with ``sub_issues`` annotation.

        Queues a ``recent_visited_task`` Celery event (Celery via RabbitMQ)
        for UserRecentVisit logging.
        """
        queryset = self.get_queryset().filter(archived_at__isnull=True).filter(pk=pk)
        data = (
            self.get_queryset()
            .filter(pk=pk)
            .filter(archived_at__isnull=True)
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
                "version",
                # meta fields
                "is_favorite",
                "total_issues",
                "completed_issues",
                "assignee_ids",
                "status",
                "created_by",
            )
            .first()
        )

        if data is None:
            return Response({"error": "Cycle not found"}, status=status.HTTP_404_NOT_FOUND)

        queryset = queryset.first()
        # Fetch the project timezone
        project = Project.objects.get(id=self.kwargs.get("project_id"))
        project_timezone = project.timezone
        datetime_fields = ["start_date", "end_date"]
        data = user_timezone_converter(data, datetime_fields, project_timezone)

        recent_visited_task.delay(
            slug=slug,
            entity_name="cycle",
            entity_identifier=pk,
            user_id=request.user.id,
            project_id=project_id,
        )
        return Response(data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN], creator=True, model=Cycle)
    def destroy(self, request, slug, project_id, pk):
        """Hard-delete a cycle (ADMIN or cycle creator only).

        Queues an ``issue_activity`` audit event (Celery via RabbitMQ),
        then cascade-deletes related UserFavorite and UserRecentVisit rows.
        """
        cycle = Cycle.objects.get(workspace__slug=slug, project_id=project_id, pk=pk)

        cycle_issues = list(CycleIssue.objects.filter(cycle_id=self.kwargs.get("pk")).values_list("issue", flat=True))

        issue_activity.delay(
            type="cycle.activity.deleted",
            requested_data=json.dumps(
                {
                    "cycle_id": str(pk),
                    "cycle_name": str(cycle.name),
                    "issues": [str(issue_id) for issue_id in cycle_issues],
                }
            ),
            actor_id=str(request.user.id),
            issue_id=str(pk),
            project_id=str(project_id),
            current_instance=None,
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )
        # TODO: Soft delete the cycle break the onetoone relationship with cycle issue
        cycle.delete()

        # Delete the user favorite cycle
        UserFavorite.objects.filter(
            user=request.user,
            entity_type="cycle",
            entity_identifier=pk,
            project_id=project_id,
        ).delete()
        # Delete the cycle from recent visits
        UserRecentVisit.objects.filter(
            project_id=project_id,
            workspace__slug=slug,
            entity_identifier=pk,
            entity_name="cycle",
        ).delete(soft=False)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CycleDateCheckEndpoint(BaseAPIView):
    """Validate that a prospective cycle date range does not overlap any existing cycle.

    Resource managed:
        Validation-only endpoint -- does NOT create, read, or modify any
        Cycle row. Returns a status flag the client uses to enable /
        disable the cycle save button before submitting the create form.

    HTTP methods + URL patterns:
        POST /api/workspaces/<slug>/projects/<uuid:project_id>/cycles/date-check/

    Request body:
        start_date (date, required): ISO date in project timezone.
        end_date (date, required): ISO date in project timezone.
        cycle_id (UUID, optional): the cycle being edited -- if supplied,
            it is excluded from the overlap check (otherwise editing a
            cycle in place would always conflict with itself).

    Response shape:
        Success (no overlap): HTTP 200 with body ``{"status": true}``.
        Conflict (overlap): HTTP 200 with body
            ``{"error": "You have a cycle already on the given dates, if
            you want to create a draft cycle you can do that by removing
            dates", "status": false}``.
            Note: the conflict response is HTTP 200 (not 400) -- the
            client distinguishes by the ``status`` boolean. This is
            non-standard but preserved per system boundary.
        Missing dates: HTTP 400 ``{"error": "Start date and end date
            both are required"}``.

    Permissions:
        permission_classes = [IsAuthenticated]
            (inherited from :class:`plane.app.views.base.BaseAPIView`)
        ``post`` -- ROLE.ADMIN, ROLE.MEMBER

    Overlap algorithm:
        After converting ``start_date`` and ``end_date`` to UTC via
        :func:`plane.utils.timezone_converter.convert_to_utc` (with
        ``is_start_date=True`` for the start), looks for any existing
        cycle satisfying ANY of the three overlap conditions:

        * ``start_date <= existing.start_date <= end_date`` (new range
          covers existing start)
        * ``start_date <= existing.end_date <= end_date`` (new range
          covers existing end)
        * ``existing.start_date >= new_start_date AND existing.end_date <=
          new_end_date`` (new range fully contains existing)

        plus the ``Q(start_date__lte=start_date, end_date__gte=start_date)
        | Q(start_date__lte=end_date, end_date__gte=end_date) |
        Q(start_date__gte=start_date, end_date__lte=end_date)`` source
        expression that covers all overlap cases. Excludes the cycle
        with id=cycle_id when supplied.
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id):
        """Validate that the [start_date, end_date] range does not overlap any other cycle.

        Returns ``{"status": true}`` if no overlap, otherwise
        ``{"status": false, "error": ...}``.
        """
        start_date = request.data.get("start_date", False)
        end_date = request.data.get("end_date", False)
        cycle_id = request.data.get("cycle_id")
        if not start_date or not end_date:
            return Response(
                {"error": "Start date and end date both are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        start_date = convert_to_utc(date=str(start_date), project_id=project_id, is_start_date=True)
        end_date = convert_to_utc(
            date=str(end_date),
            project_id=project_id,
        )

        # Check if any cycle intersects in the given interval
        cycles = Cycle.objects.filter(
            Q(workspace__slug=slug)
            & Q(project_id=project_id)
            & (
                Q(start_date__lte=start_date, end_date__gte=start_date)
                | Q(start_date__lte=end_date, end_date__gte=end_date)
                | Q(start_date__gte=start_date, end_date__lte=end_date)
            )
        ).exclude(pk=cycle_id)
        if cycles.exists():
            return Response(
                {
                    "error": "You have a cycle already on the given dates, if you want to create a draft cycle you can do that by removing dates",  # noqa: E501
                    "status": False,
                }
            )
        else:
            return Response({"status": True}, status=status.HTTP_200_OK)


class CycleFavoriteViewSet(BaseViewSet):
    """Toggle the requesting user's favorite flag on cycles.

    Resource managed:
        :class:`plane.db.models.UserFavorite` rows with
        ``entity_type="cycle"``. The ``entity_identifier`` field holds
        the target cycle's UUID. Favorites are user-scoped (each user
        sees only their own favorites).

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<uuid:project_id>/user-favorite-cycles/
               (inherited list -- returns the user's favorited cycles)
        POST   /api/workspaces/<slug>/projects/<uuid:project_id>/user-favorite-cycles/
        DELETE /api/workspaces/<slug>/projects/<uuid:project_id>/user-favorite-cycles/<uuid:cycle_id>/

    Request body (POST):
        cycle (UUID, required): the cycle UUID to mark as favorite. This
            value is stored in ``UserFavorite.entity_identifier``.

    Response shape:
        POST: HTTP 204 NO_CONTENT with empty body (non-standard for a
            create response -- preserved per system boundary).
        DELETE: HTTP 204 NO_CONTENT with empty body.

    Permissions:
        permission_classes = [IsAuthenticated]
            (inherited from :class:`plane.app.views.base.BaseViewSet`)
        ``create`` -- ROLE.ADMIN, ROLE.MEMBER
        ``destroy`` -- ROLE.ADMIN, ROLE.MEMBER

    URL kwarg mapping:
        The DELETE URL's ``cycle_id`` kwarg maps to
        ``UserFavorite.entity_identifier`` -- NOT to the UserFavorite
        row's own primary key. The destroy filter combines
        ``user=request.user``, ``entity_type="cycle"``, and
        ``entity_identifier=cycle_id`` to locate the favorite row.

    Side effects:
        * ``destroy`` performs a HARD delete (``soft=False``) so the
          UserFavorite row is fully removed (no soft-delete tombstone).

    Queryset filter logic (``get_queryset``):
        Restricts to UserFavorite rows where ``workspace__slug`` matches
        the URL and ``user`` is the requesting user. The implicit
        ``entity_type`` filter is applied per-method in ``create`` and
        ``destroy``.
    """

    model = UserFavorite

    def get_queryset(self):
        """Return the requesting user's UserFavorite queryset for this workspace.

        Related cycle and cycle owner are select_related-loaded.
        """
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(user=self.request.user)
            .select_related("cycle", "cycle__owned_by")
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def create(self, request, slug, project_id):
        """Create a UserFavorite row for the requesting user.

        Sets ``entity_type="cycle"`` and ``entity_identifier=request.data["cycle"]``.
        """
        _ = UserFavorite.objects.create(
            project_id=project_id,
            user=request.user,
            entity_type="cycle",
            entity_identifier=request.data.get("cycle"),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def destroy(self, request, slug, project_id, cycle_id):
        """Hard-delete the requesting user's favorite for the URL-identified cycle.

        Uses ``soft=False`` so the UserFavorite row is fully removed.
        """
        cycle_favorite = UserFavorite.objects.get(
            project=project_id,
            entity_type="cycle",
            user=request.user,
            workspace__slug=slug,
            entity_identifier=cycle_id,
        )
        cycle_favorite.delete(soft=False)
        return Response(status=status.HTTP_204_NO_CONTENT)


class TransferCycleIssueEndpoint(BaseAPIView):
    """Move a cycle's uncompleted issues to a successor cycle and persist a progress snapshot.

    Resource managed:
        :class:`plane.db.models.CycleIssue` rows -- the M2M junction
        from the source cycle is mutated to point at the new cycle (for
        uncompleted issues only); plus :class:`plane.db.models.Cycle`'s
        ``progress_snapshot`` JSONField on the SOURCE cycle is written
        with the final per-state counts and distributions.

    HTTP methods + URL patterns:
        POST /api/workspaces/<slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/transfer-issues/

    Request body:
        new_cycle_id (UUID, required): destination cycle.

    Response shape:
        Success: HTTP 200 ``{"message": "Success"}``.
        Validation failure (missing ``new_cycle_id``, source cycle not
            yet completed, or downstream error): HTTP 400
            ``{"error": "<message>"}``.

    Permissions:
        permission_classes = [IsAuthenticated]
            (inherited from :class:`plane.app.views.base.BaseAPIView`)
        ``post`` -- ROLE.ADMIN, ROLE.MEMBER

    Side effects:
        Delegates to :func:`plane.utils.cycle_transfer_issues.transfer_cycle_issues`
        which (synchronously, in a database transaction):

        1. Persists the SOURCE cycle's ``progress_snapshot`` JSONField
           with state-grouped issue counts, label/assignee distributions,
           and the completion chart -- preventing the analytics from
           changing once a cycle is closed.
        2. Updates each uncompleted ``CycleIssue.cycle_id`` from
           ``cycle_id`` to ``new_cycle_id``.

        The transfer is SYNCHRONOUS (not a Celery task) -- it runs
        inline in the request lifecycle.
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, cycle_id):
        """Move uncompleted issues from the source cycle to ``request.data["new_cycle_id"]``.

        Also stamps the source cycle's ``progress_snapshot``; synchronous and
        transactional (no Celery dispatch).
        """
        new_cycle_id = request.data.get("new_cycle_id", False)

        if not new_cycle_id:
            return Response(
                {"error": "New Cycle Id is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Transfer cycle issues and create progress snapshot
        result = transfer_cycle_issues(
            slug=slug,
            project_id=project_id,
            cycle_id=cycle_id,
            new_cycle_id=new_cycle_id,
            request=request,
            user_id=request.user.id,
        )

        # Handle error response
        if result.get("error"):
            return Response(
                {"error": result["error"]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response({"message": "Success"}, status=status.HTTP_200_OK)


class CycleUserPropertiesEndpoint(BaseAPIView):
    """Read or patch the requesting user's per-cycle UI preferences.

    Resource managed:
        :class:`plane.db.models.CycleUserProperties` -- per-user,
        per-cycle UI state: applied filters, rich filters (advanced
        filter trees), display filters (layout / grouping selections),
        and display properties (which columns are visible).

    HTTP methods + URL patterns:
        GET   /api/workspaces/<slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/user-properties/
        PATCH /api/workspaces/<slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/user-properties/

    Request body (PATCH):
        filters (JSONField, optional): legacy filter dict.
        rich_filters (JSONField, optional): rich filter tree.
        display_filters (JSONField, optional): layout / grouping prefs.
        display_properties (JSONField, optional): visible column flags.
        All four fields default to the source model's
        ``get_default_*`` factories when first auto-created via the GET
        path.

    Response shape:
        :class:`plane.app.serializers.CycleUserPropertiesSerializer`
        output (all four JSONField values plus FK / timestamp metadata).

        GET: HTTP 200.
        PATCH: HTTP 201 (non-standard -- typically PATCH returns 200;
            preserved per system boundary).

    Permissions:
        permission_classes = [IsAuthenticated]
            (inherited from :class:`plane.app.views.base.BaseAPIView`)
        ``patch`` -- ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST
        ``get``   -- ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST

    Auto-provisioning:
        ``get`` uses ``get_or_create`` so the first read for a (user,
        cycle) pair lazily creates the properties row with the model's
        default JSONField values. ``patch`` does NOT auto-provision --
        it requires the row to exist (raising ``ObjectDoesNotExist`` ->
        404 via :meth:`BaseAPIView.handle_exception` otherwise).
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def patch(self, request, slug, project_id, cycle_id):
        """Patch the user's CycleUserProperties row.

        Accepts any of ``filters`` / ``rich_filters`` / ``display_filters`` /
        ``display_properties`` values.
        """
        cycle_properties = CycleUserProperties.objects.get(
            user=request.user,
            cycle_id=cycle_id,
            project_id=project_id,
            workspace__slug=slug,
        )

        cycle_properties.filters = request.data.get("filters", cycle_properties.filters)
        cycle_properties.rich_filters = request.data.get("rich_filters", cycle_properties.rich_filters)
        cycle_properties.display_filters = request.data.get("display_filters", cycle_properties.display_filters)
        cycle_properties.display_properties = request.data.get(
            "display_properties", cycle_properties.display_properties
        )
        cycle_properties.save()

        serializer = CycleUserPropertiesSerializer(cycle_properties)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, cycle_id):
        """Return the requesting user's CycleUserProperties row for the cycle.

        Auto-creates the row with model defaults on first access via
        ``get_or_create``.
        """
        cycle_properties, _ = CycleUserProperties.objects.get_or_create(
            user=request.user,
            project_id=project_id,
            cycle_id=cycle_id,
            workspace__slug=slug,
        )
        serializer = CycleUserPropertiesSerializer(cycle_properties)
        return Response(serializer.data, status=status.HTTP_200_OK)


class CycleProgressEndpoint(BaseAPIView):
    """Aggregate cycle progress: per-state issue counts and per-state estimate-point sums.

    Resource managed:
        Read-only analytics derived from
        :class:`plane.db.models.Issue` rows in the cycle and (when
        completed) the cycle's ``progress_snapshot`` JSONField.

    HTTP methods + URL patterns:
        GET /api/workspaces/<slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/progress/

    Request body:
        None (GET only) -- ``slug``, ``project_id``, and ``cycle_id`` are
        supplied as URL kwargs.

    Response shape:
        ``{
            "backlog_estimate_points": float,
            "unstarted_estimate_points": float,
            "started_estimate_points": float,
            "cancelled_estimate_points": float,
            "completed_estimate_points": float,
            "total_estimate_points": float | None,
            "backlog_issues": int,
            "total_issues": int,
            "completed_issues": int,
            "cancelled_issues": int,
            "started_issues": int,
            "unstarted_issues": int,
        }``

        Estimate points are computed live for every request -- they are
        Sum() aggregations over ``estimate_point__value`` cast to
        FloatField, filtered to ``estimate_point__estimate__type =
        "points"`` to exclude T-shirt / category / time-based estimates.

    Permissions:
        permission_classes = [IsAuthenticated]
            (inherited from :class:`plane.app.views.base.BaseAPIView`)
        ``get`` -- ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST

    Snapshot vs. live counts:
        Issue COUNTS (not estimate points) are read from the cycle's
        ``progress_snapshot`` JSONField when it is non-empty (i.e.,
        after the cycle has been transferred / completed via
        :class:`TransferCycleIssueEndpoint` -- the snapshot is the
        canonical record of cycle outcomes). Otherwise, each per-state
        count is computed live from ``Issue.issue_objects`` filtered by
        ``state__group``.

        Estimate POINTS are always computed live regardless of snapshot
        presence -- this is intentional because the snapshot only
        captures counts.

    Error cases:
        Cycle not found in the URL workspace+project: HTTP 404
        ``{"error": "Cycle not found"}``.

    Cross-references:
        * Permission decorator: :func:`plane.app.permissions.allow_permission`
          (``apps/api/plane/app/permissions/base.py``)
        * Models: :class:`plane.db.models.Cycle`,
          :class:`plane.db.models.Issue`
          (``apps/api/plane/db/models/cycle.py``,
          ``apps/api/plane/db/models/issue.py``)
        * URL: ``apps/api/plane/app/urls/cycle.py``
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, cycle_id):
        """Return per-state issue counts and per-state estimate-point sums.

        Counts come from ``progress_snapshot`` for completed cycles, recomputed
        live otherwise; estimate-point sums are always recomputed live.
        """
        cycle = Cycle.objects.filter(workspace__slug=slug, project_id=project_id, id=cycle_id).first()
        if not cycle:
            return Response({"error": "Cycle not found"}, status=status.HTTP_404_NOT_FOUND)
        aggregate_estimates = (
            Issue.issue_objects.filter(
                estimate_point__estimate__type="points",
                issue_cycle__cycle_id=cycle_id,
                issue_cycle__deleted_at__isnull=True,
                workspace__slug=slug,
                project_id=project_id,
            )
            .annotate(value_as_float=Cast("estimate_point__value", FloatField()))
            .aggregate(
                backlog_estimate_point=Sum(
                    Case(
                        When(state__group="backlog", then="value_as_float"),
                        default=Value(0),
                        output_field=FloatField(),
                    )
                ),
                unstarted_estimate_point=Sum(
                    Case(
                        When(state__group="unstarted", then="value_as_float"),
                        default=Value(0),
                        output_field=FloatField(),
                    )
                ),
                started_estimate_point=Sum(
                    Case(
                        When(state__group="started", then="value_as_float"),
                        default=Value(0),
                        output_field=FloatField(),
                    )
                ),
                cancelled_estimate_point=Sum(
                    Case(
                        When(state__group="cancelled", then="value_as_float"),
                        default=Value(0),
                        output_field=FloatField(),
                    )
                ),
                completed_estimate_points=Sum(
                    Case(
                        When(state__group="completed", then="value_as_float"),
                        default=Value(0),
                        output_field=FloatField(),
                    )
                ),
                total_estimate_points=Sum("value_as_float", default=Value(0), output_field=FloatField()),
            )
        )
        if cycle.progress_snapshot:
            backlog_issues = cycle.progress_snapshot.get("backlog_issues", 0)
            unstarted_issues = cycle.progress_snapshot.get("unstarted_issues", 0)
            started_issues = cycle.progress_snapshot.get("started_issues", 0)
            cancelled_issues = cycle.progress_snapshot.get("cancelled_issues", 0)
            completed_issues = cycle.progress_snapshot.get("completed_issues", 0)
            total_issues = cycle.progress_snapshot.get("total_issues", 0)
        else:
            backlog_issues = Issue.issue_objects.filter(
                issue_cycle__cycle_id=cycle_id,
                issue_cycle__deleted_at__isnull=True,
                workspace__slug=slug,
                project_id=project_id,
                state__group="backlog",
            ).count()

            unstarted_issues = Issue.issue_objects.filter(
                issue_cycle__cycle_id=cycle_id,
                issue_cycle__deleted_at__isnull=True,
                workspace__slug=slug,
                project_id=project_id,
                state__group="unstarted",
            ).count()

            started_issues = Issue.issue_objects.filter(
                issue_cycle__cycle_id=cycle_id,
                issue_cycle__deleted_at__isnull=True,
                workspace__slug=slug,
                project_id=project_id,
                state__group="started",
            ).count()

            cancelled_issues = Issue.issue_objects.filter(
                issue_cycle__cycle_id=cycle_id,
                issue_cycle__deleted_at__isnull=True,
                workspace__slug=slug,
                project_id=project_id,
                state__group="cancelled",
            ).count()

            completed_issues = Issue.issue_objects.filter(
                issue_cycle__cycle_id=cycle_id,
                issue_cycle__deleted_at__isnull=True,
                workspace__slug=slug,
                project_id=project_id,
                state__group="completed",
            ).count()

            total_issues = Issue.issue_objects.filter(
                issue_cycle__cycle_id=cycle_id,
                issue_cycle__deleted_at__isnull=True,
                workspace__slug=slug,
                project_id=project_id,
            ).count()

        return Response(
            {
                "backlog_estimate_points": aggregate_estimates["backlog_estimate_point"] or 0,
                "unstarted_estimate_points": aggregate_estimates["unstarted_estimate_point"] or 0,
                "started_estimate_points": aggregate_estimates["started_estimate_point"] or 0,
                "cancelled_estimate_points": aggregate_estimates["cancelled_estimate_point"] or 0,
                "completed_estimate_points": aggregate_estimates["completed_estimate_points"] or 0,
                "total_estimate_points": aggregate_estimates["total_estimate_points"],
                "backlog_issues": backlog_issues,
                "total_issues": total_issues,
                "completed_issues": completed_issues,
                "cancelled_issues": cancelled_issues,
                "started_issues": started_issues,
                "unstarted_issues": unstarted_issues,
            },
            status=status.HTTP_200_OK,
        )


class CycleAnalyticsEndpoint(BaseAPIView):
    """Cycle analytics: assignee distribution, label distribution, and burndown chart.

    Resource managed:
        Read-only analytics derived from
        :class:`plane.db.models.Issue` rows in the cycle and (when
        completed) the cycle's ``progress_snapshot["distribution"]``
        JSONField sub-tree.

    HTTP methods + URL patterns:
        GET /api/workspaces/<slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/analytics/

    Request body:
        None (GET only) -- ``slug``, ``project_id``, and ``cycle_id`` are
        supplied as URL kwargs.

    Query parameters:
        type (str, optional, default=``"issues"``):
            * ``"issues"`` -- aggregate Count() of issues per assignee /
              per label, plus the issue burndown chart.
            * ``"points"`` -- aggregate Sum() of estimate-point values
              per assignee / per label, plus the point burndown. The
              points branch is silently skipped if the project does not
              have an estimate of ``type="points"`` (assignees / labels
              fall through to empty lists).

    Response shape:
        ``{
            "assignees": [
                {
                    "display_name": str, "assignee_id": UUID,
                    "avatar_url": str | None,
                    "total_issues"/"total_estimates": int|float,
                    "completed_issues"/"completed_estimates": int|float,
                    "pending_issues"/"pending_estimates": int|float,
                },
                ...
            ],
            "labels": [
                {
                    "label_name": str, "color": str, "label_id": UUID,
                    "total_issues"/"total_estimates": int|float,
                    "completed_issues"/"completed_estimates": int|float,
                    "pending_issues"/"pending_estimates": int|float,
                },
                ...
            ],
            "completion_chart": {<date>: <int>, ...},
        }``

        For completed cycles (``progress_snapshot`` populated), this is
        returned directly from ``progress_snapshot["distribution"]``
        without further computation. ``avatar_url`` is composed from
        ``assignees__avatar_asset`` (preferred) or
        ``assignees__avatar`` (fallback).

    Permissions:
        permission_classes = [IsAuthenticated]
            (inherited from :class:`plane.app.views.base.BaseAPIView`)
        ``get`` -- ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST

    Error cases:
        Cycle without ``start_date`` or ``end_date`` (DRAFT cycle):
        HTTP 400 ``{"error": "Cycle has no start or end date"}``.

    Snapshot vs. live distributions:
        When the cycle has a populated ``progress_snapshot``, this
        endpoint returns ``snapshot["distribution"]`` directly. This is
        the same record persisted by
        :func:`plane.utils.cycle_transfer_issues.transfer_cycle_issues`
        on cycle completion -- it captures the final state of the
        cycle's analytics so subsequent issue mutations (e.g., on
        transferred issues now living in a different cycle) do not
        retroactively change the historical analytics.

        Otherwise (active cycle), the distributions are computed live:

        * For ``type="points"`` (and only if the project has an
          estimate of ``type="points"``), assignee_distribution and
          label_distribution are computed via Sum(Cast(value, Float))
          aggregations, plus the completion chart via
          :func:`plane.utils.analytics_plot.burndown_plot` with
          ``plot_type="points"``.
        * For ``type="issues"``, assignee_distribution and
          label_distribution are computed via Count() aggregations,
          plus the completion chart via ``burndown_plot`` with
          ``plot_type="issues"``.

    Cross-references:
        * Permission decorator: :func:`plane.app.permissions.allow_permission`
          (``apps/api/plane/app/permissions/base.py``)
        * Burndown helper: :func:`plane.utils.analytics_plot.burndown_plot`
          (``apps/api/plane/utils/analytics_plot.py``)
        * Cycle transfer helper: :func:`plane.utils.cycle_transfer_issues.transfer_cycle_issues`
          (``apps/api/plane/utils/cycle_transfer_issues.py``)
        * Models: :class:`plane.db.models.Cycle`,
          :class:`plane.db.models.Issue`
          (``apps/api/plane/db/models/``)
        * URL: ``apps/api/plane/app/urls/cycle.py``
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, cycle_id):
        """Return assignee + label distribution + completion-chart for the cycle.

        Reads ``progress_snapshot["distribution"]`` for completed cycles; computes
        live (by ``?type=issues`` or ``?type=points``) otherwise.
        """
        analytic_type = request.GET.get("type", "issues")
        cycle = (
            Cycle.objects.filter(workspace__slug=slug, project_id=project_id, id=cycle_id)
            .annotate(
                total_issues=Count(
                    "issue_cycle__issue__id",
                    distinct=True,
                    filter=Q(
                        issue_cycle__issue__archived_at__isnull=True,
                        issue_cycle__issue__is_draft=False,
                        issue_cycle__issue__deleted_at__isnull=True,
                        issue_cycle__deleted_at__isnull=True,
                    ),
                )
            )
            .first()
        )

        if not cycle.start_date or not cycle.end_date:
            return Response(
                {"error": "Cycle has no start or end date"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # this will tell whether the issues were transferred to the new cycle
        """ 
        if the issues were transferred to the new cycle, then the progress_snapshot will be present
        return the progress_snapshot data in the analytics for each date
            
        else issues were not transferred to the new cycle then generate the stats from the cycle issue bridge tables
        """

        if cycle.progress_snapshot:
            distribution = cycle.progress_snapshot.get("distribution", {})
            return Response(
                {
                    "labels": distribution.get("labels", []),
                    "assignees": distribution.get("assignees", []),
                    "completion_chart": distribution.get("completion_chart", {}),
                },
                status=status.HTTP_200_OK,
            )

        estimate_type = Project.objects.filter(
            workspace__slug=slug,
            pk=project_id,
            estimate__isnull=False,
            estimate__type="points",
        ).exists()

        assignee_distribution = []
        label_distribution = []
        completion_chart = {}

        if analytic_type == "points" and estimate_type:
            assignee_distribution = (
                Issue.issue_objects.filter(
                    issue_cycle__cycle_id=cycle_id,
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
                    issue_cycle__cycle_id=cycle_id,
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
            completion_chart = burndown_plot(
                queryset=cycle,
                slug=slug,
                project_id=project_id,
                plot_type="points",
                cycle_id=cycle_id,
            )

        if analytic_type == "issues":
            assignee_distribution = (
                Issue.issue_objects.filter(
                    issue_cycle__cycle_id=cycle_id,
                    issue_cycle__deleted_at__isnull=True,
                    project_id=project_id,
                    workspace__slug=slug,
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
                .annotate(
                    total_issues=Count(
                        "assignee_id",
                        filter=Q(archived_at__isnull=True, is_draft=False),
                    )
                )
                .annotate(
                    completed_issues=Count(
                        "assignee_id",
                        filter=Q(
                            completed_at__isnull=False,
                            archived_at__isnull=True,
                            is_draft=False,
                        ),
                    )
                )
                .annotate(
                    pending_issues=Count(
                        "assignee_id",
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
                    issue_cycle__cycle_id=cycle_id,
                    issue_cycle__deleted_at__isnull=True,
                    project_id=project_id,
                    workspace__slug=slug,
                )
                .annotate(label_name=F("labels__name"))
                .annotate(color=F("labels__color"))
                .annotate(label_id=F("labels__id"))
                .values("label_name", "color", "label_id")
                .annotate(total_issues=Count("label_id", filter=Q(archived_at__isnull=True, is_draft=False)))
                .annotate(
                    completed_issues=Count(
                        "label_id",
                        filter=Q(
                            completed_at__isnull=False,
                            archived_at__isnull=True,
                            is_draft=False,
                        ),
                    )
                )
                .annotate(
                    pending_issues=Count(
                        "label_id",
                        filter=Q(
                            completed_at__isnull=True,
                            archived_at__isnull=True,
                            is_draft=False,
                        ),
                    )
                )
                .order_by("label_name")
            )
            completion_chart = burndown_plot(
                queryset=cycle,
                slug=slug,
                project_id=project_id,
                cycle_id=cycle_id,
                plot_type="issues",
            )

        return Response(
            {
                "assignees": assignee_distribution,
                "labels": label_distribution,
                "completion_chart": completion_chart,
            },
            status=status.HTTP_200_OK,
        )
