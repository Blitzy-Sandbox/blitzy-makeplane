# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Foundational workspace endpoints: CRUD, listings, dashboard, themes, export.

This module is the top of the workspace URL hierarchy. Every other
workspace resource (members, invitations, cycles, drafts, etc.) lives
under ``/api/workspaces/<slug>/...`` and ultimately depends on the
existence and access controls enforced here.

Notable side effects:
    * Workspace creation enqueues ``workspace_seed.delay(workspace_id)``
      (Celery via RabbitMQ) to populate default states, labels, modules,
      and so on, then emits a ``WORKSPACE_CREATED`` analytics event via
      ``track_event.delay``.
    * Workspace deletion emits a ``WORKSPACE_DELETED`` analytics event
      and clears ``Profile.last_workspace_id`` for every user pointing
      at the deleted workspace.
    * Theme creation is restricted to workspace admins/members through
      ``WorkSpaceAdminPermission``.

The ``WeekInMonth`` Django ORM ``Func`` helper is defined here for the
dashboard's weekly issue rollup.
"""

# Python imports
import csv
import io
import os
from datetime import date
import uuid

from dateutil.relativedelta import relativedelta
from django.db import IntegrityError
from django.db.models import Count, F, Func, OuterRef, Prefetch, Q

from django.db.models.fields import DateField
from django.db.models.functions import Cast, ExtractDay, ExtractWeek


# Django imports
from django.http import HttpResponse
from django.utils import timezone

# Third party modules
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import (
    WorkSpaceAdminPermission,
    WorkSpaceBasePermission,
    WorkspaceEntityPermission,
)

# Module imports
from plane.app.serializers import WorkSpaceSerializer, WorkspaceThemeSerializer
from plane.app.views.base import BaseAPIView, BaseViewSet
from plane.db.models import (
    Issue,
    IssueActivity,
    Workspace,
    WorkspaceMember,
    WorkspaceTheme,
    Profile,
)
from plane.app.permissions import ROLE, allow_permission
from plane.utils.constants import RESTRICTED_WORKSPACE_SLUGS
from plane.license.utils.instance_value import get_configuration_value
from plane.bgtasks.workspace_seed_task import workspace_seed
from plane.bgtasks.event_tracking_task import track_event
from plane.utils.url import contains_url
from plane.utils.analytics_events import WORKSPACE_CREATED, WORKSPACE_DELETED
from plane.utils.csv_utils import sanitize_csv_row


class WorkSpaceViewSet(BaseViewSet):
    """Top-level workspace CRUD — the foundational endpoint of the URL hierarchy.

    HTTP methods + URL patterns:
        GET    /api/workspaces/                  -> list
        POST   /api/workspaces/                  -> create
        GET    /api/workspaces/<str:slug>/       -> retrieve
        PUT    /api/workspaces/<str:slug>/       -> update
        PATCH  /api/workspaces/<str:slug>/       -> partial_update
        DELETE /api/workspaces/<str:slug>/       -> destroy

    Request body (POST):
        name (str, required, max length 80): human-readable workspace name.
            Must not contain a URL (anti-spam check).
        slug (str, required, max length 48, UNIQUE): URL-safe slug; must
            not appear in ``RESTRICTED_WORKSPACE_SLUGS``.
        organization_size (str, optional): qualitative size bucket.
        logo (str, optional): logo asset reference (URL or asset id).
        company_role (str, optional): caller's role within the new
            workspace; stored on the owner's ``WorkspaceMember`` row.

    Response shape (POST):
        ``WorkSpaceSerializer`` payload augmented with ``total_members`` (1
        on create) and ``role`` (20 for the creator). HTTP 201.

    Response shape (list / retrieve):
        ``WorkSpaceSerializer`` rows annotated with ``total_members``
        (counts active, non-bot ``WorkspaceMember`` rows). Listing is
        restricted to workspaces the caller is an active member of and
        ordered by name.

    Permissions:
        permission_classes = [WorkSpaceBasePermission]:
            * Anonymous: denied.
            * POST: allowed (anyone authenticated may create a workspace
              unless the instance config ``DISABLE_WORKSPACE_CREATION``
              equals ``"1"``).
            * SAFE methods: any authenticated user (queryset filters
              enforce visibility).
            * PUT/PATCH: admins or members.
            * DELETE: admins only.
        Plus the per-action ``@allow_permission`` decorators:
            list -> ADMIN/MEMBER/GUEST
            partial_update -> ADMIN
            destroy -> ADMIN

    Lookup field:
        ``slug`` — workspaces are addressed by slug, not by uuid.

    Search:
        search_fields = ["name"], filterset_fields = ["owner"].

    Side effects on ``create``:
        1. Honors ``DISABLE_WORKSPACE_CREATION`` instance config — HTTP 403
           if set to ``"1"``.
        2. Saves the workspace with ``owner=request.user``.
        3. Creates the owner's ``WorkspaceMember`` row with role=20 and the
           caller-supplied ``company_role``.
        4. Returns the serialized payload augmented with ``total_members``
           and ``role``.
        5. Dispatches ``workspace_seed.delay(workspace_id)`` (Celery via
           RabbitMQ) to seed defaults.
        6. Dispatches ``track_event.delay`` with ``event_name=
           WORKSPACE_CREATED``.
        7. On slug collision returns HTTP 409 with the body
           ``{"slug": "The workspace with the slug already exists"}``.

    Side effects on ``destroy``:
        1. Resolves the workspace via ``self.get_object()``.
        2. Sets every ``Profile.last_workspace_id`` referencing the
           deleted workspace back to ``None``.
        3. Dispatches ``track_event.delay`` with ``event_name=
           WORKSPACE_DELETED``.
        4. Delegates to ``super().destroy(request, *args, **kwargs)`` for
           the actual deletion semantics (soft-delete via mixin).

    Queryset:
        Eager-loads ``owner`` via ``select_related`` and annotates
        ``total_members`` via a correlated ``WorkspaceMember`` count of
        active, non-bot members.
    """

    model = Workspace
    serializer_class = WorkSpaceSerializer
    permission_classes = [WorkSpaceBasePermission]

    search_fields = ["name"]
    filterset_fields = ["owner"]

    lookup_field = "slug"

    def get_queryset(self):
        """Return workspaces the caller is an active member of, with member counts.

        Annotates each workspace with ``total_members`` (active, non-bot
        ``WorkspaceMember`` rows) via a correlated subquery and orders by
        name.
        """
        member_count = (
            WorkspaceMember.objects.filter(workspace=OuterRef("id"), member__is_bot=False, is_active=True)
            .order_by()
            .annotate(count=Func(F("id"), function="Count"))
            .values("count")
        )

        return (
            self.filter_queryset(super().get_queryset().select_related("owner"))
            .order_by("name")
            .filter(
                workspace_member__member=self.request.user,
                workspace_member__is_active=True,
            )
            .annotate(total_members=member_count)
        )

    def create(self, request):
        """Create a new workspace owned by the caller and seed it.

        Honors the ``DISABLE_WORKSPACE_CREATION`` instance configuration; if
        that flag is ``"1"`` the call returns HTTP 403. Validates the slug
        against ``RESTRICTED_WORKSPACE_SLUGS`` (uniqueness handled at the DB
        level — surfaces as HTTP 409 on ``IntegrityError``). On success
        creates the owner's ``WorkspaceMember`` row (role 20), dispatches
        ``workspace_seed.delay`` (Celery via RabbitMQ) to populate defaults,
        and emits a ``WORKSPACE_CREATED`` analytics event. See the class
        docstring for the full request/response schema.
        """
        try:
            (DISABLE_WORKSPACE_CREATION,) = get_configuration_value(
                [
                    {
                        "key": "DISABLE_WORKSPACE_CREATION",
                        "default": os.environ.get("DISABLE_WORKSPACE_CREATION", "0"),
                    }
                ]
            )

            if DISABLE_WORKSPACE_CREATION == "1":
                return Response(
                    {"error": "Workspace creation is not allowed"},
                    status=status.HTTP_403_FORBIDDEN,
                )

            serializer = WorkSpaceSerializer(data=request.data)

            slug = request.data.get("slug", False)
            name = request.data.get("name", False)

            if not name or not slug:
                return Response(
                    {"error": "Both name and slug are required"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if len(name) > 80 or len(slug) > 48:
                return Response(
                    {"error": "The maximum length for name is 80 and for slug is 48"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if contains_url(name):
                return Response(
                    {"error": "Name cannot contain a URL"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if serializer.is_valid(raise_exception=True):
                serializer.save(owner=request.user)
                # Create Workspace member
                _ = WorkspaceMember.objects.create(
                    workspace_id=serializer.data["id"],
                    member=request.user,
                    role=20,
                    company_role=request.data.get("company_role", ""),
                )

                # Get total members and role
                total_members = WorkspaceMember.objects.filter(workspace_id=serializer.data["id"]).count()
                data = serializer.data
                data["total_members"] = total_members
                data["role"] = 20

                workspace_seed.delay(serializer.data["id"])

                track_event.delay(
                    user_id=request.user.id,
                    event_name=WORKSPACE_CREATED,
                    slug=data["slug"],
                    event_properties={
                        "user_id": request.user.id,
                        "workspace_id": data["id"],
                        "workspace_slug": data["slug"],
                        "role": "owner",
                        "workspace_name": data["name"],
                        "created_at": data["created_at"],
                    },
                )

                return Response(data, status=status.HTTP_201_CREATED)
            return Response(
                [serializer.errors[error][0] for error in serializer.errors],
                status=status.HTTP_400_BAD_REQUEST,
            )

        except IntegrityError as e:
            if "already exists" in str(e):
                return Response(
                    {"slug": "The workspace with the slug already exists"},
                    status=status.HTTP_409_CONFLICT,
                )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, *args, **kwargs):
        """List workspaces the caller is an active member of (any role)."""
        return super().list(request, *args, **kwargs)

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def partial_update(self, request, *args, **kwargs):
        """Update workspace fields (admin only, partial update semantics)."""
        return super().partial_update(request, *args, **kwargs)

    def remove_last_workspace_ids_from_user_settings(self, id: uuid.UUID) -> None:
        """Clear ``Profile.last_workspace_id`` on every profile referencing this workspace."""
        Profile.objects.filter(last_workspace_id=id).update(last_workspace_id=None)
        return

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def destroy(self, request, *args, **kwargs):
        """Delete a workspace (admin only), clearing every user's last-workspace pointer.

        Sets every ``Profile.last_workspace_id`` referencing this workspace
        back to ``None`` so users aren't routed to a missing workspace on
        next login, then emits a ``WORKSPACE_DELETED`` analytics event before
        delegating to the base destroy (which performs soft deletion through
        the cascading mixin).
        """
        # Get the workspace
        workspace = self.get_object()
        self.remove_last_workspace_ids_from_user_settings(workspace.id)
        track_event.delay(
            user_id=request.user.id,
            event_name=WORKSPACE_DELETED,
            slug=workspace.slug,
            event_properties={
                "user_id": request.user.id,
                "workspace_id": workspace.id,
                "workspace_slug": workspace.slug,
                "role": "owner",
                "workspace_name": workspace.name,
                "deleted_at": str(timezone.now().isoformat()),
            },
        )
        return super().destroy(request, *args, **kwargs)


class UserWorkSpacesEndpoint(BaseAPIView):
    """List the caller's workspaces with role and member-count annotations.

    HTTP methods + URL pattern:
        GET /api/users/me/workspaces/   (mounted under the user URL
            namespace; see ``apps/api/plane/app/urls/user.py``)

    Query parameters:
        fields (str, optional, comma-separated): when supplied, the
            response only contains those serializer fields (sparse
            fieldsets via ``WorkSpaceSerializer(fields=...)``).
        Plus standard DRF search/filter params (``search`` against
        ``name``, ``owner`` filter).

    Response shape:
        List[WorkSpaceSerializer (sparse)] — each row carries ``role``
        (caller's role) and ``total_members`` (active, non-bot members).

    Permissions:
        Inherits default ``BaseAPIView`` permissions (authenticated
        user). The queryset filters by ``workspace_member__member=
        request.user`` so callers only see their own workspaces.

    Read replica:
        ``use_read_replica = True``.
    """

    search_fields = ["name"]
    filterset_fields = ["owner"]
    use_read_replica = True

    def get(self, request):
        """Return the caller's workspaces with role + total-members annotations."""
        fields = [field for field in request.GET.get("fields", "").split(",") if field]
        member_count = (
            WorkspaceMember.objects.filter(workspace=OuterRef("id"), member__is_bot=False, is_active=True)
            .order_by()
            .annotate(count=Func(F("id"), function="Count"))
            .values("count")
        )

        role = WorkspaceMember.objects.filter(workspace=OuterRef("id"), member=request.user, is_active=True).values(
            "role"
        )

        workspace = (
            Workspace.objects.prefetch_related(
                Prefetch(
                    "workspace_member",
                    queryset=WorkspaceMember.objects.filter(member=request.user, is_active=True),
                )
            )
            .annotate(role=role, total_members=member_count)
            .filter(workspace_member__member=request.user, workspace_member__is_active=True)
            .distinct()
        )

        workspaces = WorkSpaceSerializer(
            self.filter_queryset(workspace),
            fields=fields if fields else None,
            many=True,
        ).data

        return Response(workspaces, status=status.HTTP_200_OK)


class WorkSpaceAvailabilityCheckEndpoint(BaseAPIView):
    """Check whether a workspace slug is still available.

    HTTP methods + URL pattern:
        GET /api/workspace-slug-check/?slug=foo

    Query parameters:
        slug (str, required): the candidate slug.

    Response shape:
        {"status": bool} — ``true`` if the slug is available,
        ``false`` if it is taken (existing workspace) or restricted
        (``RESTRICTED_WORKSPACE_SLUGS``).

    Permissions:
        Inherits default ``BaseAPIView`` permissions.

    Errors:
        HTTP 400 if the ``slug`` query parameter is missing or empty.
    """

    def get(self, request):
        """Return whether the supplied slug is available for use."""
        slug = request.GET.get("slug", False)

        if not slug or slug == "":
            return Response(
                {"error": "Workspace Slug is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        workspace = Workspace.objects.filter(slug=slug).exists() or slug in RESTRICTED_WORKSPACE_SLUGS
        return Response({"status": not workspace}, status=status.HTTP_200_OK)


class WeekInMonth(Func):
    """Django ORM ``Func`` that rounds a day-of-month into a week-in-month bucket.

    Used by the dashboard's completed-issues rollup to group issues into
    the four "weeks" of a month (1-7, 8-14, 15-21, 22-28+). Implemented
    in raw SQL as ``FLOOR(((day - 1) / 7) + 1)`` cast to ``INTEGER`` so
    PostgreSQL handles the integer division natively.
    """

    function = "FLOOR"
    template = "(((%(expressions)s - 1) / 7) + 1)::INTEGER"


class UserWorkspaceDashboardEndpoint(BaseAPIView):
    """Return the caller's workspace dashboard rollups.

    HTTP methods + URL pattern:
        GET /api/workspaces/<str:slug>/dashboard/  # consumed by the
            dashboard view; see ``apps/api/plane/app/urls/workspace.py``
            for the exact mount point if exposed.

    Query parameters:
        month (int, optional, default ``1``): month-of-year for the
            completed-issues histogram.

    Response shape:
        {
            "issue_activities": List[{created_date, activity_count}],
            "completed_issues": List[{week_in_month, completed_count}],
            "assigned_issues_count": int,
            "pending_issues_count": int,
            "completed_issues_count": int,
            "issues_due_week_count": int,
            "state_distribution": List[{state_group, state_count}],
            "overdue_issues": List[{id, name, workspace__slug,
                project_id, target_date}],
            "upcoming_issues": List[{id, name, workspace__slug,
                project_id, start_date}]
        }

    Permissions:
        Inherits default ``BaseAPIView`` permissions. Every query is
        scoped by ``actor=request.user`` or
        ``assignees__in=[request.user]``.

    Notes:
        The ``issue_activities`` rollup looks back three months; the
        ``completed_issues`` rollup uses ``WeekInMonth`` to bucket the
        requested month into four week-of-month buckets.
    """

    def get(self, request, slug):
        """Aggregate dashboard rollups: activity, completion, distribution, overdue, upcoming.

        See the class docstring for the full response schema. Each section is
        a separate aggregation:

        * ``issue_activities``: 3-month daily activity heatmap by ``actor``.
        * ``completed_issues``: month-of-year completed counts bucketed by
          ``WeekInMonth(ExtractDay(...))``.
        * ``state_distribution``: counts of caller-assigned issues per state
          group.
        * ``overdue_issues`` / ``upcoming_issues``: open issues past target
          date or starting after now.
        """
        issue_activities = (
            IssueActivity.objects.filter(
                actor=request.user,
                workspace__slug=slug,
                created_at__date__gte=date.today() + relativedelta(months=-3),
            )
            .annotate(created_date=Cast("created_at", DateField()))
            .values("created_date")
            .annotate(activity_count=Count("created_date"))
            .order_by("created_date")
        )

        month = request.GET.get("month", 1)

        completed_issues = (
            Issue.issue_objects.filter(
                assignees__in=[request.user],
                workspace__slug=slug,
                completed_at__month=month,
                completed_at__isnull=False,
            )
            .annotate(day_of_month=ExtractDay("completed_at"))
            .annotate(week_in_month=WeekInMonth(F("day_of_month")))
            .values("week_in_month")
            .annotate(completed_count=Count("id"))
            .order_by("week_in_month")
        )

        assigned_issues = Issue.issue_objects.filter(workspace__slug=slug, assignees__in=[request.user]).count()

        pending_issues_count = Issue.issue_objects.filter(
            ~Q(state__group__in=["completed", "cancelled"]),
            workspace__slug=slug,
            assignees__in=[request.user],
        ).count()

        completed_issues_count = Issue.issue_objects.filter(
            workspace__slug=slug, assignees__in=[request.user], state__group="completed"
        ).count()

        issues_due_week = (
            Issue.issue_objects.filter(workspace__slug=slug, assignees__in=[request.user])
            .annotate(target_week=ExtractWeek("target_date"))
            .filter(target_week=timezone.now().date().isocalendar()[1])
            .count()
        )

        state_distribution = (
            Issue.issue_objects.filter(workspace__slug=slug, assignees__in=[request.user])
            .annotate(state_group=F("state__group"))
            .values("state_group")
            .annotate(state_count=Count("state_group"))
            .order_by("state_group")
        )

        overdue_issues = Issue.issue_objects.filter(
            ~Q(state__group__in=["completed", "cancelled"]),
            workspace__slug=slug,
            assignees__in=[request.user],
            target_date__lt=timezone.now(),
            completed_at__isnull=True,
        ).values("id", "name", "workspace__slug", "project_id", "target_date")

        upcoming_issues = Issue.issue_objects.filter(
            ~Q(state__group__in=["completed", "cancelled"]),
            start_date__gte=timezone.now(),
            workspace__slug=slug,
            assignees__in=[request.user],
            completed_at__isnull=True,
        ).values("id", "name", "workspace__slug", "project_id", "start_date")

        return Response(
            {
                "issue_activities": issue_activities,
                "completed_issues": completed_issues,
                "assigned_issues_count": assigned_issues,
                "pending_issues_count": pending_issues_count,
                "completed_issues_count": completed_issues_count,
                "issues_due_week_count": issues_due_week,
                "state_distribution": state_distribution,
                "overdue_issues": overdue_issues,
                "upcoming_issues": upcoming_issues,
            },
            status=status.HTTP_200_OK,
        )


class WorkspaceThemeViewSet(BaseViewSet):
    """Workspace theme CRUD (admin-only branding settings).

    HTTP methods + URL patterns:
        GET    /api/workspaces/<str:slug>/workspace-themes/
        POST   /api/workspaces/<str:slug>/workspace-themes/
        GET    /api/workspaces/<str:slug>/workspace-themes/<uuid:pk>/
        PATCH  /api/workspaces/<str:slug>/workspace-themes/<uuid:pk>/
        DELETE /api/workspaces/<str:slug>/workspace-themes/<uuid:pk>/

    Request body (POST/PATCH):
        ``WorkspaceThemeSerializer`` fields — color tokens, accent colors,
        branding metadata.

    Response shape:
        ``WorkspaceThemeSerializer``.

    Permissions:
        permission_classes = [WorkSpaceAdminPermission] — workspace
        admins/members only.

    Side effects on create:
        Resolves the workspace by slug and saves with
        ``workspace=workspace, actor=request.user`` so the audit trail
        knows who applied the theme.

    Queryset:
        Filtered by ``workspace__slug``.
    """

    permission_classes = [WorkSpaceAdminPermission]
    model = WorkspaceTheme
    serializer_class = WorkspaceThemeSerializer

    def get_queryset(self):
        """Restrict the queryset to themes belonging to the supplied workspace."""
        return super().get_queryset().filter(workspace__slug=self.kwargs.get("slug"))

    def create(self, request, slug):
        """Create a new workspace theme stamped with the calling user as actor."""
        workspace = Workspace.objects.get(slug=slug)
        serializer = WorkspaceThemeSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(workspace=workspace, actor=request.user)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ExportWorkspaceUserActivityEndpoint(BaseAPIView):
    """Export a CSV of a target user's activity for a specific date.

    HTTP methods + URL pattern:
        POST /api/workspaces/<str:slug>/user-activity/<uuid:user_id>/export/

    Request body:
        date (str, required, ISO ``YYYY-MM-DD``): the activity day to
            export.

    Response shape:
        HTTP 200 with ``Content-Type: text/csv`` and
        ``Content-Disposition: attachment;
        filename="workspace-user-activity.csv"``. The CSV header is:
        ``[Actor name, Issue ID, Project, Created at, Updated at,
        Action, Field, Old value, New value]``.

    Permissions:
        permission_classes = [WorkspaceEntityPermission] — any active
        workspace member.

    Queryset:
        Excludes activity rows with ``field`` in
        ``{"comment", "vote", "reaction", "draft"}``, restricts to the
        target ``actor_id``, the workspace slug, and projects the caller
        is an active member of. Limited to 10,000 rows per export.

    Errors:
        HTTP 400 if the ``date`` body field is missing.

    CSV safety:
        Each row passes through ``sanitize_csv_row`` so cells that begin
        with ``=``, ``+``, ``-``, or ``@`` cannot be interpreted as
        formulae when opened in spreadsheet software (CSV injection
        mitigation).
    """

    permission_classes = [WorkspaceEntityPermission]

    def generate_csv_from_rows(self, rows):
        """Return an ``io.StringIO`` of the supplied rows as a CSV with quoted cells.

        Every row passes through ``sanitize_csv_row`` so cells beginning with
        ``=``, ``+``, ``-``, or ``@`` are prefixed to prevent CSV injection
        when opened in spreadsheet software.
        """
        csv_buffer = io.StringIO()
        writer = csv.writer(csv_buffer, delimiter=",", quoting=csv.QUOTE_ALL)
        [writer.writerow(sanitize_csv_row(row)) for row in rows]
        csv_buffer.seek(0)
        return csv_buffer

    def post(self, request, slug, user_id):
        """Stream a CSV of the target user's issue-activity rows for ``date``.

        Capped at 10,000 rows. See the class docstring for the full response
        contract, including the CSV header schema and the sanitization
        applied to every cell.
        """
        if not request.data.get("date"):
            return Response({"error": "Date is required"}, status=status.HTTP_400_BAD_REQUEST)

        user_activities = IssueActivity.objects.filter(
            ~Q(field__in=["comment", "vote", "reaction", "draft"]),
            workspace__slug=slug,
            created_at__date=request.data.get("date"),
            project__project_projectmember__member=request.user,
            project__project_projectmember__is_active=True,
            actor_id=user_id,
        ).select_related("actor", "workspace", "issue", "project")[:10000]

        header = [
            "Actor name",
            "Issue ID",
            "Project",
            "Created at",
            "Updated at",
            "Action",
            "Field",
            "Old value",
            "New value",
        ]
        rows = [
            (
                activity.actor.display_name,
                f"{activity.project.identifier} - {activity.issue.sequence_id if activity.issue else ''}",
                activity.project.name,
                activity.created_at,
                activity.updated_at,
                activity.verb,
                activity.field,
                activity.old_value,
                activity.new_value,
            )
            for activity in user_activities
        ]
        csv_buffer = self.generate_csv_from_rows([header] + rows)
        response = HttpResponse(csv_buffer.getvalue(), content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="workspace-user-activity.csv"'
        return response
