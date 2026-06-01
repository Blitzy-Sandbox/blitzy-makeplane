# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Cycle-to-issue membership HTTP endpoint for project cycles.

Defines :class:`CycleIssueViewSet`, the DRF ``ModelViewSet`` subclass
managing the :class:`plane.db.models.CycleIssue` junction model that
links :class:`plane.db.models.Issue` rows to a parent
:class:`plane.db.models.Cycle`. Mounted at:

* ``/api/workspaces/<slug>/projects/<project_id>/cycles/<cycle_id>/cycle-issues/``
* ``/api/workspaces/<slug>/projects/<project_id>/cycles/<cycle_id>/cycle-issues/<issue_id>/``

Invariant: an issue belongs to at most one cycle at a time. When a POST
``create`` references issues that already exist in a DIFFERENT cycle,
their CycleIssue row's ``cycle_id`` is bulk-updated (not duplicated) to
move them into the target cycle. Issues not yet in any cycle get a fresh
CycleIssue row.

Mutations queue ``issue_activity`` Celery tasks (RabbitMQ-backed) for
audit logging. The ``list`` handler is gzip-compressed and supports
filter-by-labels/assignees, ordering, group_by, and sub_group_by with
grouped pagination via
:class:`plane.utils.paginator.GroupedOffsetPaginator` /
:class:`plane.utils.paginator.SubGroupedOffsetPaginator`.
"""

# Python imports
import copy
import json

# Django imports
from django.core import serializers
from django.db.models import F, Func, OuterRef, Q, Subquery
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.gzip import gzip_page

# Third party imports
from rest_framework import status
from rest_framework.response import Response


# Module imports
from .. import BaseViewSet
from plane.app.serializers import CycleIssueSerializer
from plane.bgtasks.issue_activities_task import issue_activity
from plane.db.models import Cycle, CycleIssue, Issue, FileAsset, IssueLink
from plane.utils.grouper import (
    issue_group_values,
    issue_on_results,
    issue_queryset_grouper,
)
from plane.utils.issue_filters import issue_filters
from plane.utils.order_queryset import order_issue_queryset
from plane.utils.paginator import GroupedOffsetPaginator, SubGroupedOffsetPaginator
from plane.app.permissions import allow_permission, ROLE
from plane.utils.host import base_host
from plane.utils.filters import ComplexFilterBackend
from plane.utils.filters import IssueFilterSet


class CycleIssueViewSet(BaseViewSet):
    """Manage the many-to-many cycle-issue membership for a project cycle.

    Resource managed:
        :class:`plane.db.models.CycleIssue` -- the junction table that
        links issues to cycles. Each issue belongs to at most one cycle
        at a time (enforced by a unique constraint on
        ``(cycle, issue)`` where ``deleted_at IS NULL``).

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<project_id>/cycles/<uuid:cycle_id>/cycle-issues/
               -- list issues in the cycle, with grouping/sub-grouping
               and gzip compression.
        POST   /api/workspaces/<slug>/projects/<project_id>/cycles/<uuid:cycle_id>/cycle-issues/
               -- bulk add or move issues into the cycle.
        DELETE /api/workspaces/<slug>/projects/<project_id>/cycles/<uuid:cycle_id>/cycle-issues/<uuid:issue_id>/
               -- remove a single issue from the cycle.

        The URL conf also wires ``retrieve`` / ``update`` / ``partial_update``
        on the ``/cycle-issues/<issue_id>/`` path, but this class does not
        override those methods -- they fall through to the DRF
        ``ModelViewSet`` defaults inherited from
        :class:`plane.app.views.base.BaseViewSet`.

    Request body (POST):
        issues (list[UUID], required): the issues to add to the cycle.

        Issues that are already in a DIFFERENT cycle are MOVED via a
        bulk_update of ``CycleIssue.cycle_id`` (batch_size=100). Issues
        not yet in any cycle get a fresh ``CycleIssue`` row via
        bulk_create (batch_size=10).

    Response shape (GET list):
        Paginated payload from
        :class:`plane.utils.paginator.GroupedOffsetPaginator` (when
        ``group_by`` is present), or
        :class:`plane.utils.paginator.SubGroupedOffsetPaginator` (when
        both ``group_by`` and ``sub_group_by`` are present), or the
        default offset paginator otherwise. Each issue row carries
        annotations: ``cycle_id`` (the issue's current cycle),
        ``link_count``, ``attachment_count``, ``sub_issues_count``, and
        prefetched ``assignees`` / ``labels`` / ``issue_module__module`` /
        ``issue_cycle__cycle``.

        Query parameters:
            * ``order_by`` -- default ``-created_at``; forwarded to
              :func:`plane.utils.order_queryset.order_issue_queryset`.
            * ``group_by`` -- field to group rows by (e.g. ``state``,
              ``assignees``, ``labels``).
            * ``sub_group_by`` -- secondary grouping field. Must differ
              from ``group_by`` or HTTP 400 is returned.
            * standard issue filters from
              :func:`plane.utils.issue_filters.issue_filters` (legacy)
              and ``ComplexFilterBackend`` / ``IssueFilterSet`` (new).
              Filterset fields: ``issue__labels__id``,
              ``issue__assignees__id``.

    Response shape (POST):
        ``{"message": "success"}`` with HTTP 201.

    Response shape (DELETE):
        Empty body with HTTP 204.

    Permissions:
        permission_classes = [IsAuthenticated]
            (inherited from :class:`plane.app.views.base.BaseViewSet`)

        Per-method via the ``@allow_permission`` decorator:
            * ``list``    -- ROLE.ADMIN, ROLE.MEMBER
            * ``create``  -- ROLE.ADMIN, ROLE.MEMBER
            * ``destroy`` -- ROLE.ADMIN, ROLE.MEMBER

        GUEST role is intentionally excluded from cycle-issue membership
        operations because it can affect cycle progress metrics.

    Completed-cycle gate:
        ``create`` rejects with HTTP 400 if
        ``cycle.end_date < timezone.now()`` -- issues cannot be added to a
        cycle that has already ended. This preserves the integrity of the
        cycle's ``progress_snapshot`` (written by a Celery task on cycle
        completion).

    Side effects:
        All ``.delay()`` enqueues below go through Celery via RabbitMQ
        (Redis is caching / session only per the architectural context).

        * ``create`` emits ``issue_activity.delay(type="cycle.activity.created",
          ...)`` with both the bulk_created rows (Django-serialized) and
          the bulk_updated cycle moves recorded in ``current_instance``.
        * ``destroy`` emits ``issue_activity.delay(type="cycle.activity.deleted",
          ...)`` then performs a model ``.delete()`` (soft-delete via the
          ``CycleIssue`` model's overridden delete behavior).

    Queryset filter logic (``get_queryset``):
        Restricts to ``CycleIssue`` rows where the requesting user is an
        ACTIVE project member, the project is not archived, and
        ``cycle_id`` matches the URL kwarg. Annotates ``sub_issues_count``
        via a parent-issue Count subquery, ``select_related`` on
        project/workspace/cycle/issue/state, and ``prefetch_related`` on
        issue assignees/labels.

    Class attributes:
        * ``serializer_class = CycleIssueSerializer``
        * ``model = CycleIssue``
        * ``webhook_event = "cycle_issue"`` -- mutations trigger
          workspace webhook delivery (per tech spec §5.2.10) with this
          event name.
        * ``bulk = True`` -- declares this viewset accepts bulk POST
          payloads (handled in ``create``).
        * ``filter_backends = (ComplexFilterBackend,)`` -- overrides the
          ``BaseViewSet`` default ``(DjangoFilterBackend, SearchFilter)``.
        * ``filterset_class = IssueFilterSet``
        * ``filterset_fields = ["issue__labels__id", "issue__assignees__id"]``

    Cross-references:
        * Permission decorator: :func:`plane.app.permissions.allow_permission`
          (``apps/api/plane/app/permissions/base.py``)
        * Serializer: :class:`plane.app.serializers.CycleIssueSerializer`
          (``apps/api/plane/app/serializers/cycle.py``)
        * Models: :class:`plane.db.models.Cycle`,
          :class:`plane.db.models.CycleIssue`,
          :class:`plane.db.models.Issue`
          (``apps/api/plane/db/models/``)
        * Celery task: :func:`plane.bgtasks.issue_activities_task.issue_activity`
          (``apps/api/plane/bgtasks/issue_activities_task.py``)
        * Filter backend: :class:`plane.utils.filters.ComplexFilterBackend`
          (``apps/api/plane/utils/filters.py``)
        * URL: ``apps/api/plane/app/urls/cycle.py``
    """

    serializer_class = CycleIssueSerializer
    model = CycleIssue
    filter_backends = (ComplexFilterBackend,)
    filterset_class = IssueFilterSet

    webhook_event = "cycle_issue"
    bulk = True

    filterset_fields = ["issue__labels__id", "issue__assignees__id"]

    def get_queryset(self):
        """Return the CycleIssue queryset for the URL's cycle.

        Restricts to rows where the requesting user is an ACTIVE project
        member, the project is not archived, and ``cycle_id`` matches the
        URL kwarg. Annotates ``sub_issues_count`` via a parent-issue Count
        subquery.
        """
        return self.filter_queryset(
            super()
            .get_queryset()
            .annotate(
                sub_issues_count=Issue.issue_objects.filter(parent=OuterRef("issue_id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(project__archived_at__isnull=True)
            .filter(cycle_id=self.kwargs.get("cycle_id"))
            .select_related("project")
            .select_related("workspace")
            .select_related("cycle")
            .select_related("issue", "issue__state", "issue__project")
            .prefetch_related("issue__assignees", "issue__labels")
            .distinct()
        )

    def apply_annotations(self, issues):
        """Annotate the issue queryset with cycle membership and child counts.

        Adds ``cycle_id`` (from the issue's current active CycleIssue row),
        ``link_count``, ``attachment_count``, and ``sub_issues_count``
        annotations; prefetches ``assignees`` / ``labels`` /
        ``issue_module__module`` / ``issue_cycle__cycle``.
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
            .prefetch_related("assignees", "labels", "issue_module__module", "issue_cycle__cycle")
        )

    @method_decorator(gzip_page)
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def list(self, request, slug, project_id, cycle_id):
        """List issues in the cycle with gzip-compressed paginated output.

        Supports filtering (via ``ComplexFilterBackend`` + legacy
        ``issue_filters``), ordering, and optional ``group_by`` /
        ``sub_group_by`` for grouped pagination via
        :class:`plane.utils.paginator.GroupedOffsetPaginator` /
        :class:`plane.utils.paginator.SubGroupedOffsetPaginator`.
        """
        filters = issue_filters(request.query_params, "GET")
        issue_queryset = (
            Issue.issue_objects.filter(issue_cycle__cycle_id=cycle_id, issue_cycle__deleted_at__isnull=True)
            .filter(project_id=project_id)
            .filter(workspace__slug=slug)
        )

        # Apply filtering from filterset
        issue_queryset = self.filter_queryset(issue_queryset)

        # Apply legacy filters
        issue_queryset = issue_queryset.filter(**filters)

        # Total count queryset
        total_issue_queryset = copy.deepcopy(issue_queryset)

        # Applying annotations to the issue queryset
        issue_queryset = self.apply_annotations(issue_queryset)

        order_by_param = request.GET.get("order_by", "-created_at")
        # Issue queryset
        issue_queryset, order_by_param = order_issue_queryset(
            issue_queryset=issue_queryset, order_by_param=order_by_param
        )

        # Group by
        group_by = request.GET.get("group_by", False)
        sub_group_by = request.GET.get("sub_group_by", False)

        # issue queryset
        issue_queryset = issue_queryset_grouper(queryset=issue_queryset, group_by=group_by, sub_group_by=sub_group_by)

        if group_by:
            # Check group and sub group value paginate
            if sub_group_by:
                if group_by == sub_group_by:
                    return Response(
                        {"error": "Group by and sub group by cannot have same parameters"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                else:
                    # group and sub group pagination
                    return self.paginate(
                        request=request,
                        order_by=order_by_param,
                        queryset=issue_queryset,
                        total_count_queryset=total_issue_queryset,
                        on_results=lambda issues: issue_on_results(
                            group_by=group_by, issues=issues, sub_group_by=sub_group_by
                        ),
                        paginator_cls=SubGroupedOffsetPaginator,
                        group_by_fields=issue_group_values(
                            field=group_by,
                            slug=slug,
                            project_id=project_id,
                            filters=filters,
                        ),
                        sub_group_by_fields=issue_group_values(
                            field=sub_group_by,
                            slug=slug,
                            project_id=project_id,
                            filters=filters,
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
            # Group Paginate
            else:
                # Group paginate
                return self.paginate(
                    request=request,
                    order_by=order_by_param,
                    queryset=issue_queryset,
                    total_count_queryset=total_issue_queryset,
                    on_results=lambda issues: issue_on_results(
                        group_by=group_by, issues=issues, sub_group_by=sub_group_by
                    ),
                    paginator_cls=GroupedOffsetPaginator,
                    group_by_fields=issue_group_values(
                        field=group_by,
                        slug=slug,
                        project_id=project_id,
                        filters=filters,
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
            # List Paginate
            return self.paginate(
                order_by=order_by_param,
                request=request,
                queryset=issue_queryset,
                total_count_queryset=total_issue_queryset,
                on_results=lambda issues: issue_on_results(group_by=group_by, issues=issues, sub_group_by=sub_group_by),
            )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def create(self, request, slug, project_id, cycle_id):
        """Bulk-add the request's ``issues`` UUIDs to the cycle.

        Issues already in a DIFFERENT cycle are MOVED -- their CycleIssue
        row's ``cycle_id`` is bulk-updated rather than duplicated, to
        preserve the at-most-one-cycle-per-issue invariant. Issues not yet
        in any cycle get a fresh ``CycleIssue`` row. Returns HTTP 400 if
        the cycle has already ended (``cycle.end_date < now``).

        Side effects: enqueues ``issue_activity.delay(type="cycle.activity.created",
        ...)`` (Celery via RabbitMQ) with the bulk_created rows and
        bulk_updated cycle moves recorded in ``current_instance``.
        """
        issues = request.data.get("issues", [])

        if not issues:
            return Response({"error": "Issues are required"}, status=status.HTTP_400_BAD_REQUEST)

        cycle = Cycle.objects.get(workspace__slug=slug, project_id=project_id, pk=cycle_id)

        if cycle.end_date is not None and cycle.end_date < timezone.now():
            return Response(
                {"error": "The Cycle has already been completed so no new issues can be added"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get all CycleIssues already created
        cycle_issues = list(CycleIssue.objects.filter(~Q(cycle_id=cycle_id), issue_id__in=issues))
        existing_issues = [str(cycle_issue.issue_id) for cycle_issue in cycle_issues]
        new_issues = list(set(issues) - set(existing_issues))

        # New issues to create
        created_records = CycleIssue.objects.bulk_create(
            [
                CycleIssue(
                    project_id=project_id,
                    workspace_id=cycle.workspace_id,
                    created_by_id=request.user.id,
                    updated_by_id=request.user.id,
                    cycle_id=cycle_id,
                    issue_id=issue,
                )
                for issue in new_issues
            ],
            batch_size=10,
        )

        # Updated Issues
        updated_records = []
        update_cycle_issue_activity = []
        # Iterate over each cycle_issue in cycle_issues
        for cycle_issue in cycle_issues:
            old_cycle_id = cycle_issue.cycle_id
            # Update the cycle_issue's cycle_id
            cycle_issue.cycle_id = cycle_id
            # Add the modified cycle_issue to the records_to_update list
            updated_records.append(cycle_issue)
            # Record the update activity
            update_cycle_issue_activity.append(
                {
                    "old_cycle_id": str(old_cycle_id),
                    "new_cycle_id": str(cycle_id),
                    "issue_id": str(cycle_issue.issue_id),
                }
            )

        # Update the cycle issues
        CycleIssue.objects.bulk_update(updated_records, ["cycle_id"], batch_size=100)
        # Capture Issue Activity
        issue_activity.delay(
            type="cycle.activity.created",
            requested_data=json.dumps({"cycles_list": issues}),
            actor_id=str(self.request.user.id),
            issue_id=None,
            project_id=str(self.kwargs.get("project_id", None)),
            current_instance=json.dumps(
                {
                    "updated_cycle_issues": update_cycle_issue_activity,
                    "created_cycle_issues": serializers.serialize("json", created_records),
                }
            ),
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )
        return Response({"message": "success"}, status=status.HTTP_201_CREATED)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def destroy(self, request, slug, project_id, cycle_id, issue_id):
        """Remove a single issue from the cycle.

        Emits a ``cycle.activity.deleted`` audit event via the
        ``issue_activity`` Celery task (RabbitMQ-backed), then soft-deletes
        the matching ``CycleIssue`` row.
        """
        cycle_issue = CycleIssue.objects.filter(
            issue_id=issue_id,
            workspace__slug=slug,
            project_id=project_id,
            cycle_id=cycle_id,
        )
        issue_activity.delay(
            type="cycle.activity.deleted",
            requested_data=json.dumps(
                {
                    "cycle_id": str(self.kwargs.get("cycle_id")),
                    "issues": [str(issue_id)],
                }
            ),
            actor_id=str(self.request.user.id),
            issue_id=str(issue_id),
            project_id=str(self.kwargs.get("project_id", None)),
            current_instance=None,
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )
        cycle_issue.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
