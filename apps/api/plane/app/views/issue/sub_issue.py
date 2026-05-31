# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Sub-issue (parent-child tree) HTTP endpoints.

Exposes :class:`SubIssuesEndpoint` for browsing and editing the
parent-child tree of issues. The relationship is modeled by the
``Issue.parent_id`` self-FK; this endpoint surfaces the immediate
children of a given issue along with a ``state_distribution`` summary
that groups child IDs by state group.

GET supports flexible ``order_by`` and ``group_by`` query parameters;
POST reparents one or more existing issues under the given parent in a
single bulk_update operation and enqueues one
``plane.bgtasks.issue_activities_task.issue_activity`` Celery task
(RabbitMQ) per re-parented issue.

Response bodies use gzip compression on GET
(``@method_decorator(gzip_page)``) because annotated sub-issue lists
can be large.
"""

# Python imports
import json

# Django imports
from django.utils import timezone
from django.db.models import OuterRef, F, Value, UUIDField, Subquery, Count, IntegerField
from django.utils.decorators import method_decorator
from django.views.decorators.gzip import gzip_page
from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField
from django.db.models.functions import Coalesce

# Third Party imports
from rest_framework.response import Response
from rest_framework import status

# Module imports
from .. import BaseAPIView
from plane.app.serializers import IssueSerializer
from plane.app.permissions import ProjectEntityPermission
from plane.db.models import Issue, IssueLink, FileAsset, CycleIssue, IssueLabel, IssueAssignee, ModuleIssue
from plane.bgtasks.issue_activities_task import issue_activity
from plane.utils.timezone_converter import user_timezone_converter
from collections import defaultdict
from plane.utils.host import base_host
from plane.utils.order_queryset import order_issue_queryset


class SubIssuesEndpoint(BaseAPIView):
    """List + bulk-reparent endpoint for sub-issues (the ``Issue.parent`` tree).

    HTTP methods + URL patterns:
        GET  /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/sub-issues/
              -- list immediate children of <issue_id>.
        POST /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/sub-issues/
              -- reparent ``sub_issue_ids`` under <issue_id>.

    Query parameters (GET):
        order_by (str, optional, default ``-created_at``): forwarded to
            :func:`plane.utils.order_queryset.order_issue_queryset`.
        group_by (str, optional): groups the response by the named
            field. Special-cased value ``assignees__ids`` explodes the
            multi-valued ``assignee_ids`` array into one bucket per
            assignee; empty arrays are bucketed under the literal
            ``"None"`` key.

    Request body (POST):
        sub_issue_ids (list[UUID], required): the issues to reparent.
        Returns HTTP 400 ``"Sub Issue IDs are required"`` on empty
        list.

    Response shape:
        ``{"sub_issues": <list-or-dict>, "state_distribution":
        {<state_group>: [<issue_id>, ...], ...}}``. On GET ``sub_issues``
        is either a flat list (default) or a dict keyed by ``group_by``
        when grouping is requested. On POST it is the
        :class:`IssueSerializer` output of the re-parented rows.

    Annotations (GET):
        ``cycle_id`` (current cycle assignment),
        ``link_count``, ``attachment_count``, ``sub_issues_count``,
        ``label_ids`` (array), ``assignee_ids`` (array filtered to
        active project members), ``module_ids`` (array filtered to
        non-archived modules), ``state_group``. Datetime fields
        (``created_at``, ``updated_at``) are converted to the requesting
        user's ``user_timezone`` via
        :func:`plane.utils.timezone_converter.user_timezone_converter`.

    Permissions:
        permission_classes = [ProjectEntityPermission]

    Side effects (POST):
        ``Issue.objects.bulk_update(..., ["parent"], batch_size=10)`` --
        note ``Issue.objects`` is used here (the default manager, NOT
        ``issue_objects``) so the update reaches even archived rows.
        For each reparented issue an ``issue.activity.updated`` Celery
        task is enqueued (RabbitMQ) recording the parent change.

    Compression:
        ``get`` is decorated with ``@method_decorator(gzip_page)`` --
        sub-issue listings can be large, so the response is gzipped.
    """

    permission_classes = [ProjectEntityPermission]

    @method_decorator(gzip_page)
    def get(self, request, slug, project_id, issue_id):
        """List immediate sub-issues of ``issue_id`` with annotations and an optional ``group_by`` bucketing.

        Returns ``{"sub_issues": <list or grouped dict>,
        "state_distribution": {<state_group>: [<id>, ...]}}``. The
        ``assignees__ids`` group_by mode explodes the multi-valued
        ``assignee_ids`` array into one bucket per assignee, with the
        empty-list case bucketed under the literal ``"None"`` key.
        """
        sub_issues = (
            Issue.issue_objects.filter(parent_id=issue_id, workspace__slug=slug)
            .annotate(
                cycle_id=Subquery(
                    CycleIssue.objects.filter(issue=OuterRef("id"), deleted_at__isnull=True).values("cycle_id")[:1]
                )
            )
            .annotate(
                link_count=Coalesce(
                    Subquery(
                        IssueLink.objects.filter(issue=OuterRef("id"))
                        .order_by()
                        .values("issue")
                        .annotate(count=Count("id"))
                        .values("count"),
                        output_field=IntegerField(),
                    ),
                    0,
                )
            )
            .annotate(
                attachment_count=Coalesce(
                    Subquery(
                        FileAsset.objects.filter(
                            issue_id=OuterRef("id"),
                            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
                        )
                        .order_by()
                        .values("issue_id")
                        .annotate(count=Count("id"))
                        .values("count"),
                        output_field=IntegerField(),
                    ),
                    0,
                )
            )
            .annotate(
                sub_issues_count=Coalesce(
                    Subquery(
                        Issue.issue_objects.filter(parent=OuterRef("id"))
                        .order_by()
                        .values("parent")
                        .annotate(count=Count("id"))
                        .values("count"),
                        output_field=IntegerField(),
                    ),
                    0,
                )
            )
            .annotate(
                label_ids=Coalesce(
                    Subquery(
                        IssueLabel.objects.filter(issue_id=OuterRef("id"), deleted_at__isnull=True)
                        .order_by()
                        .values("issue_id")
                        .annotate(arr=ArrayAgg("label_id", distinct=True))
                        .values("arr"),
                        output_field=ArrayField(UUIDField()),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                assignee_ids=Coalesce(
                    Subquery(
                        IssueAssignee.objects.filter(
                            issue_id=OuterRef("id"),
                            assignee__member_project__is_active=True,
                            deleted_at__isnull=True,
                        )
                        .order_by()
                        .values("issue_id")
                        .annotate(arr=ArrayAgg("assignee_id", distinct=True))
                        .values("arr"),
                        output_field=ArrayField(UUIDField()),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                module_ids=Coalesce(
                    Subquery(
                        ModuleIssue.objects.filter(
                            issue_id=OuterRef("id"),
                            module__archived_at__isnull=True,
                            deleted_at__isnull=True,
                        )
                        .order_by()
                        .values("issue_id")
                        .annotate(arr=ArrayAgg("module_id", distinct=True))
                        .values("arr"),
                        output_field=ArrayField(UUIDField()),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
            )
            .annotate(state_group=F("state__group"))
        )

        # Ordering
        order_by_param = request.GET.get("order_by", "-created_at")
        group_by = request.GET.get("group_by", False)

        if order_by_param:
            sub_issues, order_by_param = order_issue_queryset(sub_issues, order_by_param)

        sub_issues = list(
            sub_issues.values(
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
                "state_group",
            )
        )

        # create's a dict with state group name with their respective issue id's
        result = defaultdict(list)
        for sub_issue in sub_issues:
            result[sub_issue["state_group"]].append(str(sub_issue["id"]))

        datetime_fields = ["created_at", "updated_at"]
        sub_issues = user_timezone_converter(sub_issues, datetime_fields, request.user.user_timezone)
        # Grouping
        if group_by:
            result_dict = defaultdict(list)

            for issue in sub_issues:
                if group_by == "assignees__ids":
                    if issue["assignee_ids"]:
                        assignee_ids = issue["assignee_ids"]
                        for assignee_id in assignee_ids:
                            result_dict[str(assignee_id)].append(issue)
                    elif issue["assignee_ids"] == []:
                        result_dict["None"].append(issue)

                elif group_by:
                    result_dict[str(issue[group_by])].append(issue)

            return Response(
                {"sub_issues": result_dict, "state_distribution": result},
                status=status.HTTP_200_OK,
            )
        return Response(
            {"sub_issues": sub_issues, "state_distribution": result},
            status=status.HTTP_200_OK,
        )

    # Assign multiple sub issues
    def post(self, request, slug, project_id, issue_id):
        """Reparent the supplied ``sub_issue_ids`` under ``issue_id``.

        Issues a single ``Issue.objects.bulk_update`` and enqueues one
        ``issue.activity.updated`` Celery task per child. Returns HTTP
        400 ``"Sub Issue IDs are required"`` if ``sub_issue_ids`` is
        empty.
        """
        parent_issue = Issue.issue_objects.get(pk=issue_id)
        sub_issue_ids = request.data.get("sub_issue_ids", [])

        if not len(sub_issue_ids):
            return Response(
                {"error": "Sub Issue IDs are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        sub_issues = Issue.issue_objects.filter(id__in=sub_issue_ids)

        for sub_issue in sub_issues:
            sub_issue.parent = parent_issue

        _ = Issue.objects.bulk_update(sub_issues, ["parent"], batch_size=10)

        updated_sub_issues = Issue.issue_objects.filter(id__in=sub_issue_ids).annotate(state_group=F("state__group"))

        # Track the issue
        _ = [
            issue_activity.delay(
                type="issue.activity.updated",
                requested_data=json.dumps({"parent": str(issue_id)}),
                actor_id=str(request.user.id),
                issue_id=str(sub_issue_id),
                project_id=str(project_id),
                current_instance=json.dumps({"parent": str(sub_issue_id)}),
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )
            for sub_issue_id in sub_issue_ids
        ]

        # create's a dict with state group name with their respective issue id's
        result = defaultdict(list)
        for sub_issue in updated_sub_issues:
            result[sub_issue.state_group].append(str(sub_issue.id))

        serializer = IssueSerializer(updated_sub_issues, many=True)
        return Response(
            {"sub_issues": serializer.data, "state_distribution": result},
            status=status.HTTP_200_OK,
        )
