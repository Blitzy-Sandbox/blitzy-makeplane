# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Issue archive and bulk-archive HTTP endpoints.

Exposes :class:`IssueArchiveViewSet` for listing/retrieving archived
issues and toggling individual archive state, and
:class:`BulkArchiveIssuesEndpoint` for archiving many issues in one
request. Archiving is implemented by setting ``Issue.archived_at`` to
today's date; unarchiving sets it back to ``None``. Both flows enqueue
``plane.bgtasks.issue_activities_task.issue_activity`` (Celery via
RabbitMQ) to record the change in the issue timeline. The business
rule -- only issues whose state ``group`` is ``"completed"`` or
``"cancelled"`` may be archived -- is enforced inline.
"""

# Python imports
import copy
import json

# Django imports
from django.core.serializers.json import DjangoJSONEncoder
from django.db.models import OuterRef, Q, Prefetch, Exists, Subquery, Count
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.gzip import gzip_page

# Third Party imports
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ProjectEntityPermission
from plane.app.serializers import (
    IssueFlatSerializer,
    IssueSerializer,
    IssueDetailSerializer,
)
from plane.bgtasks.issue_activities_task import issue_activity
from plane.db.models import (
    Issue,
    FileAsset,
    IssueLink,
    IssueSubscriber,
    IssueReaction,
    CycleIssue,
)
from plane.utils.grouper import (
    issue_group_values,
    issue_on_results,
    issue_queryset_grouper,
)
from plane.utils.issue_filters import issue_filters
from plane.utils.order_queryset import order_issue_queryset
from plane.utils.paginator import GroupedOffsetPaginator, SubGroupedOffsetPaginator
from plane.app.permissions import allow_permission, ROLE
from plane.utils.error_codes import ERROR_CODES
from plane.utils.host import base_host

# Module imports
from .. import BaseViewSet, BaseAPIView
from plane.utils.filters import ComplexFilterBackend
from plane.utils.filters import IssueFilterSet


class IssueArchiveViewSet(BaseViewSet):
    """Read + archive-toggle endpoints for issues that have been archived (``archived_at IS NOT NULL``).

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<project_id>/archived-issues/
                (action: ``list``)
        GET    /api/workspaces/<slug>/projects/<project_id>/issues/<pk>/archive/
                (action: ``retrieve``)
        POST   /api/workspaces/<slug>/projects/<project_id>/issues/<pk>/archive/
                (action: ``archive``)
        DELETE /api/workspaces/<slug>/projects/<project_id>/issues/<pk>/archive/
                (action: ``unarchive``)

    Query parameters (list):
        group_by (str, optional): groups results by the given issue field.
        sub_group_by (str, optional): adds a second-level grouping; MUST
            differ from ``group_by`` (else 400).
        order_by (str, optional, default=``-created_at``): order field
            forwarded to :func:`plane.utils.order_queryset.order_issue_queryset`.
        show_sub_issues (str ``"true"|"false"``, default ``"true"``): when
            ``"false"`` excludes rows whose ``parent`` is set.
        plus any filter accepted by
        :class:`plane.utils.filters.IssueFilterSet` and the legacy
        :func:`plane.utils.issue_filters.issue_filters` shape.

    Request body:
        - ``list`` / ``retrieve``: none.
        - ``archive`` (POST): none -- pk in URL identifies the issue.
        - ``unarchive`` (DELETE): none.

    Response shape:
        - ``list``: paginated grouped or flat list keyed by the chosen
          grouper; see
          :class:`plane.utils.paginator.GroupedOffsetPaginator` /
          :class:`SubGroupedOffsetPaginator`.
        - ``retrieve``: :class:`plane.app.serializers.IssueDetailSerializer`
          (with prefetched ``issue_reactions`` and ``issue_link`` and the
          ``is_subscribed`` Exists annotation).
        - ``archive``: ``{"archived_at": "<YYYY-MM-DD>"}``.
        - ``unarchive``: HTTP 204 empty body.

    Permissions:
        permission_classes -- not set on the class; inherits
        ``[IsAuthenticated]`` from :class:`BaseViewSet`. Every method is
        gated by ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER])`` so
        guests cannot reach archive endpoints. Use of
        :class:`plane.utils.filters.IssueFilterSet` and the
        ``project_id`` / ``workspace__slug`` filters on ``get_queryset``
        further scopes results to the requesting member's project.

    get_queryset filter logic:
        ``Issue.objects.filter(Q(type__isnull=True) | Q(type__is_epic=False))``
        -- excludes ``Issue.type`` rows that represent epics (epics are
        listed via a separate workspace-level endpoint),
        ``archived_at__isnull=False`` (archived only),
        ``project_id=<URL kwarg>``,
        ``workspace__slug=<URL kwarg>``.

    Business rule (``archive``):
        Only issues whose ``state.group`` is ``"completed"`` or
        ``"cancelled"`` may be archived; archiving any other state group
        returns HTTP 400 with ``{"error": "Can only archive completed or
        cancelled state group issue"}``.

    Side effects on archive/unarchive:
        ``plane.bgtasks.issue_activities_task.issue_activity`` is enqueued
        via Celery (RabbitMQ) with ``type="issue.activity.updated"`` and a
        payload containing the new ``archived_at`` value -- the worker
        appends a row to :class:`IssueActivity` for the issue timeline.
    """

    serializer_class = IssueFlatSerializer
    model = Issue

    filter_backends = (ComplexFilterBackend,)
    filterset_class = IssueFilterSet

    def apply_annotations(self, issues):
        """Annotate an Issue queryset with ``cycle_id``, ``link_count``, ``attachment_count``, and ``sub_issues_count``.

        Also prefetches the ``assignees``, ``labels``, and
        ``issue_module__module`` relations used by downstream serializers
        and group-by operations.
        """
        return (
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
            .prefetch_related("assignees", "labels", "issue_module__module")
        )

    def get_queryset(self):
        """Return archived issues (``archived_at IS NOT NULL``) for the URL's workspace + project, excluding epics."""
        return (
            Issue.objects.filter(Q(type__isnull=True) | Q(type__is_epic=False))
            .filter(archived_at__isnull=False)
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(workspace__slug=self.kwargs.get("slug"))
        )

    @method_decorator(gzip_page)
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def list(self, request, slug, project_id):
        """Return paginated archived issues, optionally grouped by ``group_by`` and ``sub_group_by`` query params.

        Combines legacy :func:`issue_filters` with the modern
        :class:`IssueFilterSet`, applies :func:`apply_annotations`, sorts
        via :func:`order_issue_queryset`, and routes through
        :class:`GroupedOffsetPaginator` or
        :class:`SubGroupedOffsetPaginator` depending on the grouping
        request.
        """
        filters = issue_filters(request.query_params, "GET")
        show_sub_issues = request.GET.get("show_sub_issues", "true")

        order_by_param = request.GET.get("order_by", "-created_at")

        issue_queryset = self.get_queryset()

        issue_queryset = issue_queryset if show_sub_issues == "true" else issue_queryset.filter(parent__isnull=True)
        # Apply filtering from filterset
        issue_queryset = self.filter_queryset(issue_queryset)

        # Apply legacy filters
        issue_queryset = issue_queryset.filter(**filters)

        # Total count queryset
        total_issue_queryset = copy.deepcopy(issue_queryset)

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
    def retrieve(self, request, slug, project_id, pk=None):
        """Return a single archived issue with reactions + links prefetched.

        ``is_subscribed`` is annotated via an :class:`Exists` subquery on
        :class:`IssueSubscriber` for the requesting user. Returns
        HTTP 404 if the issue does not exist or is not archived.
        """
        issue = (
            self.get_queryset()
            .filter(pk=pk)
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
        serializer = IssueDetailSerializer(issue, expand=self.expand)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def archive(self, request, slug, project_id, pk=None):
        """Set ``archived_at = today`` on the issue and enqueue an ``issue.activity.updated`` Celery task.

        Returns HTTP 400 if the issue's ``state.group`` is not
        ``"completed"`` or ``"cancelled"``.
        """
        issue = Issue.issue_objects.get(workspace__slug=slug, project_id=project_id, pk=pk)
        if issue.state.group not in ["completed", "cancelled"]:
            return Response(
                {"error": "Can only archive completed or cancelled state group issue"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        issue_activity.delay(
            type="issue.activity.updated",
            requested_data=json.dumps({"archived_at": str(timezone.now().date()), "automation": False}),
            actor_id=str(request.user.id),
            issue_id=str(issue.id),
            project_id=str(project_id),
            current_instance=json.dumps(IssueSerializer(issue).data, cls=DjangoJSONEncoder),
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )
        issue.archived_at = timezone.now().date()
        issue.save()

        return Response({"archived_at": str(issue.archived_at)}, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def unarchive(self, request, slug, project_id, pk=None):
        """Set ``archived_at = None`` on the issue (restoring it from archive).

        Enqueues an ``issue.activity.updated`` Celery task (RabbitMQ) so
        the unarchive event is recorded in the issue timeline.
        """
        issue = Issue.objects.get(
            workspace__slug=slug,
            project_id=project_id,
            archived_at__isnull=False,
            pk=pk,
        )
        issue_activity.delay(
            type="issue.activity.updated",
            requested_data=json.dumps({"archived_at": None}),
            actor_id=str(request.user.id),
            issue_id=str(issue.id),
            project_id=str(project_id),
            current_instance=json.dumps(IssueSerializer(issue).data, cls=DjangoJSONEncoder),
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )
        issue.archived_at = None
        issue.save()

        return Response(status=status.HTTP_204_NO_CONTENT)


class BulkArchiveIssuesEndpoint(BaseAPIView):
    """Bulk-archive endpoint: archives many issues in one request.

    HTTP methods + URL patterns:
        POST /api/workspaces/<slug>/projects/<project_id>/bulk-archive-issues/

    Request body:
        issue_ids (list[UUID], required): the issues to archive in this batch.

    Response shape:
        Success: ``{"archived_at": "<YYYY-MM-DD>"}``.
        Empty list: HTTP 400 ``{"error": "Issue IDs are required"}``.
        Wrong state group on any row: HTTP 400 with
        ``{"error_code": ERROR_CODES["INVALID_ARCHIVE_STATE_GROUP"],
        "error_message": "INVALID_ARCHIVE_STATE_GROUP"}`` -- the whole
        batch is rejected (atomic-style validation).

    Permissions:
        permission_classes = [ProjectEntityPermission]
        Per-method gate: ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER])``

    Business rule:
        Same as :meth:`IssueArchiveViewSet.archive` -- only issues whose
        ``state.group`` is ``"completed"`` or ``"cancelled"`` may be
        archived. Validated up-front; if ANY supplied issue fails the
        check the entire request is rejected.

    Side effects:
        Issues are mutated via ``Issue.objects.bulk_update(...,
        ["archived_at"])``; for each affected issue one
        ``plane.bgtasks.issue_activities_task.issue_activity`` Celery task
        is enqueued (RabbitMQ) with ``type="issue.activity.updated"``.
    """

    permission_classes = [ProjectEntityPermission]

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id):
        """Validate ``issue_ids`` are in a ``completed``/``cancelled`` state group, then bulk-archive them.

        Bulk-updates ``archived_at`` on every supplied issue and
        enqueues one ``issue.activity.updated`` Celery task per issue
        (RabbitMQ) so each archive event is recorded in the issue
        timeline.
        """
        issue_ids = request.data.get("issue_ids", [])

        if not len(issue_ids):
            return Response({"error": "Issue IDs are required"}, status=status.HTTP_400_BAD_REQUEST)

        issues = Issue.objects.filter(workspace__slug=slug, project_id=project_id, pk__in=issue_ids).select_related(
            "state"
        )
        bulk_archive_issues = []
        for issue in issues:
            if issue.state.group not in ["completed", "cancelled"]:
                return Response(
                    {
                        "error_code": ERROR_CODES["INVALID_ARCHIVE_STATE_GROUP"],
                        "error_message": "INVALID_ARCHIVE_STATE_GROUP",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            issue_activity.delay(
                type="issue.activity.updated",
                requested_data=json.dumps({"archived_at": str(timezone.now().date()), "automation": False}),
                actor_id=str(request.user.id),
                issue_id=str(issue.id),
                project_id=str(project_id),
                current_instance=json.dumps(IssueSerializer(issue).data, cls=DjangoJSONEncoder),
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )
            issue.archived_at = timezone.now().date()
            bulk_archive_issues.append(issue)
        Issue.objects.bulk_update(bulk_archive_issues, ["archived_at"])

        return Response({"archived_at": str(timezone.now().date())}, status=status.HTTP_200_OK)
