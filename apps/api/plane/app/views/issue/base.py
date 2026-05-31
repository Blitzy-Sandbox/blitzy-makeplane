# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Core Issue HTTP endpoints (CRUD, paginated/grouped listings, bulk operations, meta lookup).

This module hosts the largest endpoint surface in the Plane backend.
It exposes ten classes covering the full lifecycle of an issue:

* :class:`IssueListEndpoint` -- grouped/sub-grouped listing (lightweight).
* :class:`IssueViewSet` -- full CRUD with rich annotations + timeline + webhook fan-out.
* :class:`IssuePaginatedViewSet` -- cursor-paginated v2 listing.
* :class:`IssueDetailEndpoint` -- detail listing with annotation chain.
* :class:`IssueDetailIdentifierEndpoint` -- resolves human-readable
  ``<PROJECT>-<SEQUENCE>`` identifiers to issues.
* :class:`IssueMetaEndpoint` -- minimal projection (sequence_id +
  project_identifier).
* :class:`ProjectUserDisplayPropertyEndpoint` -- per-user per-project
  view preferences (filter / display state persistence).
* :class:`BulkDeleteIssuesEndpoint` -- admin-only batch delete.
* :class:`DeletedIssuesListViewSet` -- returns IDs of archived /
  soft-deleted issues; uses the unfiltered ``Issue.all_objects``
  manager.

Write paths fan out to four Celery tasks (all via RabbitMQ; Redis is
NOT used as a queue here):

* :func:`plane.bgtasks.issue_activities_task.issue_activity` --
  appends to the issue activity timeline.
* :func:`plane.bgtasks.webhook_task.model_activity` -- delivers the
  ``issue`` webhook event to subscribed endpoints
  (HMAC-SHA256 signed; tech spec section 4.5).
* :func:`plane.bgtasks.issue_description_version_task.issue_description_version_task`
  -- snapshots the issue description to
  :class:`IssueDescriptionVersion` on every description change.
* :func:`plane.bgtasks.recent_visited_task.recent_visited_task` --
  upserts the requesting user's :class:`UserRecentVisit` row when an
  issue is retrieved.

Issue manager selection is deliberate and varies by endpoint:

* ``Issue.issue_objects`` -- default custom manager excluding archived
  AND deleted (used by most endpoints).
* ``Issue.objects`` -- Django default manager (excludes deleted only).
* ``Issue.all_objects`` -- unfiltered (used by
  :class:`DeletedIssuesListViewSet`).

Epics (``Issue.type.is_epic=True``) are intentionally excluded from
this surface via ``Q(type__isnull=True) | Q(type__is_epic=False)``;
epics have a separate workspace-level listing.
"""

# Python imports
import copy
import json

# Django imports
from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField
from django.core.serializers.json import DjangoJSONEncoder
from django.db.models import (
    Count,
    Exists,
    F,
    Func,
    OuterRef,
    Prefetch,
    Q,
    Subquery,
    UUIDField,
    Value,
)
from django.db.models.functions import Coalesce
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.gzip import gzip_page

# Third Party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import (
    IssueCreateSerializer,
    IssueDetailSerializer,
    IssueListDetailSerializer,
    IssueSerializer,
    ProjectUserPropertySerializer,
)
from plane.bgtasks.issue_activities_task import issue_activity
from plane.bgtasks.issue_description_version_task import issue_description_version_task
from plane.bgtasks.recent_visited_task import recent_visited_task
from plane.bgtasks.webhook_task import model_activity
from plane.db.models import (
    CycleIssue,
    FileAsset,
    IntakeIssue,
    Issue,
    IssueAssignee,
    IssueLabel,
    IssueLink,
    IssueReaction,
    IssueRelation,
    IssueSubscriber,
    ProjectUserProperty,
    ModuleIssue,
    Project,
    ProjectMember,
    UserRecentVisit,
)
from plane.utils.filters import ComplexFilterBackend, IssueFilterSet
from plane.utils.global_paginator import paginate
from plane.utils.grouper import (
    issue_group_values,
    issue_on_results,
    issue_queryset_grouper,
)
from plane.utils.host import base_host
from plane.utils.issue_filters import issue_filters
from plane.utils.order_queryset import order_issue_queryset
from plane.utils.paginator import GroupedOffsetPaginator, SubGroupedOffsetPaginator
from plane.utils.timezone_converter import user_timezone_converter

from .. import BaseAPIView, BaseViewSet


class IssueListEndpoint(BaseAPIView):
    """Lightweight grouped/sub-grouped issue listing.

    HTTP methods + URL patterns:
        GET /api/workspaces/<slug>/projects/<project_id>/issues/list/

    Query parameters:
        issues (str, required, comma-separated): issue IDs to list.
        expand (str, optional, comma-separated): nested expansions.
        fields (str, optional, comma-separated): field projection.
        order_by (str, optional, default ``-created_at``).
        group_by (str, optional).
        sub_group_by (str, optional): must differ from ``group_by``.
        plus any :class:`IssueFilterSet` filter.

    Response shape:
        Paginated grouped or sub-grouped dict (see
        :class:`GroupedOffsetPaginator` / :class:`SubGroupedOffsetPaginator`).

    Permissions:
        permission_classes -- not set; inherits ``[IsAuthenticated]``.
        Per-method gate: ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER,
        ROLE.GUEST])``.

    Class attributes:
        ``filter_backends = (ComplexFilterBackend,)``,
        ``filterset_class = IssueFilterSet``.
    """

    filter_backends = (ComplexFilterBackend,)
    filterset_class = IssueFilterSet

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        """Return a paginated issue listing with optional grouping/sub-grouping and field projection."""
        issue_ids = request.GET.get("issues", False)

        if not issue_ids:
            return Response({"error": "Issues are required"}, status=status.HTTP_400_BAD_REQUEST)

        issue_ids = [issue_id for issue_id in issue_ids.split(",") if issue_id != ""]

        # Base queryset with basic filters
        queryset = Issue.issue_objects.filter(workspace__slug=slug, project_id=project_id, pk__in=issue_ids)

        # Apply filtering from filterset
        queryset = self.filter_queryset(queryset)

        # Apply legacy filters
        filters = issue_filters(request.query_params, "GET")
        issue_queryset = queryset.filter(**filters)
        issue_queryset = issue_queryset.filter(state__deleted_at__isnull=True)

        # Add select_related, prefetch_related if fields or expand is not None
        if self.fields or self.expand:
            issue_queryset = issue_queryset.select_related("workspace", "project", "state", "parent").prefetch_related(
                "assignees", "labels", "issue_module__module"
            )

        # Add annotations
        issue_queryset = (
            issue_queryset.annotate(
                cycle_id=Subquery(
                    CycleIssue.objects.filter(issue=OuterRef("id"), deleted_at__isnull=True).values("cycle_id")[:1]
                )
            )
            .annotate(
                link_count=IssueLink.objects.filter(issue=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(
                attachment_count=FileAsset.objects.filter(
                    issue_id=OuterRef("id"),
                    entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
                )
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(
                sub_issues_count=Issue.issue_objects.filter(parent=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .distinct()
        )

        order_by_param = request.GET.get("order_by", "-created_at")
        # Issue queryset
        issue_queryset, _ = order_issue_queryset(issue_queryset=issue_queryset, order_by_param=order_by_param)

        # Group by
        group_by = request.GET.get("group_by", False)
        sub_group_by = request.GET.get("sub_group_by", False)

        # issue queryset
        issue_queryset = issue_queryset_grouper(queryset=issue_queryset, group_by=group_by, sub_group_by=sub_group_by)

        recent_visited_task.delay(
            slug=slug,
            project_id=project_id,
            entity_name="project",
            entity_identifier=project_id,
            user_id=request.user.id,
        )

        if self.fields or self.expand:
            issues = IssueSerializer(issue_queryset, many=True, fields=self.fields, expand=self.expand).data
        else:
            issues = issue_queryset.values(
                "id",
                "name",
                "state_id",
                "sort_order",
                "completed_at",
                "estimate_point",
                "priority",
                "start_date",
                "target_date",
                "sequence_id",
                "project_id",
                "parent_id",
                "cycle_id",
                "module_ids",
                "label_ids",
                "assignee_ids",
                "sub_issues_count",
                "created_at",
                "updated_at",
                "created_by",
                "updated_by",
                "attachment_count",
                "link_count",
                "is_draft",
                "archived_at",
                "deleted_at",
            )
            datetime_fields = ["created_at", "updated_at"]
            issues = user_timezone_converter(issues, datetime_fields, request.user.user_timezone)
        return Response(issues, status=status.HTTP_200_OK)


class IssueViewSet(BaseViewSet):
    """Full CRUD endpoint for issues (the largest endpoint surface in the backend).

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<project_id>/issues/
                (action: ``list``)
        POST   /api/workspaces/<slug>/projects/<project_id>/issues/
                (action: ``create``)
        GET    /api/workspaces/<slug>/projects/<project_id>/issues/<pk>/
                (action: ``retrieve``)
        PATCH  /api/workspaces/<slug>/projects/<project_id>/issues/<pk>/
                (action: ``partial_update``)
        DELETE /api/workspaces/<slug>/projects/<project_id>/issues/<pk>/
                (action: ``destroy``)

    Request body (POST / PATCH):
        Fields validated by :class:`IssueCreateSerializer` (used on
        create / update / partial_update -- see
        :meth:`get_serializer_class`); ~30 fields including:
            * ``name`` (str, required on POST).
            * ``description_html`` (str, optional) -- rich HTML body.
            * ``description_binary`` (bytes, optional) -- Y.Doc binary
              snapshot (written by ``apps/live`` HocusPocus).
            * ``description_stripped`` (str, optional) -- plain text.
            * ``state_id`` (UUID, optional).
            * ``priority`` (str enum: ``urgent``/``high``/``medium``/
              ``low``/``none``).
            * ``parent_id`` (UUID, optional) -- sub-issue parent.
            * ``estimate_point_id`` (UUID, optional).
            * ``start_date`` (date, optional) +
              ``target_date`` (date, optional).
            * ``cycle_id`` (UUID, optional) -- inline cycle assignment.
            * ``module_ids`` (list[UUID], optional) -- inline module
              assignment.
            * ``assignee_ids`` (list[UUID], optional).
            * ``label_ids`` (list[UUID], optional).

    Response shape:
        - ``list``: paginated (grouped or flat) via
          :class:`GroupedOffsetPaginator` /
          :class:`SubGroupedOffsetPaginator`.
        - ``retrieve``: :class:`IssueDetailSerializer` with reactions,
          links, and the ``is_subscribed`` annotation.
        - ``create``: projected ``values(...)`` dict (HTTP 201).
        - ``partial_update``: HTTP 204 on success.
        - ``destroy``: HTTP 204.

    Permissions:
        permission_classes -- not set on the class; inherits
        ``[IsAuthenticated]`` from :class:`BaseViewSet`.
        Per-method gates (preserved verbatim from source):
            * ``list``: ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER,
              ROLE.GUEST])``.
            * ``create``: ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER])``
              -- guests CANNOT create issues here.
            * ``retrieve``: ``@allow_permission(allowed_roles=[ROLE.ADMIN,
              ROLE.MEMBER, ROLE.GUEST], creator=True, model=Issue)``
              -- guests see only issues they created unless
              ``project.guest_view_all_features`` is true.
            * ``partial_update``: ``@allow_permission(allowed_roles=[
              ROLE.ADMIN, ROLE.MEMBER], creator=True, model=Issue)``
              -- guests CANNOT edit; members may edit issues they own.
            * ``destroy``: ``@allow_permission([ROLE.ADMIN], creator=True,
              model=Issue)`` -- admin-only delete (creators excluded
              from elevation via ``creator=True``).

    Serializer polymorphism:
        :meth:`get_serializer_class` returns
        :class:`IssueCreateSerializer` for ``create``/``update``/
        ``partial_update`` and :class:`IssueSerializer` for all reads,
        so write payloads accept a richer shape than the read response.

    get_queryset filter logic:
        ``Issue.issue_objects.filter(project_id, workspace__slug)``
        with ``.distinct()``. ``issue_objects`` excludes archived AND
        soft-deleted rows by default.

    Annotations (via :meth:`apply_annotations`):
        ``cycle_id``, ``link_count``, ``attachment_count``,
        ``sub_issues_count``. The per-action overrides additionally
        attach ``label_ids`` / ``assignee_ids`` / ``module_ids`` arrays
        (filtered to active members / non-archived modules).

    Side effects:
        * ``create``/``partial_update``/``destroy`` enqueue
          :func:`issue_activity` (Celery via RabbitMQ) for the issue
          timeline.
        * ``create``/``partial_update`` enqueue :func:`model_activity`
          for the ``issue`` webhook event (HMAC-SHA256; tech spec
          section 4.5).
        * ``create`` and ``partial_update`` enqueue
          :func:`issue_description_version_task` to snapshot the
          description content into :class:`IssueDescriptionVersion`.
        * ``retrieve`` enqueues :func:`recent_visited_task` to upsert
          the user's :class:`UserRecentVisit`.
        * ``destroy`` additionally hard-deletes related
          :class:`UserRecentVisit` rows for the issue.

    Class attributes:
        * ``model = Issue``
        * ``webhook_event = "issue"`` -- the webhook payload type.
        * ``search_fields = ["name"]`` -- DRF search filter scope.
        * ``filter_backends = (ComplexFilterBackend,)``
        * ``filterset_class = IssueFilterSet``

    Compression:
        ``list`` is decorated with ``@method_decorator(gzip_page)``.
    """

    model = Issue
    webhook_event = "issue"
    search_fields = ["name"]
    filter_backends = (ComplexFilterBackend,)
    filterset_class = IssueFilterSet

    def get_serializer_class(self):
        """Return the write or read serializer based on the current action.

        :class:`IssueCreateSerializer` is returned for ``create`` /
        ``update`` / ``partial_update``; :class:`IssueSerializer` is
        returned for all read actions.
        """
        return IssueCreateSerializer if self.action in ["create", "update", "partial_update"] else IssueSerializer

    def get_queryset(self):
        """Return ``Issue.issue_objects`` (active, non-archived issues) scoped to the URL's workspace + project."""
        issues = Issue.issue_objects.filter(
            project_id=self.kwargs.get("project_id"),
            workspace__slug=self.kwargs.get("slug"),
        ).distinct()

        return issues

    def apply_annotations(self, issues):
        """Annotate the queryset with the core issue rollups.

        Adds ``cycle_id``, ``link_count``, ``attachment_count``, and
        ``sub_issues_count`` via correlated subqueries.
        """
        issues = (
            issues.annotate(
                cycle_id=Subquery(
                    CycleIssue.objects.filter(issue=OuterRef("id"), deleted_at__isnull=True).values("cycle_id")[:1]
                )
            )
            .annotate(
                link_count=Subquery(
                    IssueLink.objects.filter(issue=OuterRef("id"))
                    .values("issue")
                    .annotate(count=Count("id"))
                    .values("count")
                )
            )
            .annotate(
                attachment_count=Subquery(
                    FileAsset.objects.filter(
                        issue_id=OuterRef("id"),
                        entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
                    )
                    .values("issue_id")
                    .annotate(count=Count("id"))
                    .values("count")
                )
            )
            .annotate(
                sub_issues_count=Subquery(
                    Issue.issue_objects.filter(parent=OuterRef("id"))
                    .values("parent")
                    .annotate(count=Count("id"))
                    .values("count")
                )
            )
        )

        return issues

    @method_decorator(gzip_page)
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def list(self, request, slug, project_id):
        """Return paginated issues with optional grouping and sorting.

        Supports ``group_by``, ``sub_group_by``, ``order_by``, and
        ``show_sub_issues`` query parameters. Response is gzipped.
        """
        extra_filters = {}
        if request.GET.get("updated_at__gt", None) is not None:
            extra_filters = {"updated_at__gt": request.GET.get("updated_at__gt")}

        project = Project.objects.get(pk=project_id, workspace__slug=slug)
        query_params = request.query_params.copy()

        filters = issue_filters(query_params, "GET")
        order_by_param = request.GET.get("order_by", "-created_at")

        issue_queryset = self.get_queryset()

        # Apply rich filters
        issue_queryset = self.filter_queryset(issue_queryset)

        # Apply legacy filters
        issue_queryset = issue_queryset.filter(**filters, **extra_filters)

        # Keeping a copy of the queryset before applying annotations
        filtered_issue_queryset = copy.deepcopy(issue_queryset)

        # Applying annotations to the issue queryset
        issue_queryset = self.apply_annotations(issue_queryset)

        # Issue queryset
        issue_queryset, order_by_param = order_issue_queryset(
            issue_queryset=issue_queryset, order_by_param=order_by_param
        )

        # Group by
        group_by = request.GET.get("group_by", False)
        sub_group_by = request.GET.get("sub_group_by", False)

        # issue queryset
        issue_queryset = issue_queryset_grouper(queryset=issue_queryset, group_by=group_by, sub_group_by=sub_group_by)

        recent_visited_task.delay(
            slug=slug,
            project_id=project_id,
            entity_name="project",
            entity_identifier=project_id,
            user_id=request.user.id,
        )
        if (
            ProjectMember.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                member=request.user,
                role=5,
                is_active=True,
            ).exists()
            and not project.guest_view_all_features
        ):
            issue_queryset = issue_queryset.filter(created_by=request.user)
            filtered_issue_queryset = filtered_issue_queryset.filter(created_by=request.user)

        if group_by:
            if sub_group_by:
                if group_by == sub_group_by:
                    return Response(
                        {
                            "error": "Group by and sub group by cannot have same parameters"  # noqa: E501
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                else:
                    return self.paginate(
                        request=request,
                        order_by=order_by_param,
                        queryset=issue_queryset,
                        total_count_queryset=filtered_issue_queryset,
                        on_results=lambda issues: issue_on_results(
                            group_by=group_by, issues=issues, sub_group_by=sub_group_by
                        ),
                        paginator_cls=SubGroupedOffsetPaginator,
                        group_by_fields=issue_group_values(
                            field=group_by,
                            slug=slug,
                            project_id=project_id,
                            filters=filters,
                            queryset=filtered_issue_queryset,
                        ),
                        sub_group_by_fields=issue_group_values(
                            field=sub_group_by,
                            slug=slug,
                            project_id=project_id,
                            filters=filters,
                            queryset=filtered_issue_queryset,
                        ),
                        group_by_field_name=group_by,
                        sub_group_by_field_name=sub_group_by,
                        count_filter=Q(
                            Q(issue_intake__status=1)
                            | Q(issue_intake__status=-1)
                            | Q(issue_intake__status=2)
                            | Q(issue_intake__isnull=True),
                            archived_at__isnull=True,
                            is_draft=False,
                        ),
                    )
            else:
                # Group paginate
                return self.paginate(
                    request=request,
                    order_by=order_by_param,
                    queryset=issue_queryset,
                    total_count_queryset=filtered_issue_queryset,
                    on_results=lambda issues: issue_on_results(
                        group_by=group_by, issues=issues, sub_group_by=sub_group_by
                    ),
                    paginator_cls=GroupedOffsetPaginator,
                    group_by_fields=issue_group_values(
                        field=group_by,
                        slug=slug,
                        project_id=project_id,
                        filters=filters,
                        queryset=filtered_issue_queryset,
                    ),
                    group_by_field_name=group_by,
                    count_filter=Q(
                        Q(issue_intake__status=1)
                        | Q(issue_intake__status=-1)
                        | Q(issue_intake__status=2)
                        | Q(issue_intake__isnull=True),
                        archived_at__isnull=True,
                        is_draft=False,
                    ),
                )
        else:
            return self.paginate(
                order_by=order_by_param,
                request=request,
                queryset=issue_queryset,
                total_count_queryset=filtered_issue_queryset,
                on_results=lambda issues: issue_on_results(group_by=group_by, issues=issues, sub_group_by=sub_group_by),
            )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def create(self, request, slug, project_id):
        """Create a new issue and enqueue downstream Celery tasks.

        Fans out ``issue.activity.created`` (via :func:`issue_activity`),
        ``issue`` webhook (via :func:`model_activity`), and
        :func:`issue_description_version_task` -- all Celery via RabbitMQ.
        """
        project = Project.objects.get(pk=project_id)

        serializer = IssueCreateSerializer(
            data=request.data,
            context={
                "project_id": project_id,
                "workspace_id": project.workspace_id,
                "default_assignee_id": project.default_assignee_id,
            },
        )

        if serializer.is_valid():
            serializer.save()

            # Track the issue
            issue_activity.delay(
                type="issue.activity.created",
                requested_data=json.dumps(self.request.data, cls=DjangoJSONEncoder),
                actor_id=str(request.user.id),
                issue_id=str(serializer.data.get("id", None)),
                project_id=str(project_id),
                current_instance=None,
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )
            queryset = self.get_queryset()
            queryset = self.apply_annotations(queryset)
            issue = (
                issue_queryset_grouper(
                    queryset=queryset.filter(pk=serializer.data["id"]),
                    group_by=None,
                    sub_group_by=None,
                )
                .values(
                    "id",
                    "name",
                    "state_id",
                    "sort_order",
                    "completed_at",
                    "estimate_point",
                    "priority",
                    "start_date",
                    "target_date",
                    "sequence_id",
                    "project_id",
                    "parent_id",
                    "cycle_id",
                    "module_ids",
                    "label_ids",
                    "assignee_ids",
                    "sub_issues_count",
                    "created_at",
                    "updated_at",
                    "created_by",
                    "updated_by",
                    "attachment_count",
                    "link_count",
                    "is_draft",
                    "archived_at",
                    "deleted_at",
                )
                .first()
            )
            datetime_fields = ["created_at", "updated_at"]
            issue = user_timezone_converter(issue, datetime_fields, request.user.user_timezone)
            # Send the model activity
            model_activity.delay(
                model_name="issue",
                model_id=str(serializer.data["id"]),
                requested_data=request.data,
                current_instance=None,
                actor_id=request.user.id,
                slug=slug,
                origin=base_host(request=request, is_app=True),
            )
            # updated issue description version
            issue_description_version_task.delay(
                updated_issue=json.dumps(request.data, cls=DjangoJSONEncoder),
                issue_id=str(serializer.data["id"]),
                user_id=request.user.id,
                is_creating=True,
            )
            return Response(issue, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], creator=True, model=Issue)
    def retrieve(self, request, slug, project_id, pk=None):
        """Return one issue with full annotations, reactions, and links.

        Annotates ``is_subscribed`` for the requesting user and
        enqueues :func:`recent_visited_task` to upsert their
        :class:`UserRecentVisit` row.
        """
        project = Project.objects.get(pk=project_id, workspace__slug=slug)

        issue = (
            Issue.objects.filter(
                project_id=self.kwargs.get("project_id"),
                workspace__slug=self.kwargs.get("slug"),
                pk=pk,
            )
            .select_related("state")
            .annotate(cycle_id=Subquery(CycleIssue.objects.filter(issue=OuterRef("id")).values("cycle_id")[:1]))
            .annotate(
                link_count=Subquery(
                    IssueLink.objects.filter(issue=OuterRef("id"))
                    .values("issue")
                    .annotate(count=Count("id"))
                    .values("count")
                )
            )
            .annotate(
                attachment_count=Subquery(
                    FileAsset.objects.filter(
                        issue_id=OuterRef("id"),
                        entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
                    )
                    .values("issue_id")
                    .annotate(count=Count("id"))
                    .values("count")
                )
            )
            .annotate(
                sub_issues_count=Subquery(
                    Issue.issue_objects.filter(parent=OuterRef("id"))
                    .values("parent")
                    .annotate(count=Count("id"))
                    .values("count")
                )
            )
            .annotate(
                label_ids=Coalesce(
                    Subquery(
                        IssueLabel.objects.filter(issue_id=OuterRef("pk"))
                        .values("issue_id")
                        .annotate(arr=ArrayAgg("label_id", distinct=True))
                        .values("arr")
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                assignee_ids=Coalesce(
                    Subquery(
                        IssueAssignee.objects.filter(
                            issue_id=OuterRef("pk"),
                            assignee__member_project__is_active=True,
                        )
                        .values("issue_id")
                        .annotate(arr=ArrayAgg("assignee_id", distinct=True))
                        .values("arr")
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                module_ids=Coalesce(
                    Subquery(
                        ModuleIssue.objects.filter(
                            issue_id=OuterRef("pk"),
                            module__archived_at__isnull=True,
                        )
                        .values("issue_id")
                        .annotate(arr=ArrayAgg("module_id", distinct=True))
                        .values("arr")
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
            )
            .prefetch_related(
                Prefetch(
                    "issue_reactions",
                    queryset=IssueReaction.objects.select_related("issue", "actor"),
                )
            )
            .prefetch_related(
                Prefetch(
                    "issue_link",
                    queryset=IssueLink.objects.select_related("created_by"),
                )
            )
            .annotate(
                is_subscribed=Exists(
                    IssueSubscriber.objects.filter(
                        workspace__slug=slug,
                        project_id=project_id,
                        issue_id=OuterRef("pk"),
                        subscriber=request.user,
                    )
                )
            )
        ).first()
        if not issue:
            return Response(
                {"error": "The required object does not exist."},
                status=status.HTTP_404_NOT_FOUND,
            )

        """
        if the role is guest and guest_view_all_features is false and owned by is not
        the requesting user then dont show the issue
        """

        if (
            ProjectMember.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                member=request.user,
                role=5,
                is_active=True,
            ).exists()
            and not project.guest_view_all_features
            and not issue.created_by == request.user
        ):
            return Response(
                {"error": "You are not allowed to view this issue"},
                status=status.HTTP_403_FORBIDDEN,
            )

        recent_visited_task.delay(
            slug=slug,
            entity_name="issue",
            entity_identifier=pk,
            user_id=request.user.id,
            project_id=project_id,
        )

        serializer = IssueDetailSerializer(issue, expand=self.expand)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], creator=True, model=Issue)
    def partial_update(self, request, slug, project_id, pk=None):
        """Patch the issue and fan out activity, webhook, and version tasks.

        Enqueues ``issue.activity.updated`` and the ``issue`` webhook,
        and snapshots the prior description via
        :func:`issue_description_version_task` whenever ``description_html``
        changes. The ``skip_activity`` request flag suppresses activity
        / webhook emission for migration-style description updates.
        """
        queryset = self.get_queryset()
        queryset = self.apply_annotations(queryset)

        skip_activity = request.data.pop("skip_activity", False)
        is_description_update = request.data.get("description_html") is not None

        issue = (
            queryset.annotate(
                label_ids=Coalesce(
                    ArrayAgg(
                        "labels__id",
                        distinct=True,
                        filter=Q(~Q(labels__id__isnull=True) & Q(label_issue__deleted_at__isnull=True)),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                assignee_ids=Coalesce(
                    ArrayAgg(
                        "assignees__id",
                        distinct=True,
                        filter=Q(
                            ~Q(assignees__id__isnull=True)
                            & Q(assignees__member_project__is_active=True)
                            & Q(issue_assignee__deleted_at__isnull=True)
                        ),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                module_ids=Coalesce(
                    ArrayAgg(
                        "issue_module__module_id",
                        distinct=True,
                        filter=Q(
                            ~Q(issue_module__module_id__isnull=True)
                            & Q(issue_module__module__archived_at__isnull=True)
                            & Q(issue_module__deleted_at__isnull=True)
                        ),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
            )
            .filter(pk=pk)
            .first()
        )

        if not issue:
            return Response({"error": "Issue not found"}, status=status.HTTP_404_NOT_FOUND)

        current_instance = json.dumps(IssueDetailSerializer(issue).data, cls=DjangoJSONEncoder)

        requested_data = json.dumps(self.request.data, cls=DjangoJSONEncoder)
        serializer = IssueCreateSerializer(issue, data=request.data, partial=True, context={"project_id": project_id})
        if serializer.is_valid():
            serializer.save()
            # Check if the update is a migration description update
            is_migration_description_update = skip_activity and is_description_update
            # Log all the updates
            if not is_migration_description_update:
                issue_activity.delay(
                    type="issue.activity.updated",
                    requested_data=requested_data,
                    actor_id=str(request.user.id),
                    issue_id=str(pk),
                    project_id=str(project_id),
                    current_instance=current_instance,
                    epoch=int(timezone.now().timestamp()),
                    notification=True,
                    origin=base_host(request=request, is_app=True),
                )
                model_activity.delay(
                    model_name="issue",
                    model_id=str(serializer.data.get("id", None)),
                    requested_data=request.data,
                    current_instance=current_instance,
                    actor_id=request.user.id,
                    slug=slug,
                    origin=base_host(request=request, is_app=True),
                )
                # updated issue description version
                issue_description_version_task.delay(
                    updated_issue=current_instance,
                    issue_id=str(serializer.data.get("id", None)),
                    user_id=request.user.id,
                )
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission([ROLE.ADMIN], creator=True, model=Issue)
    def destroy(self, request, slug, project_id, pk=None):
        """Delete the issue (admin-only) and clean up downstream rows.

        Hard-deletes any related :class:`UserRecentVisit` rows and
        enqueues an ``issue.activity.deleted`` Celery task.
        """
        issue = Issue.objects.get(workspace__slug=slug, project_id=project_id, pk=pk)

        issue.delete()
        # delete the issue from recent visits
        UserRecentVisit.objects.filter(
            project_id=project_id,
            workspace__slug=slug,
            entity_identifier=pk,
            entity_name="issue",
        ).delete(soft=False)
        issue_activity.delay(
            type="issue.activity.deleted",
            requested_data=json.dumps({"issue_id": str(pk)}),
            actor_id=str(request.user.id),
            issue_id=str(pk),
            project_id=str(project_id),
            current_instance={},
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
            subscriber=False,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectUserDisplayPropertyEndpoint(BaseAPIView):
    """Per-user per-project UI display preferences (filter/sort/display-mode persistence).

    HTTP methods + URL patterns:
        GET   /api/workspaces/<slug>/projects/<project_id>/user-properties/
        PATCH /api/workspaces/<slug>/projects/<project_id>/user-properties/

    Request body (PATCH):
        Fields validated by :class:`ProjectUserPropertySerializer`
        (display_filters, filters, display_properties dicts).

    Response shape:
        :class:`ProjectUserPropertySerializer` output.

    Permissions:
        permission_classes -- not set; inherits ``[IsAuthenticated]``.
        Per-method gate: ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER,
        ROLE.GUEST])``.

    Semantics:
        The row is upserted -- PATCH creates the row if it does not
        exist (``DoesNotExist`` fallback); GET also creates one via
        ``get_or_create``.
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def patch(self, request, slug, project_id):
        """Upsert the per-user-per-project :class:`ProjectUserProperty` row and apply the partial payload."""
        try:
            issue_property = ProjectUserProperty.objects.get(
                user=request.user, 
                project_id=project_id
            )
        except ProjectUserProperty.DoesNotExist:
            issue_property = ProjectUserProperty.objects.create(
                user=request.user, 
                project_id=project_id
            )

        serializer = ProjectUserPropertySerializer(
            issue_property, 
            data=request.data,
            partial=True
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        """Fetch (or create with defaults) the requesting user's :class:`ProjectUserProperty` row for the project."""
        issue_property, _ = ProjectUserProperty.objects.get_or_create(user=request.user, project_id=project_id)
        serializer = ProjectUserPropertySerializer(issue_property)
        return Response(serializer.data, status=status.HTTP_200_OK)


class BulkDeleteIssuesEndpoint(BaseAPIView):
    """Admin-only bulk delete endpoint for issues.

    HTTP methods + URL patterns:
        DELETE /api/workspaces/<slug>/projects/<project_id>/bulk-delete-issues/

    Request body:
        issue_ids (list[UUID], required): the issues to delete.

    Response shape:
        Success: ``{"message": "<N> issues were deleted"}`` (HTTP 200).
        Empty list: HTTP 400 ``{"error": "Issue IDs are required"}``.

    Permissions:
        permission_classes -- not set; inherits ``[IsAuthenticated]``.
        Per-method gate: ``@allow_permission([ROLE.ADMIN])`` -- admins
        only.

    Side effects (executed in this order):
        1. Delete all :class:`CycleIssue` rows referencing the issues.
        2. Delete all :class:`ModuleIssue` rows referencing the issues.
        3. Delete the issues themselves
           (``Issue.issue_objects.filter(...).delete()``).

    Note:
        This endpoint does NOT enqueue per-issue activity tasks;
        operators should treat bulk deletions as audit-loggable
        out-of-band.
    """

    @allow_permission([ROLE.ADMIN])
    def delete(self, request, slug, project_id):
        """Delete cycle / module FK rows then the issues themselves.

        Returns ``{"message": "<N> issues were deleted"}`` on success
        or HTTP 400 if ``issue_ids`` is empty.
        """
        issue_ids = request.data.get("issue_ids", [])

        if not len(issue_ids):
            return Response({"error": "Issue IDs are required"}, status=status.HTTP_400_BAD_REQUEST)

        issues = Issue.issue_objects.filter(workspace__slug=slug, project_id=project_id, pk__in=issue_ids)

        total_issues = len(issues)

        # First, delete all related cycle issues
        CycleIssue.objects.filter(issue_id__in=issue_ids).delete()

        # Then, delete all related module issues
        ModuleIssue.objects.filter(issue_id__in=issue_ids).delete()

        # Finally, delete the issues themselves
        issues.delete()

        return Response(
            {"message": f"{total_issues} issues were deleted"},
            status=status.HTTP_200_OK,
        )


class DeletedIssuesListViewSet(BaseAPIView):
    """List the IDs of archived OR soft-deleted issues (uses the unfiltered ``Issue.all_objects`` manager).

    HTTP methods + URL patterns:
        GET /api/workspaces/<slug>/projects/<project_id>/deleted-issues/

    Query parameters:
        updated_at__gt (str ISO datetime, optional): only return issues
            updated after this timestamp (used by sync clients for
            incremental refresh).

    Response shape:
        Flat list of issue ``id`` UUIDs (HTTP 200).

    Permissions:
        permission_classes -- not set; inherits ``[IsAuthenticated]``.
        Per-method gate: ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER,
        ROLE.GUEST])``.

    Manager selection:
        Uses ``Issue.all_objects`` (the unfiltered manager) so both
        archived AND soft-deleted rows are returned. Filtered by
        ``Q(archived_at__isnull=False) | Q(deleted_at__isnull=False)``.

    Note:
        Despite the ``...ViewSet`` suffix this class extends
        :class:`BaseAPIView`, not a DRF ViewSet -- the URL is registered
        as a plain ``as_view()``.
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        """Return IDs of archived or soft-deleted issues.

        Optionally filtered to those updated after ``updated_at__gt``
        (used by sync clients for incremental refresh).
        """
        filters = {}
        if request.GET.get("updated_at__gt", None) is not None:
            filters = {"updated_at__gt": request.GET.get("updated_at__gt")}
        deleted_issues = (
            Issue.all_objects.filter(workspace__slug=slug, project_id=project_id)
            .filter(Q(archived_at__isnull=False) | Q(deleted_at__isnull=False))
            .filter(**filters)
            .values_list("id", flat=True)
        )

        return Response(deleted_issues, status=status.HTTP_200_OK)


class IssuePaginatedViewSet(BaseViewSet):
    """Cursor-paginated v2 issue listing (large-result-set variant).

    HTTP methods + URL patterns:
        GET /api/workspaces/<slug>/projects/<project_id>/v2/issues/

    Query parameters:
        cursor (str, optional): pagination cursor returned by the
            previous page.
        description (str ``"true"``/``"false"``, optional, default
            ``"false"``): include ``description_html`` in the projection.
        updated_at__gt (str ISO datetime, optional): incremental refresh
            filter.
        plus any :class:`IssueFilterSet` filter.

    Response shape:
        ``{"results": [<values dict per issue>], "next_cursor": str, ...}``
        -- the per-row shape is the projection of the values list
        (id, name, state_id, sort_order, priority, sequence_id,
        project_id, etc.) with ``created_at`` and ``updated_at``
        converted to the requesting user's ``user_timezone``.

    Permissions:
        permission_classes -- not set; inherits ``[IsAuthenticated]``.
        Per-method gate on ``list``:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])``.

    Annotations (via :meth:`get_queryset`):
        Same set as :class:`IssueViewSet.apply_annotations`
        (``cycle_id``, ``link_count``, ``attachment_count``,
        ``sub_issues_count``); the ``list`` action additionally annotates
        ``label_ids``, ``assignee_ids``, ``module_ids``.

    Pagination engine:
        :func:`plane.utils.global_paginator.paginate` -- opaque cursor
        encoded from the ordering fields.
    """

    def get_queryset(self):
        """Return the annotated active-issue queryset scoped to the URL's workspace + project."""
        workspace_slug = self.kwargs.get("slug")
        project_id = self.kwargs.get("project_id")

        issue_queryset = Issue.issue_objects.filter(workspace__slug=workspace_slug, project_id=project_id)

        return (
            issue_queryset.select_related("state")
            .annotate(cycle_id=Subquery(CycleIssue.objects.filter(issue=OuterRef("id")).values("cycle_id")[:1]))
            .annotate(
                link_count=Subquery(
                    IssueLink.objects.filter(issue=OuterRef("id"))
                    .values("issue")
                    .annotate(count=Count("id"))
                    .values("count")
                )
            )
            .annotate(
                attachment_count=Subquery(
                    FileAsset.objects.filter(
                        issue_id=OuterRef("id"),
                        entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
                    )
                    .values("issue_id")
                    .annotate(count=Count("id"))
                    .values("count")
                )
            )
            .annotate(
                sub_issues_count=Subquery(
                    Issue.issue_objects.filter(parent=OuterRef("id"))
                    .values("parent")
                    .annotate(count=Count("id"))
                    .values("count")
                )
            )
        )

    def process_paginated_result(self, fields, results, timezone):
        """Project the paginated queryset to ``fields`` and shift datetimes.

        Applies ``.values(*fields)`` then converts ``created_at`` /
        ``updated_at`` to the user's ``timezone``.
        """
        paginated_data = results.values(*fields)

        # converting the datetime fields in paginated data
        datetime_fields = ["created_at", "updated_at"]
        paginated_data = user_timezone_converter(paginated_data, datetime_fields, timezone)

        return paginated_data

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def list(self, request, slug, project_id):
        """Return cursor-paginated issues with annotations and timezone-converted datetimes."""
        cursor = request.GET.get("cursor", None)
        is_description_required = request.GET.get("description", "false")
        updated_at = request.GET.get("updated_at__gt", None)

        # required fields
        required_fields = [
            "id",
            "name",
            "state_id",
            "state__group",
            "sort_order",
            "completed_at",
            "estimate_point",
            "priority",
            "start_date",
            "target_date",
            "sequence_id",
            "project_id",
            "parent_id",
            "cycle_id",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
            "is_draft",
            "archived_at",
            "module_ids",
            "label_ids",
            "assignee_ids",
            "link_count",
            "attachment_count",
            "sub_issues_count",
        ]

        if str(is_description_required).lower() == "true":
            required_fields.append("description_html")

        # querying issues
        base_queryset = Issue.issue_objects.filter(workspace__slug=slug, project_id=project_id)

        base_queryset = base_queryset.order_by("updated_at")
        queryset = self.get_queryset().order_by("updated_at")

        # validation for guest user
        project = Project.objects.get(pk=project_id, workspace__slug=slug)
        project_member = ProjectMember.objects.filter(
            workspace__slug=slug,
            project_id=project_id,
            member=request.user,
            role=5,
            is_active=True,
        )
        if project_member.exists() and not project.guest_view_all_features:
            base_queryset = base_queryset.filter(created_by=request.user)
            queryset = queryset.filter(created_by=request.user)

        # filtering issues by greater then updated_at given by the user
        if updated_at:
            base_queryset = base_queryset.filter(updated_at__gt=updated_at)
            queryset = queryset.filter(updated_at__gt=updated_at)

        queryset = queryset.annotate(
            label_ids=Coalesce(
                Subquery(
                    IssueLabel.objects.filter(issue_id=OuterRef("pk"))
                    .values("issue_id")
                    .annotate(arr=ArrayAgg("label_id", distinct=True))
                    .values("arr")
                ),
                Value([], output_field=ArrayField(UUIDField())),
            ),
            assignee_ids=Coalesce(
                Subquery(
                    IssueAssignee.objects.filter(
                        issue_id=OuterRef("pk"),
                        assignee__member_project__is_active=True,
                    )
                    .values("issue_id")
                    .annotate(arr=ArrayAgg("assignee_id", distinct=True))
                    .values("arr")
                ),
                Value([], output_field=ArrayField(UUIDField())),
            ),
            module_ids=Coalesce(
                Subquery(
                    ModuleIssue.objects.filter(
                        issue_id=OuterRef("pk"),
                        module__archived_at__isnull=True,
                    )
                    .values("issue_id")
                    .annotate(arr=ArrayAgg("module_id", distinct=True))
                    .values("arr")
                ),
                Value([], output_field=ArrayField(UUIDField())),
            ),
        )

        paginated_data = paginate(
            base_queryset=base_queryset,
            queryset=queryset,
            cursor=cursor,
            on_result=lambda results: self.process_paginated_result(
                required_fields, results, request.user.user_timezone
            ),
        )

        return Response(paginated_data, status=status.HTTP_200_OK)


class IssueDetailEndpoint(BaseAPIView):
    """Detail-mode paginated issue listing with the full annotation chain.

    HTTP methods + URL patterns:
        GET /api/workspaces/<slug>/projects/<project_id>/issues-detail/

    Query parameters:
        Same filters as :class:`IssueViewSet.list` plus cursor /
        grouping options.

    Response shape:
        Paginated detail rows produced by
        :class:`IssueListDetailSerializer` (HTTP 200).

    Permissions:
        permission_classes -- not set; inherits ``[IsAuthenticated]``.
        Per-method gate: ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER,
        ROLE.GUEST])``. Guests see only issues they created unless
        ``project.guest_view_all_features`` is true (enforced inline by
        a permission subquery filter).

    Class attributes:
        ``filter_backends = (ComplexFilterBackend,)``,
        ``filterset_class = IssueFilterSet``.
    """

    filter_backends = (ComplexFilterBackend,)
    filterset_class = IssueFilterSet

    def apply_annotations(self, issues):
        """Annotate the queryset with the full detail-rendering set.

        Adds ``cycle_id``, ``link_count``, ``attachment_count``, and
        ``sub_issues_count``, then prefetches ``issue_assignee``,
        ``label_issue``, and ``issue_module`` relations.
        """
        return (
            issues.annotate(
                cycle_id=Subquery(
                    CycleIssue.objects.filter(issue=OuterRef("id"), deleted_at__isnull=True).values("cycle_id")[:1]
                )
            )
            .annotate(
                link_count=IssueLink.objects.filter(issue=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(
                attachment_count=FileAsset.objects.filter(
                    issue_id=OuterRef("id"),
                    entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
                )
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(
                sub_issues_count=Issue.issue_objects.filter(parent=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .prefetch_related(
                Prefetch(
                    "issue_assignee",
                    queryset=IssueAssignee.objects.all(),
                )
            )
            .prefetch_related(
                Prefetch(
                    "label_issue",
                    queryset=IssueLabel.objects.all(),
                )
            )
            .prefetch_related(
                Prefetch(
                    "issue_module",
                    queryset=ModuleIssue.objects.all(),
                )
            )
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        """Return paginated detail-mode issues with full annotations and a guest-aware permission subquery filter."""
        filters = issue_filters(request.query_params, "GET")

        # check for the project member role, if the role is 5 then check for the guest_view_all_features
        #  if it is true then show all the issues else show only the issues created by the user
        permission_subquery = (
            Issue.issue_objects.filter(workspace__slug=slug, project_id=project_id, id=OuterRef("id"))
            .filter(
                Q(
                    project__project_projectmember__member=self.request.user,
                    project__project_projectmember__is_active=True,
                    project__project_projectmember__role__gt=ROLE.GUEST.value,
                )
                | Q(
                    project__project_projectmember__member=self.request.user,
                    project__project_projectmember__is_active=True,
                    project__project_projectmember__role=ROLE.GUEST.value,
                    project__guest_view_all_features=True,
                )
                | Q(
                    project__project_projectmember__member=self.request.user,
                    project__project_projectmember__is_active=True,
                    project__project_projectmember__role=ROLE.GUEST.value,
                    project__guest_view_all_features=False,
                    created_by=self.request.user,
                )
            )
            .values("id")
        )
        # Main issue query
        issue = Issue.issue_objects.filter(workspace__slug=slug, project_id=project_id).filter(
            Exists(permission_subquery)
        )

        # Add additional prefetch based on expand parameter
        if self.expand:
            if "issue_relation" in self.expand:
                issue = issue.prefetch_related(
                    Prefetch(
                        "issue_relation",
                        queryset=IssueRelation.objects.select_related("related_issue"),
                    )
                )
            if "issue_related" in self.expand:
                issue = issue.prefetch_related(
                    Prefetch(
                        "issue_related",
                        queryset=IssueRelation.objects.select_related("issue"),
                    )
                )

        # Apply filtering from filterset
        issue = self.filter_queryset(issue)

        # Apply legacy filters
        issue = issue.filter(**filters)

        # Total count queryset
        total_issue_queryset = copy.deepcopy(issue)

        # Applying annotations to the issue queryset
        issue = self.apply_annotations(issue)

        order_by_param = request.GET.get("order_by", "-created_at")

        # Issue queryset
        issue, order_by_param = order_issue_queryset(issue_queryset=issue, order_by_param=order_by_param)
        return self.paginate(
            request=request,
            order_by=order_by_param,
            queryset=issue,
            total_count_queryset=total_issue_queryset,
            on_results=lambda issue: IssueListDetailSerializer(
                issue, many=True, fields=self.fields, expand=self.expand
            ).data,
        )


class IssueBulkUpdateDateEndpoint(BaseAPIView):
    """Bulk update ``start_date`` / ``target_date`` on many issues in one request, with cross-issue date validation.

    HTTP methods + URL patterns:
        POST /api/workspaces/<slug>/projects/<project_id>/issue-dates/

    Request body:
        updates (list[dict], required): each dict carries
            ``id`` (UUID), ``start_date`` (date, optional),
            ``target_date`` (date, optional).

    Response shape:
        Success: ``{"message": "Issues updated successfully"}`` (HTTP 200).
        Invalid pair: ``{"message": "Start date cannot exceed target date"}``
            (HTTP 400).

    Permissions:
        permission_classes -- not set; inherits ``[IsAuthenticated]``.
        Per-method gate on ``post``:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER])`` -- guests cannot
        bulk-edit dates.

    Side effects:
        Enqueues ``issue.activity.updated`` Celery activity tasks for
        each modified ``start_date`` / ``target_date`` change.

    Validation:
        :meth:`validate_dates` enforces that ``start_date <= target_date``
        before applying the update.
    """

    def validate_dates(self, current_start, current_target, new_start, new_target):
        """Validate that start date is before target date."""
        from datetime import datetime

        start = new_start or current_start
        target = new_target or current_target

        # Convert string dates to datetime objects if they're strings
        if isinstance(start, str):
            start = datetime.strptime(start, "%Y-%m-%d").date()
        if isinstance(target, str):
            target = datetime.strptime(target, "%Y-%m-%d").date()

        if start and target and start > target:
            return False
        return True

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id):
        """Bulk-update ``start_date`` / ``target_date`` on the supplied issues.

        Each pair is validated via :meth:`validate_dates` before the
        bulk ``Issue.objects.bulk_update(...)`` call.
        """
        updates = request.data.get("updates", [])

        issue_ids = [update["id"] for update in updates]
        epoch = int(timezone.now().timestamp())

        # Fetch all relevant issues in a single query
        issues = list(Issue.objects.filter(id__in=issue_ids, workspace__slug=slug, project_id=project_id))
        issues_dict = {str(issue.id): issue for issue in issues}
        issues_to_update = []

        for update in updates:
            issue_id = update["id"]
            issue = issues_dict.get(issue_id)

            if not issue:
                continue

            start_date = update.get("start_date")
            target_date = update.get("target_date")
            validate_dates = self.validate_dates(issue.start_date, issue.target_date, start_date, target_date)
            if not validate_dates:
                return Response(
                    {"message": "Start date cannot exceed target date"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if start_date:
                issue_activity.delay(
                    type="issue.activity.updated",
                    requested_data=json.dumps({"start_date": update.get("start_date")}),
                    current_instance=json.dumps({"start_date": str(issue.start_date)}),
                    issue_id=str(issue_id),
                    actor_id=str(request.user.id),
                    project_id=str(project_id),
                    epoch=epoch,
                )
                issue.start_date = start_date
                issues_to_update.append(issue)

            if target_date:
                issue_activity.delay(
                    type="issue.activity.updated",
                    requested_data=json.dumps({"target_date": update.get("target_date")}),
                    current_instance=json.dumps({"target_date": str(issue.target_date)}),
                    issue_id=str(issue_id),
                    actor_id=str(request.user.id),
                    project_id=str(project_id),
                    epoch=epoch,
                )
                issue.target_date = target_date
                issues_to_update.append(issue)

        # Bulk update issues
        Issue.objects.bulk_update(issues_to_update, ["start_date", "target_date"])

        return Response({"message": "Issues updated successfully"}, status=status.HTTP_200_OK)


class IssueMetaEndpoint(BaseAPIView):
    """Minimal issue metadata projection used by lightweight UI surfaces.

    Returns ``sequence_id`` + ``project_identifier`` only -- consumed by
    tab titles, breadcrumbs, and similar low-payload contexts.

    HTTP methods + URL patterns:
        GET /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/meta/

    Response shape:
        ``{"sequence_id": int, "project_identifier": str}`` (HTTP 200).

    Permissions:
        permission_classes -- not set; inherits ``[IsAuthenticated]``.
        Per-method gate: ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER,
        ROLE.GUEST], level="PROJECT")`` -- note the explicit
        ``level="PROJECT"`` kwarg restricting the check to project-level
        membership.
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="PROJECT")
    def get(self, request, slug, project_id, issue_id):
        """Return ``{"sequence_id": int, "project_identifier": str}`` for the issue."""
        issue = Issue.issue_objects.only("sequence_id", "project__identifier").get(
            id=issue_id, project_id=project_id, workspace__slug=slug
        )
        return Response(
            {
                "sequence_id": issue.sequence_id,
                "project_identifier": issue.project.identifier,
            },
            status=status.HTTP_200_OK,
        )


class IssueDetailIdentifierEndpoint(BaseAPIView):
    """Resolve a human-readable ``<PROJECT_IDENTIFIER>-<ISSUE_SEQUENCE>`` URL to an issue.

    HTTP methods + URL patterns:
        GET /api/workspaces/<slug>/work-items/<project_identifier>-<issue_identifier>/

    URL kwargs:
        project_identifier (str): the project's short identifier
            (e.g. ``PROJ``).
        issue_identifier (str): the issue's ``sequence_id`` -- must be
            a strict integer string (validated by
            :meth:`strict_str_to_int`); leading/trailing whitespace and
            decimal points cause HTTP 400.

    Response shape:
        Full issue detail (same as :class:`IssueViewSet.retrieve`) or
        HTTP 400 on invalid identifier / HTTP 404 if no match /
        HTTP 403 if the requester is not a project member.

    Permissions:
        permission_classes -- not set; inherits ``[IsAuthenticated]``.
        No ``@allow_permission`` decorator -- IsAuthenticated only;
        member-level access is enforced inline by an explicit
        :class:`ProjectMember` lookup in :meth:`get`.

    Side effects:
        On success enqueues :func:`recent_visited_task` to upsert the
        requesting user's :class:`UserRecentVisit` row.
    """

    def strict_str_to_int(self, s):
        """Convert ``s`` to int, accepting only strict digit strings.

        Optionally allows a leading ``-``. Raises :class:`ValueError`
        for any other input (whitespace, decimals, mixed characters).
        """
        if not s.isdigit() and not (s.startswith("-") and s[1:].isdigit()):
            raise ValueError("Invalid integer string")
        return int(s)

    def get(self, request, slug, project_identifier, issue_identifier):
        """Resolve the issue by ``<project_identifier>-<issue_identifier>``.

        ``issue_identifier`` is the issue's ``sequence_id`` (integer string).
        Returns the full issue detail or HTTP 400/403/404 on failures.
        """
        # Check if the issue identifier is a valid integer
        try:
            issue_identifier = self.strict_str_to_int(issue_identifier)
        except ValueError:
            return Response(
                {"error": "Invalid issue identifier"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Fetch the project
        project = Project.objects.get(identifier__iexact=project_identifier, workspace__slug=slug)

        # Check if the user is a member of the project
        if not ProjectMember.objects.filter(
            workspace__slug=slug,
            project_id=project.id,
            member=request.user,
            is_active=True,
        ).exists():
            return Response(
                {"error": "You are not allowed to view this issue"},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Fetch the issue
        issue = (
            Issue.objects.filter(project_id=project.id)
            .filter(workspace__slug=slug)
            .select_related("workspace", "project", "state", "parent")
            .prefetch_related("assignees", "labels", "issue_module__module")
            .annotate(cycle_id=Subquery(CycleIssue.objects.filter(issue=OuterRef("id")).values("cycle_id")[:1]))
            .annotate(
                link_count=IssueLink.objects.filter(issue=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(
                attachment_count=FileAsset.objects.filter(
                    issue_id=OuterRef("id"),
                    entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
                )
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(
                sub_issues_count=Issue.issue_objects.filter(parent=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .filter(sequence_id=issue_identifier)
            .annotate(
                label_ids=Coalesce(
                    ArrayAgg(
                        "labels__id",
                        distinct=True,
                        filter=Q(~Q(labels__id__isnull=True) & Q(label_issue__deleted_at__isnull=True)),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                assignee_ids=Coalesce(
                    ArrayAgg(
                        "assignees__id",
                        distinct=True,
                        filter=Q(
                            ~Q(assignees__id__isnull=True)
                            & Q(assignees__member_project__is_active=True)
                            & Q(issue_assignee__deleted_at__isnull=True)
                        ),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                module_ids=Coalesce(
                    ArrayAgg(
                        "issue_module__module_id",
                        distinct=True,
                        filter=Q(
                            ~Q(issue_module__module_id__isnull=True)
                            & Q(issue_module__module__archived_at__isnull=True)
                            & Q(issue_module__deleted_at__isnull=True)
                        ),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
            )
            .prefetch_related(
                Prefetch(
                    "issue_reactions",
                    queryset=IssueReaction.objects.select_related("issue", "actor"),
                )
            )
            .prefetch_related(
                Prefetch(
                    "issue_link",
                    queryset=IssueLink.objects.select_related("created_by"),
                )
            )
            .annotate(
                is_subscribed=Exists(
                    IssueSubscriber.objects.filter(
                        workspace__slug=slug,
                        project_id=project.id,
                        issue__sequence_id=issue_identifier,
                        subscriber=request.user,
                    )
                )
            )
            .annotate(
                is_intake=Exists(
                    IntakeIssue.objects.filter(
                        issue=OuterRef("id"),
                        status__in=[-2, 0],
                        workspace__slug=slug,
                        project_id=project.id,
                    )
                )
            )
        ).first()

        # Check if the issue exists
        if not issue:
            return Response(
                {"error": "The required object does not exist."},
                status=status.HTTP_404_NOT_FOUND,
            )

        """
        if the role is guest and guest_view_all_features is false and owned by is not
        the requesting user then dont show the issue
        """

        if (
            ProjectMember.objects.filter(
                workspace__slug=slug,
                project_id=project.id,
                member=request.user,
                role=5,
                is_active=True,
            ).exists()
            and not project.guest_view_all_features
            and not issue.created_by == request.user
        ):
            return Response(
                {"error": "You are not allowed to view this issue"},
                status=status.HTTP_403_FORBIDDEN,
            )

        recent_visited_task.delay(
            slug=slug,
            entity_name="issue",
            entity_identifier=str(issue.id),
            user_id=str(request.user.id),
            project_id=str(project.id),
        )

        # Serialize the issue
        serializer = IssueDetailSerializer(issue, expand=self.expand)
        return Response(serializer.data, status=status.HTTP_200_OK)
