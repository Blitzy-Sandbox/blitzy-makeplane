# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace-scoped user profile, activity, and dashboard endpoints.

Seven endpoint classes power the workspace-level user views in the
frontend: the last-visited workspace selector, the per-user profile
page, the user's issue list with grouping/sub-grouping, per-user
profile statistics (state/priority distributions, cycle position), the
two graph endpoints (activity heatmap, completed issues by week-in-
month), the user properties (filter prefs) endpoint, and the activity
feed pagination.
"""

# Python imports
import copy
from datetime import date

from dateutil.relativedelta import relativedelta

# Django imports
from django.db.models import (
    Case,
    Count,
    F,
    Func,
    IntegerField,
    OuterRef,
    Q,
    Value,
    When,
    Subquery,
)
from django.db.models.fields import DateField
from django.db.models.functions import Cast, ExtractWeek
from django.utils import timezone

# Third party modules
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import WorkspaceEntityPermission, WorkspaceViewerPermission

# Module imports
from plane.app.serializers import (
    IssueActivitySerializer,
    ProjectMemberSerializer,
    WorkSpaceSerializer,
    WorkspaceUserPropertiesSerializer,
)
from plane.app.views.base import BaseAPIView
from plane.db.models import (
    CycleIssue,
    Issue,
    IssueActivity,
    FileAsset,
    IssueLink,
    IssueSubscriber,
    Project,
    ProjectMember,
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceUserProperties,
)
from plane.utils.grouper import (
    issue_group_values,
    issue_on_results,
    issue_queryset_grouper,
)
from plane.utils.issue_filters import issue_filters
from plane.utils.order_queryset import order_issue_queryset
from plane.utils.paginator import GroupedOffsetPaginator, SubGroupedOffsetPaginator
from plane.utils.filters import ComplexFilterBackend
from plane.utils.filters import IssueFilterSet


class UserLastProjectWithWorkspaceEndpoint(BaseAPIView):
    """Return the caller's last-visited workspace and its project memberships.

    HTTP methods + URL pattern:
        GET /api/users/last-visited-workspace/

    Response shape:
        {
            "workspace_details": WorkSpaceSerializer | {},
            "project_details": List[ProjectMemberSerializer]
        }

    If ``user.last_workspace_id`` is ``None`` (first login), both fields
    return as empty.

    Request body:
        None (GET only).

    Permissions:
        Inherits default ``BaseAPIView`` permissions (authenticated user).

    Cross-references:
        - Serializers: ``apps/api/plane/app/serializers/workspace.py``
          (``WorkSpaceSerializer``),
          ``apps/api/plane/app/serializers/project.py``
          (``ProjectMemberSerializer``).
        - Models: ``apps/api/plane/db/models/user.py`` (``User``),
          ``apps/api/plane/db/models/workspace.py`` (``Workspace``),
          ``apps/api/plane/db/models/project.py`` (``ProjectMember``).
        - URL registration: ``apps/api/plane/app/urls/user.py``.
    """

    def get(self, request):
        """Return the caller's last-visited workspace + project memberships."""
        user = User.objects.get(pk=request.user.id)

        last_workspace_id = user.last_workspace_id

        if last_workspace_id is None:
            return Response(
                {"project_details": [], "workspace_details": {}},
                status=status.HTTP_200_OK,
            )

        workspace = Workspace.objects.get(pk=last_workspace_id)
        workspace_serializer = WorkSpaceSerializer(workspace)

        project_member = ProjectMember.objects.filter(
            workspace_id=last_workspace_id, member=request.user
        ).select_related("workspace", "project", "member", "workspace__owner")

        project_member_serializer = ProjectMemberSerializer(project_member, many=True)

        return Response(
            {
                "workspace_details": workspace_serializer.data,
                "project_details": project_member_serializer.data,
            },
            status=status.HTTP_200_OK,
        )


class WorkspaceUserProfileIssuesEndpoint(BaseAPIView):
    """Paginated, optionally grouped issue listing for a target user.

    HTTP methods + URL pattern:
        GET /api/workspaces/<str:slug>/user-issues/<uuid:user_id>/

    Query parameters:
        order_by (str, optional, default ``"-created_at"``).
        group_by, sub_group_by (str, optional): when both are supplied the
            response uses ``SubGroupedOffsetPaginator``; when only
            ``group_by`` is supplied ``GroupedOffsetPaginator`` is used.
            Identical group/sub-group fields are rejected with HTTP 400.
        Plus all keys handled by ``issue_filters`` (date ranges, state
        groups, etc.) and any field on ``IssueFilterSet`` for the
        ``ComplexFilterBackend``.

    Response shape:
        Paginated issue list. Group / sub-group payloads follow the
        paginator's structure (``group_by_field_name``,
        ``sub_group_by_field_name``). Each issue row carries
        ``cycle_id``, ``link_count``, ``attachment_count``, and
        ``sub_issues_count`` from the annotations in ``apply_annotations``.

    Request body:
        None (GET only). Behavior is parameterized via query parameters
        documented above.

    Permissions:
        permission_classes = [WorkspaceViewerPermission] — any active
        workspace member -- declared on the class attribute (see
        ``apps/api/plane/app/views/workspace/user.py``).

    Queryset:
        Restricted to issues where the target user is an assignee,
        creator, or subscriber AND the caller is an active project
        member. Filtering goes through ``ComplexFilterBackend`` (with
        ``IssueFilterSet``) and then ``issue_filters`` for legacy keys.

    count_filter:
        Excludes archived and draft issues and the intake-rejected/-
        duplicate/-not-spam intake states from the group counts.

    Cross-references:
        - Permission: ``apps/api/plane/app/permissions/workspace.py``
          (``WorkspaceViewerPermission``).
        - Models: ``apps/api/plane/db/models/issue.py`` (``Issue``,
          ``IssueLink``), ``apps/api/plane/db/models/asset.py``
          (``FileAsset``).
        - Filter helpers: ``apps/api/plane/utils/issue_filters.py``,
          ``apps/api/plane/utils/filters.py`` (``ComplexFilterBackend``,
          ``IssueFilterSet``), ``apps/api/plane/utils/grouper.py``,
          ``apps/api/plane/utils/order_queryset.py``,
          ``apps/api/plane/utils/paginator.py``.
        - URL registration: ``apps/api/plane/app/urls/workspace.py``.
    """

    permission_classes = [WorkspaceViewerPermission]

    filter_backends = (ComplexFilterBackend,)
    filterset_class = IssueFilterSet

    def apply_annotations(self, issues):
        """Annotate each issue with link/attachment/sub-issue counts and cycle.

        Adds ``cycle_id`` (latest non-deleted ``CycleIssue``), ``link_count``,
        ``attachment_count`` (file assets with ``entity_type =
        ISSUE_ATTACHMENT``), and ``sub_issues_count``; also prefetches
        ``assignees``, ``labels``, and ``issue_module__module``.
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
            .prefetch_related("assignees", "labels", "issue_module__module")
        )

    def get(self, request, slug, user_id):
        """Return the target user's issues, paginated and optionally grouped.

        When both ``group_by`` and ``sub_group_by`` are supplied the response
        uses ``SubGroupedOffsetPaginator``; with only ``group_by`` it uses
        ``GroupedOffsetPaginator``; otherwise the default offset paginator.
        Identical ``group_by`` and ``sub_group_by`` parameters return HTTP
        400.
        """
        filters = issue_filters(request.query_params, "GET")

        order_by_param = request.GET.get("order_by", "-created_at")
        issue_queryset = Issue.issue_objects.filter(
            id__in=Issue.issue_objects.filter(
                Q(assignees__in=[user_id]) | Q(created_by_id=user_id) | Q(issue_subscribers__subscriber_id=user_id),
                workspace__slug=slug,
            ).values_list("id", flat=True),
            workspace__slug=slug,
            project__project_projectmember__member=request.user,
            project__project_projectmember__is_active=True,
        )

        # Apply filtering from filterset
        issue_queryset = self.filter_queryset(issue_queryset)

        # Apply legacy filters
        issue_queryset = issue_queryset.filter(**filters)

        # Total count queryset
        total_issue_queryset = copy.deepcopy(issue_queryset)

        # Apply annotations to the issue queryset
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
                        total_count_queryset=total_issue_queryset,
                        on_results=lambda issues: issue_on_results(
                            group_by=group_by, issues=issues, sub_group_by=sub_group_by
                        ),
                        paginator_cls=SubGroupedOffsetPaginator,
                        group_by_fields=issue_group_values(
                            field=group_by,
                            slug=slug,
                            filters=filters,
                            queryset=total_issue_queryset,
                        ),
                        sub_group_by_fields=issue_group_values(
                            field=sub_group_by,
                            slug=slug,
                            filters=filters,
                            queryset=total_issue_queryset,
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
                    total_count_queryset=total_issue_queryset,
                    on_results=lambda issues: issue_on_results(
                        group_by=group_by, issues=issues, sub_group_by=sub_group_by
                    ),
                    paginator_cls=GroupedOffsetPaginator,
                    group_by_fields=issue_group_values(
                        field=group_by,
                        slug=slug,
                        filters=filters,
                        queryset=total_issue_queryset,
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
                total_count_queryset=total_issue_queryset,
                on_results=lambda issues: issue_on_results(group_by=group_by, issues=issues, sub_group_by=sub_group_by),
            )


class WorkspaceUserPropertiesEndpoint(BaseAPIView):
    """Read / write the caller's per-workspace filter/properties blob.

    HTTP methods + URL pattern:
        GET   /api/workspaces/<str:slug>/user-properties/
        PATCH /api/workspaces/<str:slug>/user-properties/

    Request body (PATCH):
        ``WorkspaceUserPropertiesSerializer`` fields (filter presets,
        display preferences).

    Response shape:
        ``WorkspaceUserPropertiesSerializer``. ``get_or_create`` ensures
        a row exists on first access.

    Permissions:
        permission_classes = [WorkspaceViewerPermission] — any active
        workspace member -- declared on the class attribute (see
        ``apps/api/plane/app/views/workspace/user.py``).

    Cross-references:
        - Permission: ``apps/api/plane/app/permissions/workspace.py``
          (``WorkspaceViewerPermission``).
        - Serializer: ``apps/api/plane/app/serializers/workspace.py``
          (``WorkspaceUserPropertiesSerializer``).
        - Model: ``apps/api/plane/db/models/workspace.py``
          (``WorkspaceUserProperties``).
        - URL registration: ``apps/api/plane/app/urls/workspace.py``.
    """

    permission_classes = [WorkspaceViewerPermission]

    def patch(self, request, slug):
        """Apply a partial update to the caller's workspace user properties row."""
        workspace = Workspace.objects.get(slug=slug)

        (workspace_properties, _) = WorkspaceUserProperties.objects.get_or_create(
            user=request.user, workspace_id=workspace.id
        )

        serializer = WorkspaceUserPropertiesSerializer(workspace_properties, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def get(self, request, slug):
        """Return the caller's workspace user properties row, creating it if absent."""
        workspace = Workspace.objects.get(slug=slug)

        (workspace_properties, _) = WorkspaceUserProperties.objects.get_or_create(
            user=request.user, workspace=workspace
        )

        serializer = WorkspaceUserPropertiesSerializer(workspace_properties)
        return Response(serializer.data, status=status.HTTP_200_OK)


class WorkspaceUserProfileEndpoint(BaseAPIView):
    """Return a target user's public profile + per-project issue rollups.

    HTTP methods + URL pattern:
        GET /api/workspaces/<str:slug>/user-profile/<uuid:user_id>/

    Response shape:
        {
            "user_data": {email, first_name, last_name, avatar_url,
                cover_image_url, date_joined, user_timezone, display_name},
            "project_data": List[
                {id, logo_props, created_issues, assigned_issues,
                 completed_issues, pending_issues}
            ]
        }

    ``project_data`` is only populated when the requesting user has at
    least Member-level access (``role >= 15``); guests receive an empty
    list. Each entry counts issues created / assigned / completed /
    pending (non-archived, non-draft) for the target user in the project.

    Request body:
        None (GET only).

    Permissions:
        Inherits default ``BaseAPIView`` permissions; both the caller and
        the target user must be active workspace members or the
        ``WorkspaceMember.objects.get(...)`` call raises 404. The inline
        comment preserved verbatim notes this is a deliberate safety
        check: ``# Verify the target user is also an active member of
        this workspace before exposing their profile data.``

    Cross-references:
        - Models: ``apps/api/plane/db/models/workspace.py``
          (``WorkspaceMember``), ``apps/api/plane/db/models/user.py``
          (``User``), ``apps/api/plane/db/models/project.py``
          (``Project``), ``apps/api/plane/db/models/issue.py``
          (``Issue``).
        - URL registration: ``apps/api/plane/app/urls/workspace.py``.
    """

    def get(self, request, slug, user_id):
        """Return target user's profile + per-project issue rollups.

        Both the caller and the target must be active workspace members.
        Project-level rollups are only attached for non-guest callers
        (``role >= 15``); guests receive ``project_data = []``.
        """
        requesting_workspace_member = WorkspaceMember.objects.get(
            workspace__slug=slug, member=request.user, is_active=True
        )

        # Verify the target user is also an active member of this workspace
        # before exposing their profile data.
        target_workspace_member = WorkspaceMember.objects.select_related("member").get(
            workspace__slug=slug, member_id=user_id, is_active=True
        )
        user_data = target_workspace_member.member
        projects = []
        if requesting_workspace_member.role >= 15:
            projects = (
                Project.objects.filter(
                    workspace__slug=slug,
                    project_projectmember__member=request.user,
                    project_projectmember__is_active=True,
                    archived_at__isnull=True,
                )
                .annotate(
                    created_issues=Count(
                        "project_issue",
                        filter=Q(
                            project_issue__created_by_id=user_id,
                            project_issue__archived_at__isnull=True,
                            project_issue__is_draft=False,
                        ),
                    )
                )
                .annotate(
                    assigned_issues=Count(
                        "project_issue",
                        filter=Q(
                            project_issue__assignees__in=[user_id],
                            project_issue__archived_at__isnull=True,
                            project_issue__is_draft=False,
                        ),
                    )
                )
                .annotate(
                    completed_issues=Count(
                        "project_issue",
                        filter=Q(
                            project_issue__completed_at__isnull=False,
                            project_issue__assignees__in=[user_id],
                            project_issue__archived_at__isnull=True,
                            project_issue__is_draft=False,
                        ),
                    )
                )
                .annotate(
                    pending_issues=Count(
                        "project_issue",
                        filter=Q(
                            project_issue__state__group__in=[
                                "backlog",
                                "unstarted",
                                "started",
                            ],
                            project_issue__assignees__in=[user_id],
                            project_issue__archived_at__isnull=True,
                            project_issue__is_draft=False,
                        ),
                    )
                )
                .values(
                    "id",
                    "logo_props",
                    "created_issues",
                    "assigned_issues",
                    "completed_issues",
                    "pending_issues",
                )
            )

        return Response(
            {
                "project_data": projects,
                "user_data": {
                    "email": user_data.email,
                    "first_name": user_data.first_name,
                    "last_name": user_data.last_name,
                    "avatar_url": user_data.avatar_url,
                    "cover_image_url": user_data.cover_image_url,
                    "date_joined": user_data.date_joined,
                    "user_timezone": user_data.user_timezone,
                    "display_name": user_data.display_name,
                },
            },
            status=status.HTTP_200_OK,
        )


class WorkspaceUserActivityEndpoint(BaseAPIView):
    """Paginated activity feed for a target user across the workspace.

    HTTP methods + URL pattern:
        GET /api/workspaces/<str:slug>/user-activity/<uuid:user_id>/

    Query parameters:
        project (uuid[], optional, repeatable): narrow to specific
            projects.
        order_by (str, optional, default ``"-created_at"``).

    Response shape:
        Paginated list of ``IssueActivitySerializer`` rows. Activity rows
        with ``field`` in ``{"comment", "vote", "reaction", "draft"}`` are
        excluded.

    Request body:
        None (GET only). Behavior is parameterized via query parameters
        documented above.

    Permissions:
        permission_classes = [WorkspaceEntityPermission] — any active
        workspace member -- declared on the class attribute (see
        ``apps/api/plane/app/views/workspace/user.py``).

    Queryset:
        Restricts to activity in projects the caller is an active member
        of and that are not archived.

    Cross-references:
        - Permission: ``apps/api/plane/app/permissions/workspace.py``
          (``WorkspaceEntityPermission``).
        - Serializer: ``apps/api/plane/app/serializers/issue.py``
          (``IssueActivitySerializer``).
        - Model: ``apps/api/plane/db/models/issue.py`` (``IssueActivity``).
        - URL registration: ``apps/api/plane/app/urls/workspace.py``.
    """

    permission_classes = [WorkspaceEntityPermission]

    def get(self, request, slug, user_id):
        """Paginated issue-activity feed for a target user, with project filters."""
        projects = request.query_params.getlist("project", [])

        queryset = IssueActivity.objects.filter(
            ~Q(field__in=["comment", "vote", "reaction", "draft"]),
            workspace__slug=slug,
            project__project_projectmember__member=request.user,
            project__project_projectmember__is_active=True,
            project__archived_at__isnull=True,
            actor=user_id,
        ).select_related("actor", "workspace", "issue", "project")

        if projects:
            queryset = queryset.filter(project__in=projects)

        return self.paginate(
            order_by=request.GET.get("order_by", "-created_at"),
            request=request,
            queryset=queryset,
            on_results=lambda issue_activities: IssueActivitySerializer(issue_activities, many=True).data,
        )


class WorkspaceUserProfileStatsEndpoint(BaseAPIView):
    """Return per-user profile statistics across the workspace.

    HTTP methods + URL pattern:
        GET /api/workspaces/<str:slug>/user-stats/<uuid:user_id>/

    Query parameters:
        All keys consumed by ``issue_filters`` (date ranges, state
        groups, etc.).

    Response shape:
        {
            "state_distribution": List[{state_group, state_count}],
            "priority_distribution": List[{priority, priority_count,
                priority_order}],
            "created_issues": int,
            "assigned_issues": int,
            "completed_issues": int,
            "pending_issues": int,
            "subscribed_issues": int,
            "present_cycles": List[{cycle__name, cycle__id,
                cycle__project_id}],
            "upcoming_cycles": List[{cycle__name, cycle__id,
                cycle__project_id}]
        }

    Request body:
        None (GET only). Behavior is parameterized via query parameters
        documented above.

    Permissions:
        Inherits default ``BaseAPIView`` permissions; queries are scoped
        to projects the caller is an active member of.

    Priority ordering:
        Priority distribution is sorted by the explicit precedence
        ``["urgent", "high", "medium", "low", "none"]`` via a ``Case`` /
        ``When`` annotation so the UI can render priority charts in
        semantic order.

    Cross-references:
        - Models: ``apps/api/plane/db/models/issue.py`` (``Issue``,
          ``IssueSubscriber``), ``apps/api/plane/db/models/cycle.py``
          (``CycleIssue``).
        - Filter helper: ``apps/api/plane/utils/issue_filters.py``.
        - URL registration: ``apps/api/plane/app/urls/workspace.py``.
    """

    def get(self, request, slug, user_id):
        """Return state/priority distributions, issue counts, and cycle position."""
        filters = issue_filters(request.query_params, "GET")

        state_distribution = (
            Issue.issue_objects.filter(
                (Q(assignees__in=[user_id]) & Q(issue_assignee__deleted_at__isnull=True)),
                workspace__slug=slug,
                project__project_projectmember__member=request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(**filters)
            .annotate(state_group=F("state__group"))
            .values("state_group")
            .annotate(state_count=Count("state_group"))
            .order_by("state_group")
        )

        priority_order = ["urgent", "high", "medium", "low", "none"]

        priority_distribution = (
            Issue.issue_objects.filter(
                (Q(assignees__in=[user_id]) & Q(issue_assignee__deleted_at__isnull=True)),
                workspace__slug=slug,
                project__project_projectmember__member=request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(**filters)
            .values("priority")
            .annotate(priority_count=Count("priority"))
            .filter(priority_count__gte=1)
            .annotate(
                priority_order=Case(
                    *[When(priority=p, then=Value(i)) for i, p in enumerate(priority_order)],
                    default=Value(len(priority_order)),
                    output_field=IntegerField(),
                )
            )
            .order_by("priority_order")
        )

        created_issues = (
            Issue.issue_objects.filter(
                workspace__slug=slug,
                project__project_projectmember__member=request.user,
                project__project_projectmember__is_active=True,
                created_by_id=user_id,
            )
            .filter(**filters)
            .count()
        )

        assigned_issues_count = (
            Issue.issue_objects.filter(
                (Q(assignees__in=[user_id]) & Q(issue_assignee__deleted_at__isnull=True)),
                workspace__slug=slug,
                project__project_projectmember__member=request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(**filters)
            .count()
        )

        pending_issues_count = (
            Issue.issue_objects.filter(
                ~Q(state__group__in=["completed", "cancelled"]),
                (Q(assignees__in=[user_id]) & Q(issue_assignee__deleted_at__isnull=True)),
                workspace__slug=slug,
                project__project_projectmember__member=request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(**filters)
            .count()
        )

        completed_issues_count = (
            Issue.issue_objects.filter(
                (Q(assignees__in=[user_id]) & Q(issue_assignee__deleted_at__isnull=True)),
                workspace__slug=slug,
                state__group="completed",
                project__project_projectmember__member=request.user,
                project__project_projectmember__is_active=True,
            )
            .filter(**filters)
            .count()
        )

        subscribed_issues_count = (
            IssueSubscriber.objects.filter(
                workspace__slug=slug,
                subscriber_id=user_id,
                project__project_projectmember__member=request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
            )
            .filter(**filters)
            .count()
        )

        upcoming_cycles = CycleIssue.objects.filter(
            workspace__slug=slug,
            cycle__start_date__gt=timezone.now(),
            issue__assignees__in=[user_id],
        ).values("cycle__name", "cycle__id", "cycle__project_id")

        present_cycle = CycleIssue.objects.filter(
            workspace__slug=slug,
            cycle__start_date__lt=timezone.now(),
            cycle__end_date__gt=timezone.now(),
            issue__assignees__in=[user_id],
        ).values("cycle__name", "cycle__id", "cycle__project_id")

        return Response(
            {
                "state_distribution": state_distribution,
                "priority_distribution": priority_distribution,
                "created_issues": created_issues,
                "assigned_issues": assigned_issues_count,
                "completed_issues": completed_issues_count,
                "pending_issues": pending_issues_count,
                "subscribed_issues": subscribed_issues_count,
                "present_cycles": present_cycle,
                "upcoming_cycles": upcoming_cycles,
            }
        )


class UserActivityGraphEndpoint(BaseAPIView):
    """Return a 6-month daily activity heatmap for the caller in the workspace.

    HTTP methods + URL pattern:
        GET /api/users/me/workspaces/<str:slug>/activity-graph/

    Response shape:
        List[{created_date, activity_count}] — one row per day with a
        non-zero count, from six months ago through today, in ascending
        order.

    Request body:
        None (GET only).

    Permissions:
        Inherits default ``BaseAPIView`` permissions; queries are scoped
        by ``actor=request.user`` so callers only see their own
        activity heatmap.

    Cross-references:
        - Model: ``apps/api/plane/db/models/issue.py``
          (``IssueActivity``).
        - URL registration: ``apps/api/plane/app/urls/user.py``.
    """

    def get(self, request, slug):
        """Aggregate the caller's issue-activity rows per day, last 6 months."""
        issue_activities = (
            IssueActivity.objects.filter(
                actor=request.user,
                workspace__slug=slug,
                created_at__date__gte=date.today() + relativedelta(months=-6),
            )
            .annotate(created_date=Cast("created_at", DateField()))
            .values("created_date")
            .annotate(activity_count=Count("created_date"))
            .order_by("created_date")
        )

        return Response(issue_activities, status=status.HTTP_200_OK)


class UserIssueCompletedGraphEndpoint(BaseAPIView):
    """Return week-in-month completed-issue counts for the caller in the workspace.

    HTTP methods + URL pattern:
        GET /api/users/me/workspaces/<str:slug>/issues-completed-graph/

    Query parameters:
        month (int, optional, default ``1``): the calendar month to roll
            up.

    Response shape:
        List[{week, completed_count}] — one row per ``ExtractWeek(...) %
        4`` bucket so the four-bar weekly chart can render without
        additional client-side math.

    Request body:
        None (GET only). Behavior is parameterized via the ``month``
        query parameter documented above.

    Permissions:
        Inherits default ``BaseAPIView`` permissions; queries are scoped
        by ``assignees__in=[request.user]``.

    Cross-references:
        - Model: ``apps/api/plane/db/models/issue.py`` (``Issue``).
        - URL registration: ``apps/api/plane/app/urls/user.py``.
    """

    def get(self, request, slug):
        """Aggregate the caller's completed-issue counts per week of the given month."""
        month = request.GET.get("month", 1)

        issues = (
            Issue.issue_objects.filter(
                assignees__in=[request.user],
                workspace__slug=slug,
                completed_at__month=month,
                completed_at__isnull=False,
            )
            .annotate(completed_week=ExtractWeek("completed_at"))
            .annotate(week=F("completed_week") % 4)
            .values("week")
            .annotate(completed_count=Count("completed_week"))
            .order_by("week")
        )

        return Response(issues, status=status.HTTP_200_OK)
