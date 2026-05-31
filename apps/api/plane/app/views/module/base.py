# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Module CRUD, links, favorites, and user-preferences endpoints.

This module defines the four DRF views that constitute Plane's main
module API surface, all mounted under
``/api/workspaces/<slug>/projects/<project_id>/...`` (the archive /
unarchive subset lives in :mod:`plane.app.views.module.archive`; the
module-issue membership in :mod:`plane.app.views.module.issue`):

* :class:`ModuleViewSet` -- main ``ModelViewSet`` for module CRUD
  with extensive ORM annotations: favorite flag, six per-state issue
  counts, seven per-state estimate-point sums, member ID array, and
  preloaded ``link_module`` relation.
* :class:`ModuleLinkViewSet` -- CRUD on
  :class:`plane.db.models.ModuleLink` (external URL links attached
  to a module).
* :class:`ModuleFavoriteViewSet` -- toggles per-user favorite flag on
  modules via :class:`plane.db.models.UserFavorite`.
* :class:`ModuleUserPropertiesEndpoint` -- read / patch the requesting
  user's module filter and display preferences
  (:class:`plane.db.models.ModuleUserProperties`).

A module is a project-scoped, cross-cycle issue grouping with a
``status`` enum (BACKLOG / PLANNED / IN_PROGRESS / PAUSED / COMPLETED /
CANCELLED), a lead user, a member list, optional ``start_date`` /
``target_date``, ``view_props`` (JSON UI state), ``sort_order`` (float
for UI ordering), and ``logo_props`` (JSON icon/emoji selection).
Mutations queue Celery tasks via RabbitMQ for audit logging and
webhook fan-out:

* ``model_activity`` -- audit event for create/update with
  ``model_name="module"`` and ``webhook_event="module"`` (per tech
  spec §5.2.10 webhook delivery).
* ``issue_activity`` -- emitted per-issue with
  ``type="module.activity.deleted"`` when a module is destroyed (so
  individual issues retain audit trails referencing the deleted
  module).
* ``recent_visited_task`` -- queues a UserRecentVisit row insert on
  module retrieve.

All datetime fields in responses (``created_at``, ``updated_at``) are
converted to the requesting user's timezone via
:func:`plane.utils.timezone_converter.user_timezone_converter` before
serialization.
"""

# Python imports
import json

# Django Imports
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
from django.db import models
from django.db.models.functions import Coalesce, Cast, Concat
from django.core.serializers.json import DjangoJSONEncoder
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import (
    ProjectEntityPermission,
    ProjectLitePermission,
    allow_permission,
    ROLE,
)

from plane.app.serializers import (
    ModuleDetailSerializer,
    ModuleLinkSerializer,
    ModuleSerializer,
    ModuleUserPropertiesSerializer,
    ModuleWriteSerializer,
)
from plane.bgtasks.issue_activities_task import issue_activity
from plane.db.models import (
    Issue,
    Module,
    UserFavorite,
    ModuleIssue,
    ModuleLink,
    ModuleUserProperties,
    Project,
    UserRecentVisit,
)
from plane.utils.analytics_plot import burndown_plot
from plane.utils.timezone_converter import user_timezone_converter
from plane.bgtasks.webhook_task import model_activity
from .. import BaseAPIView, BaseViewSet
from plane.bgtasks.recent_visited_task import recent_visited_task
from plane.utils.host import base_host


class ModuleViewSet(BaseViewSet):
    """Project module CRUD: list / create / retrieve / partial_update / destroy.

    Resource managed:
        :class:`plane.db.models.Module` -- project-scoped, cross-cycle
        issue groupings with ``name`` (max 255 chars, unique per
        project), ``description`` (text + rich-text + html
        JSONFields), ``start_date`` / ``target_date`` (DateField,
        nullable), ``status`` (enum: ``backlog`` / ``planned`` /
        ``in-progress`` / ``paused`` / ``completed`` / ``cancelled`` --
        default ``"planned"``), ``lead`` (FK to User, nullable,
        on_delete=SET_NULL), ``members`` (M2M to User through
        ``ModuleMember``), ``view_props`` (JSONField default ``{}``),
        ``sort_order`` (float default 65535 -- new modules get
        smallest-10000 per the model's ``save()`` override),
        ``external_source`` / ``external_id`` (str, nullable for
        imported modules), ``archived_at`` (datetime, nullable),
        ``logo_props`` (JSONField default ``{}``).

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<uuid:project_id>/modules/
        POST   /api/workspaces/<slug>/projects/<uuid:project_id>/modules/
        GET    /api/workspaces/<slug>/projects/<uuid:project_id>/modules/<uuid:pk>/
        PUT    /api/workspaces/<slug>/projects/<uuid:project_id>/modules/<uuid:pk>/
        PATCH  /api/workspaces/<slug>/projects/<uuid:project_id>/modules/<uuid:pk>/
        DELETE /api/workspaces/<slug>/projects/<uuid:project_id>/modules/<uuid:pk>/

        The PUT path falls through to the DRF ``ModelViewSet`` default
        ``update`` method (not overridden in this class).

    Request body (POST / PATCH):
        name (str, required for POST, max 255): module name -- unique
            per project (the model enforces ``unique_together =
            ["name", "project", "deleted_at"]`` and a partial unique
            index when ``deleted_at IS NULL``).
        description (str, optional): plain-text description.
        description_text (JSONField, optional): rich-text editor state.
        description_html (JSONField, optional): HTML rendering of
            description.
        start_date (date, optional, nullable): module start.
        target_date (date, optional, nullable): module end. The
            ``ModuleWriteSerializer.validate`` method rejects with
            HTTP 400 if ``start_date > target_date``.
        status (str, optional, default ``"planned"``): one of
            ``backlog`` / ``planned`` / ``in-progress`` / ``paused`` /
            ``completed`` / ``cancelled``.
        lead_id (UUID, optional, nullable): FK to User.
        member_ids (list[UUID], optional, write-only on
            ``ModuleWriteSerializer``): the M2M membership list. On
            create, ``ModuleWriteSerializer.create`` bulk-creates
            ``ModuleMember`` rows for each user.
        view_props (JSONField, optional, default ``{}``): UI state.
        sort_order (float, optional): UI ordering.
        external_source / external_id (str, optional): for imported
            modules.
        logo_props (JSONField, optional, default ``{}``): icon /
            emoji selection.

        Read-only fields (set by the server -- see
        :class:`ModuleWriteSerializer.Meta.read_only_fields`):
        ``workspace``, ``project``, ``created_by``, ``updated_by``,
        ``created_at``, ``updated_at``, ``archived_at``, ``deleted_at``.

        Edit gates on PATCH:
            * Archived modules (``archived_at IS NOT NULL``) reject
              with HTTP 400 ``{"error": "Archived module cannot be
              updated"}``. To edit, the module must first be
              unarchived via
              :class:`plane.app.views.module.archive.ModuleArchiveUnarchiveEndpoint`.

    Response shape:
        :class:`plane.app.serializers.ModuleSerializer` shape (or
        :class:`ModuleDetailSerializer` for ``retrieve``). The
        list / create / partial_update flows return ``.values(...)``
        dictionaries directly (not via the serializer):

        Common keys:
            * ``id``, ``workspace_id``, ``project_id`` (required)
            * ``name``, ``description``, ``description_text``,
              ``description_html``, ``start_date``, ``target_date``,
              ``status``, ``lead_id``, ``member_ids``, ``view_props``,
              ``sort_order``, ``external_source``, ``external_id``,
              ``logo_props`` (model fields)
            * ``is_favorite`` (bool) -- user-specific Exists annotation
            * Six per-state issue counts (``total_issues``,
              ``completed_issues``, ``cancelled_issues``,
              ``started_issues``, ``unstarted_issues``,
              ``backlog_issues``) -- distinct Count annotations
            * ``completed_estimate_points``, ``total_estimate_points``
              (float) -- Sum aggregations
            * ``member_ids`` (list[UUID]) -- ArrayAgg of distinct
              member UUIDs
            * ``created_at``, ``updated_at`` (datetime, converted to
              requesting user's timezone)

        Detail (``retrieve``) additionally includes ``sub_issues``
        (int -- count of cycle issues with non-null parent), plus
        two computed nested keys:

        * ``estimate_distribution`` -- present (and populated) only
          when the project has an estimate of ``type="points"``.
          Contains ``{"assignees": [...], "labels": [...],
          "completion_chart": {...}}``. Completion chart is filled
          only when ``module.start_date`` and ``module.target_date``
          are both set.
        * ``distribution`` -- always populated. Same shape but counts
          ISSUES rather than estimate points. Completion chart is
          filled when ``module.total_issues > 0`` AND both dates are
          set.

        ``created_at`` and ``updated_at`` are converted to the
        requesting user's timezone via
        :func:`plane.utils.timezone_converter.user_timezone_converter`.

    Permissions:
        permission_classes = [IsAuthenticated]
            (inherited from :class:`plane.app.views.base.BaseViewSet`)

        Per-method via the ``@allow_permission`` decorator:
            * ``list``           -- ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST
            * ``create``         -- ROLE.ADMIN, ROLE.MEMBER
            * ``retrieve``       -- ROLE.ADMIN, ROLE.MEMBER (GUEST
              excluded because retrieve returns aggregate analytics
              that may include data the GUEST cannot otherwise see)
            * ``partial_update`` -- ROLE.ADMIN, ROLE.MEMBER
            * ``destroy``        -- ROLE.ADMIN (with ``creator=True,
              model=Module`` -- a non-admin MEMBER may delete a
              module they themselves created)

    Serializer routing (``get_serializer_class``):
        ``ModuleWriteSerializer`` for ``create`` / ``update`` /
        ``partial_update`` (handles write validation including the
        ``start_date <= target_date`` check and the M2M member
        bulk-create); ``ModuleSerializer`` (DynamicBaseSerializer-
        based, supporting field subsetting via the ``fields=``
        kwarg) for read paths.

    Side effects:
        * ``create`` queues
          ``model_activity.delay(model_name="module", model_id=...,
          requested_data=..., current_instance=None,
          actor_id=request.user.id, slug=..., origin=...)`` -- a
          Celery task (RabbitMQ-backed) that writes an audit row and
          emits a ``module`` webhook delivery via the workspace's
          configured webhooks (per tech spec §5.2.10).
        * ``partial_update`` queues ``model_activity.delay(...)`` with
          the ``current_instance`` JSON (pre-edit serialized state)
          for downstream diff tracking.
        * ``retrieve`` queues ``recent_visited_task.delay(
          slug=..., entity_name="module", entity_identifier=pk,
          user_id=..., project_id=...)`` -- a Celery task that
          inserts a :class:`plane.db.models.UserRecentVisit` row for
          the recent-visits surface.
        * ``destroy`` queues ``issue_activity.delay(
          type="module.activity.deleted", ...)`` PER ISSUE in the
          module (so each issue retains an audit trail referencing
          the deleted module's name), then hard-deletes the Module
          (via the model's ``.delete()`` -- soft delete), then
          hard-deletes related ``ModuleIssue``, ``UserFavorite``,
          and ``UserRecentVisit`` rows (recent visits use
          ``soft=False``).

    Queryset filter logic (``get_queryset``):
        Restricts to modules in the URL workspace
        (``workspace__slug``) and project (``project_id``).
        Annotations:

        * ``is_favorite`` -- Exists subquery against UserFavorite
          (per-user favorite flag, scoped to project + workspace).
        * Six per-state issue counts via Subquery against
          ``Issue.issue_objects`` joined through ``issue_module``
          (the ``ModuleIssue`` reverse relation) and filtered by
          ``issue_module__deleted_at__isnull=True`` (excludes
          soft-deleted memberships) and ``state__group`` (one of
          ``cancelled`` / ``completed`` / ``started`` / ``unstarted``
          / ``backlog``).
        * Seven per-state estimate-point sums via Subquery against
          ``Issue.issue_objects`` filtered additionally by
          ``estimate_point__estimate__type="points"`` (T-shirt sizes
          and other estimate types are excluded). Counts are
          Coalesce'd to 0 when no matching rows exist.
        * ``member_ids`` -- ArrayAgg of distinct member UUIDs
          excluding null IDs and rows where
          ``modulemember__deleted_at__isnull=False``.
        * ``prefetch_related("members")`` and a custom Prefetch on
          ``link_module`` (with
          ``ModuleLink.objects.select_related("module",
          "created_by")``) minimize downstream N+1 queries.

        Ordered by ``-is_favorite, -created_at``.

        Architectural note: this aggregation is heavy (six issue
        counts plus seven estimate sums per row) -- the inherited
        ``use_read_replica = False`` from BaseViewSet means all
        these queries hit the primary; subclasses or downstream
        callers may opt in to read replica routing.

    Class attributes:
        * ``model = Module``
        * ``webhook_event = "module"`` -- mutations trigger workspace
          webhook delivery (per tech spec §5.2.10) with this event
          name.
    """

    model = Module
    webhook_event = "module"

    def get_serializer_class(self):
        """Return the serializer class for the current action.

        ``ModuleWriteSerializer`` for ``create`` / ``update`` /
        ``partial_update``; ``ModuleSerializer`` for read actions.
        """
        return ModuleWriteSerializer if self.action in ["create", "update", "partial_update"] else ModuleSerializer

    def get_queryset(self):
        """Return the module queryset for the URL workspace/project.

        Annotated with ``is_favorite`` flag, six per-state issue counts,
        seven per-state estimate-point sums, and a member-IDs array.
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
            super()
            .get_queryset()
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(workspace__slug=self.kwargs.get("slug"))
            .annotate(is_favorite=Exists(favorite_subquery))
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
                        filter=Q(
                            members__id__isnull=False,
                            modulemember__deleted_at__isnull=True,
                        ),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                )
            )
            .order_by("-is_favorite", "-created_at")
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def create(self, request, slug, project_id):
        """Create a module and queue a ``model_activity`` Celery audit event.

        Validates the payload via ``ModuleWriteSerializer`` and returns
        the freshly-annotated row (HTTP 201) or serializer errors (HTTP 400).
        """
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        serializer = ModuleWriteSerializer(data=request.data, context={"project": project})

        if serializer.is_valid():
            serializer.save()

            module = (
                self.get_queryset()
                .filter(pk=serializer.data["id"])
                .values(  # Required fields
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
                    "logo_props",
                    # computed fields
                    "is_favorite",
                    "cancelled_issues",
                    "completed_issues",
                    "total_issues",
                    "started_issues",
                    "unstarted_issues",
                    "completed_estimate_points",
                    "total_estimate_points",
                    "backlog_issues",
                    "created_at",
                    "updated_at",
                )
            ).first()
            # Send the model activity
            model_activity.delay(
                model_name="module",
                model_id=str(module["id"]),
                requested_data=request.data,
                current_instance=None,
                actor_id=request.user.id,
                slug=slug,
                origin=base_host(request=request, is_app=True),
            )
            datetime_fields = ["created_at", "updated_at"]
            module = user_timezone_converter(module, datetime_fields, request.user.user_timezone)
            return Response(module, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def list(self, request, slug, project_id):
        """List active (non-archived) modules with computed annotations.

        Supports field-subsetting via ``self.fields`` (DynamicBaseSerializer)
        when the consumer sets it on the request.
        """
        queryset = self.get_queryset().filter(archived_at__isnull=True)
        if self.fields:
            modules = ModuleSerializer(queryset, many=True, fields=self.fields).data
        else:
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
                "logo_props",
                # computed fields
                "completed_estimate_points",
                "total_estimate_points",
                "total_issues",
                "is_favorite",
                "cancelled_issues",
                "completed_issues",
                "started_issues",
                "unstarted_issues",
                "backlog_issues",
                "created_at",
                "updated_at",
            )
            datetime_fields = ["created_at", "updated_at"]
            modules = user_timezone_converter(modules, datetime_fields, request.user.user_timezone)
        return Response(modules, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def retrieve(self, request, slug, project_id, pk):
        """Retrieve a single non-archived module with detail analytics.

        Adds ``sub_issues`` count, assignee/label distributions, and
        burndown chart; queues a ``recent_visited_task`` Celery event.
        """
        queryset = (
            self.get_queryset()
            .filter(archived_at__isnull=True)
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

        if not queryset.exists():
            return Response({"error": "Module not found"}, status=status.HTTP_404_NOT_FOUND)

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
                    issue_module__deleted_at__isnull=True,
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
                    When(assignees__avatar_asset__isnull=True, then="assignees__avatar"),
                    default=Value(None),
                    output_field=models.CharField(),
                )
            )
            .values("first_name", "last_name", "assignee_id", "avatar_url", "display_name")
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

        if modules and modules.start_date and modules.target_date and modules.total_issues > 0:
            data["distribution"]["completion_chart"] = burndown_plot(
                queryset=modules,
                slug=slug,
                project_id=project_id,
                plot_type="issues",
                module_id=pk,
            )

        recent_visited_task.delay(
            slug=slug,
            entity_name="module",
            entity_identifier=pk,
            user_id=request.user.id,
            project_id=project_id,
        )

        return Response(data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def partial_update(self, request, slug, project_id, pk):
        """Patch a module and queue a ``model_activity`` Celery audit event.

        Archived modules reject with HTTP 400. Captures pre-edit state as
        the ``current_instance`` JSON for downstream diff tracking.
        """
        module_queryset = self.get_queryset().filter(pk=pk)

        current_module = module_queryset.first()

        if not current_module:
            return Response(
                {"error": "Module not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        if current_module.archived_at:
            return Response(
                {"error": "Archived module cannot be updated"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        current_instance = json.dumps(ModuleSerializer(current_module).data, cls=DjangoJSONEncoder)
        serializer = ModuleWriteSerializer(current_module, data=request.data, partial=True)

        if serializer.is_valid():
            serializer.save()
            module = module_queryset.values(
                # Required fields
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
                "logo_props",
                # computed fields
                "completed_estimate_points",
                "total_estimate_points",
                "is_favorite",
                "cancelled_issues",
                "completed_issues",
                "started_issues",
                "total_issues",
                "unstarted_issues",
                "backlog_issues",
                "created_at",
                "updated_at",
            ).first()

            # Send the model activity
            model_activity.delay(
                model_name="module",
                model_id=str(module["id"]),
                requested_data=request.data,
                current_instance=current_instance,
                actor_id=request.user.id,
                slug=slug,
                origin=base_host(request=request, is_app=True),
            )

            datetime_fields = ["created_at", "updated_at"]
            module = user_timezone_converter(module, datetime_fields, request.user.user_timezone)
            return Response(module, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission([ROLE.ADMIN], creator=True, model=Module)
    def destroy(self, request, slug, project_id, pk):
        """Soft-delete a module (ADMIN or module creator only).

        Emits a per-issue ``issue_activity`` audit event, then cascade-deletes
        related ModuleIssue, UserFavorite, and UserRecentVisit rows.
        """
        module = Module.objects.get(workspace__slug=slug, project_id=project_id, pk=pk)

        module_issues = list(ModuleIssue.objects.filter(module_id=pk).values_list("issue", flat=True))
        _ = [
            issue_activity.delay(
                type="module.activity.deleted",
                requested_data=json.dumps({"module_id": str(pk)}),
                actor_id=str(request.user.id),
                issue_id=str(issue),
                project_id=project_id,
                current_instance=json.dumps({"module_name": str(module.name)}),
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )
            for issue in module_issues
        ]
        module.delete()
        # Delete the module issues
        ModuleIssue.objects.filter(module=pk, project_id=project_id).delete()
        # Delete the user favorite module
        UserFavorite.objects.filter(
            user=request.user,
            entity_type="module",
            entity_identifier=pk,
            project_id=project_id,
        ).delete()
        # delete the module from recent visits
        UserRecentVisit.objects.filter(
            project_id=project_id,
            workspace__slug=slug,
            entity_identifier=pk,
            entity_name="module",
        ).delete(soft=False)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ModuleLinkViewSet(BaseViewSet):
    """CRUD on external URL links attached to a project module.

    Resource managed:
        :class:`plane.db.models.ModuleLink` -- a link (URL + title +
        metadata JSONField) attached to a parent
        :class:`plane.db.models.Module`. Multiple links may be
        attached to the same module.

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/module-links/
        POST   /api/workspaces/<slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/module-links/
        GET    /api/workspaces/<slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/module-links/<uuid:pk>/
        PUT    /api/workspaces/<slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/module-links/<uuid:pk>/
        PATCH  /api/workspaces/<slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/module-links/<uuid:pk>/
        DELETE /api/workspaces/<slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/module-links/<uuid:pk>/

    Request body (POST / PATCH):
        url (str, required for POST): the link URL.
            :class:`plane.app.serializers.ModuleLinkSerializer.validate_url`
            enforces URL validity via ``URLValidator()`` and rejects
            with HTTP 400 if duplicate ``(url, module_id)`` exists.
        title (str, optional): link display title.
        metadata (JSONField, optional): arbitrary metadata
            (e.g. OG-fetched title, favicon).

    Response shape:
        :class:`plane.app.serializers.ModuleLinkSerializer` output.

    Permissions:
        permission_classes = [ProjectEntityPermission]

        ProjectEntityPermission requires the requesting user to be
        an active project member; for unsafe methods (POST / PATCH /
        DELETE) the user must additionally have ROLE.ADMIN or
        ROLE.MEMBER (GUEST is rejected).

    Side effects:
        * ``perform_create`` injects the URL kwargs ``project_id``
          and ``module_id`` into the serializer's save -- ensuring
          the link is correctly scoped without trusting the request
          body.

    Queryset filter logic (``get_queryset``):
        Restricts to ModuleLink rows where ``workspace__slug`` matches
        the URL, ``project_id`` matches the URL, ``module_id`` matches
        the URL, the requesting user is an ACTIVE project member, and
        the project is not archived. Orders by ``-created_at``;
        applies ``.distinct()``.
    """

    permission_classes = [ProjectEntityPermission]

    model = ModuleLink
    serializer_class = ModuleLinkSerializer

    def perform_create(self, serializer):
        """Save the ModuleLink with scope injected from URL kwargs.

        Injects ``project_id`` and ``module_id`` (defense against
        client-supplied scope overrides).
        """
        serializer.save(
            project_id=self.kwargs.get("project_id"),
            module_id=self.kwargs.get("module_id"),
        )

    def get_queryset(self):
        """Return the ModuleLink queryset for the URL workspace/project/module.

        Restricted to the requesting user's active project membership;
        ordered by ``-created_at``.
        """
        return (
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(module_id=self.kwargs.get("module_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
            )
            .order_by("-created_at")
            .distinct()
        )


class ModuleFavoriteViewSet(BaseViewSet):
    """Toggle the requesting user's favorite flag on modules.

    Resource managed:
        :class:`plane.db.models.UserFavorite` rows with
        ``entity_type="module"``. The ``entity_identifier`` field
        holds the target module's UUID. Favorites are user-scoped
        (each user sees only their own favorites).

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<uuid:project_id>/user-favorite-modules/
               (inherited list -- returns the user's favorited
               modules across this project)
        POST   /api/workspaces/<slug>/projects/<uuid:project_id>/user-favorite-modules/
        DELETE /api/workspaces/<slug>/projects/<uuid:project_id>/user-favorite-modules/<uuid:module_id>/

    Request body (POST):
        module (UUID, required): the module UUID to mark as
            favorite. This value is stored in
            ``UserFavorite.entity_identifier``.

    Response shape:
        POST: HTTP 204 NO_CONTENT with empty body (non-standard for
            a create response -- preserved per system boundary).
        DELETE: HTTP 204 NO_CONTENT with empty body.

    Permissions:
        permission_classes = [ProjectLitePermission]

        ProjectLitePermission requires only active project
        membership (no role restrictions on unsafe methods) --
        any active project member, including GUEST, can favorite
        a module.

    URL kwarg mapping:
        The DELETE URL's ``module_id`` kwarg maps to
        ``UserFavorite.entity_identifier`` -- NOT to the UserFavorite
        row's own primary key. The destroy filter combines
        ``user=request.user``, ``workspace__slug=slug``,
        ``entity_type="module"``, and ``entity_identifier=module_id``
        to locate the favorite row.

    Side effects:
        * ``destroy`` performs a HARD delete (``soft=False``) so the
          UserFavorite row is fully removed (no soft-delete
          tombstone).

    Queryset filter logic (``get_queryset``):
        Restricts to UserFavorite rows where ``workspace__slug``
        matches the URL and ``user`` is the requesting user, with
        ``select_related("module")`` for downstream consumers. The
        implicit ``entity_type="module"`` filter is applied per
        method in ``create`` and ``destroy`` (not in the queryset
        itself, so a list call returns favorites across all entity
        types in the workspace).
    """

    model = UserFavorite
    permission_classes = [ProjectLitePermission]

    def get_queryset(self):
        """Return the requesting user's UserFavorite queryset for this workspace.

        The related ``module`` is select_related-loaded for downstream
        consumers.
        """
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(user=self.request.user)
            .select_related("module")
        )

    def create(self, request, slug, project_id):
        """Create a UserFavorite row for the requesting user.

        Sets ``entity_type="module"`` and
        ``entity_identifier=request.data["module"]``.
        """
        _ = UserFavorite.objects.create(
            project_id=project_id,
            user=request.user,
            entity_type="module",
            entity_identifier=request.data.get("module"),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    def destroy(self, request, slug, project_id, module_id):
        """Hard-delete the requesting user's favorite for the URL-identified module.

        Uses ``soft=False`` to fully remove the UserFavorite row (no
        soft-delete tombstone).
        """
        module_favorite = UserFavorite.objects.get(
            project_id=project_id,
            user=request.user,
            workspace__slug=slug,
            entity_type="module",
            entity_identifier=module_id,
        )
        module_favorite.delete(soft=False)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ModuleUserPropertiesEndpoint(BaseAPIView):
    """Read or patch the requesting user's per-module UI preferences.

    Resource managed:
        :class:`plane.db.models.ModuleUserProperties` -- per-user,
        per-module UI state: applied filters, rich filters (advanced
        filter trees), display filters (layout / grouping
        selections), and display properties (which columns are
        visible).

    HTTP methods + URL patterns:
        GET   /api/workspaces/<slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/user-properties/
        PATCH /api/workspaces/<slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/user-properties/

    Request body (PATCH):
        filters (JSONField, optional): legacy filter dict.
        rich_filters (JSONField, optional): rich filter tree.
        display_filters (JSONField, optional): layout / grouping prefs.
        display_properties (JSONField, optional): visible column
            flags.
        All four fields default to the source model's defaults when
        first auto-created via the GET path.

    Response shape:
        :class:`plane.app.serializers.ModuleUserPropertiesSerializer`
        output (all four JSONField values plus FK / timestamp
        metadata).

        GET: HTTP 200.
        PATCH: HTTP 201 (non-standard -- typically PATCH returns 200;
            preserved per system boundary).

    Permissions:
        permission_classes = [IsAuthenticated]
            (inherited from :class:`plane.app.views.base.BaseAPIView`)

        Per-method via the ``@allow_permission`` decorator:
            * ``patch`` -- ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST
            * ``get``   -- ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST

        GUEST is permitted because UI preferences are per-user state
        and do not influence the underlying module data.

    Auto-provisioning:
        ``get`` uses ``get_or_create`` so the first read for a
        (user, module) pair lazily creates the properties row with
        the model's default JSONField values. ``patch`` uses
        ``.get(...)`` (NOT ``get_or_create``) -- it requires the row
        to exist (raising ``ObjectDoesNotExist`` → 404 via
        :meth:`BaseAPIView.handle_exception` otherwise).
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def patch(self, request, slug, project_id, module_id):
        """Patch the user's ModuleUserProperties row.

        Applies any provided ``filters`` / ``rich_filters`` /
        ``display_filters`` / ``display_properties`` values.
        """
        module_properties = ModuleUserProperties.objects.get(
            user=request.user,
            module_id=module_id,
            project_id=project_id,
            workspace__slug=slug,
        )

        module_properties.filters = request.data.get("filters", module_properties.filters)
        module_properties.rich_filters = request.data.get("rich_filters", module_properties.rich_filters)
        module_properties.display_filters = request.data.get("display_filters", module_properties.display_filters)
        module_properties.display_properties = request.data.get(
            "display_properties", module_properties.display_properties
        )
        module_properties.save()

        serializer = ModuleUserPropertiesSerializer(module_properties)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, module_id):
        """Return the requesting user's ModuleUserProperties row for the module.

        Auto-creates (via ``get_or_create``) with model defaults on first
        access so consumers always receive a populated row.
        """
        module_properties, _ = ModuleUserProperties.objects.get_or_create(
            user=request.user,
            project_id=project_id,
            module_id=module_id,
            workspace__slug=slug,
        )
        serializer = ModuleUserPropertiesSerializer(module_properties)
        return Response(serializer.data, status=status.HTTP_200_OK)
