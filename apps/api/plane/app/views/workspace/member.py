# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace member roster and per-user membership endpoints.

Covers four surfaces:

* ``WorkSpaceMemberViewSet`` — admin-facing roster management
  (list / retrieve / change role / remove member / leave workspace).
* ``WorkspaceMemberUserViewsEndpoint`` — persists the caller's own
  ``view_props`` JSON blob (kanban/list per-view preferences).
* ``WorkspaceMemberUserEndpoint`` — returns the caller's own
  ``WorkspaceMember`` record annotated with a draft-issue count.
* ``WorkspaceProjectMemberEndpoint`` — returns the caller's project
  membership role across the workspace, grouped by ``project_id``.

Role numerics (per ``plane.app.permissions.base.ROLE``):
    ADMIN = 20, MEMBER = 15, GUEST = 5.
"""

# Django imports
from django.db.models import Count, Q, OuterRef, Subquery, IntegerField
from django.utils import timezone
from django.db.models.functions import Coalesce

# Third party modules
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import WorkspaceEntityPermission, allow_permission, ROLE

# Module imports
from plane.app.serializers import (
    ProjectMemberRoleSerializer,
    WorkspaceMemberAdminSerializer,
    WorkspaceMemberMeSerializer,
    WorkSpaceMemberSerializer,
)
from plane.app.views.base import BaseAPIView
from plane.db.models import Project, ProjectMember, WorkspaceMember, DraftIssue
from plane.utils.cache import invalidate_cache

from .. import BaseViewSet


class WorkSpaceMemberViewSet(BaseViewSet):
    """Manage the workspace member roster and self-leave.

    HTTP methods + URL patterns:
        GET    /api/workspaces/<str:slug>/members/
        GET    /api/workspaces/<str:slug>/members/<uuid:pk>/
        PATCH  /api/workspaces/<str:slug>/members/<uuid:pk>/
        DELETE /api/workspaces/<str:slug>/members/<uuid:pk>/
        POST   /api/workspaces/<str:slug>/members/leave/

    Request body (PATCH):
        ``WorkSpaceMemberSerializer`` fields — primarily ``role``
        (20 admin / 15 member / 5 guest). Demoting to guest (5) cascades
        by updating every ``ProjectMember.role`` in the workspace for that
        user to 5 as well, so a workspace guest cannot hold elevated
        project roles.

    Response shape:
        list / retrieve: ``WorkspaceMemberAdminSerializer`` for non-guests
            (``id``, ``member``, ``role``) and ``WorkSpaceMemberSerializer``
            for guests (so guests do not see admin-only fields).
        partial_update: ``WorkSpaceMemberSerializer`` row.
        destroy / leave: HTTP 204.

    Permissions:
        list / retrieve: ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER,
            ROLE.GUEST], level="WORKSPACE")`` — any active member.
        partial_update / destroy: ``@allow_permission([ROLE.ADMIN],
            level="WORKSPACE")`` — admins only.
        leave: ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST],
            level="WORKSPACE")`` — any active member can leave their own
            membership.

    Read replica:
        ``use_read_replica = True`` — listing is offloaded.

    Queryset:
        Filtered by ``workspace__slug`` with eager-loading of
        ``member`` and ``member__avatar_asset``.

    Side effects on ``leave`` (cache invalidation):
        Invalidates:
            * ``/api/workspaces/:slug/members/`` (per-URL)
            * ``/api/users/me/settings/``
            * ``api/users/me/workspaces/`` (multi)
        The Redis cache is purely a read-through cache — Celery uses
        RabbitMQ for task queueing, per architectural context.

    Self-mutation rules:
        * ``partial_update`` rejects with HTTP 400 if the caller tries to
          modify their own role (use the leave endpoint to step down).
        * ``destroy`` rejects with HTTP 400 if the caller tries to remove
          themselves (the leave endpoint exists for that).
        * ``destroy`` rejects with HTTP 400 if the requester holds a lower
          role than the target.
        * ``destroy`` rejects with HTTP 400 if the target is the only admin
          of any project (would orphan the project).
        * ``leave`` rejects with HTTP 400 if the caller is the sole admin
          of the workspace OR the sole admin of any project (workspaces /
          projects cannot be orphaned).

    Note on demotion:
        Demoting to ``role = 5`` (guest) updates the matching
        ``ProjectMember.role`` rows to 5 too — guests cannot hold
        elevated project roles.
    """

    serializer_class = WorkspaceMemberAdminSerializer
    model = WorkspaceMember

    search_fields = ["member__display_name", "member__first_name"]
    use_read_replica = True

    def get_queryset(self):
        """Return workspace-scoped members with eager-loaded member/avatar joins."""
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .select_related("member", "member__avatar_asset")
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug):
        """Return the workspace roster, masking admin-only fields for guests.

        Uses ``WorkspaceMemberAdminSerializer`` for non-guests (role > 5) and
        ``WorkSpaceMemberSerializer`` for guests so guest viewers never see
        admin-only fields.
        """
        workspace_member = WorkspaceMember.objects.get(member=request.user, workspace__slug=slug, is_active=True)

        # Get all active workspace members
        workspace_members = self.get_queryset()
        if workspace_member.role > 5:
            serializer = WorkspaceMemberAdminSerializer(workspace_members, fields=("id", "member", "role"), many=True)
        else:
            serializer = WorkSpaceMemberSerializer(workspace_members, fields=("id", "member", "role"), many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def retrieve(self, request, slug, pk):
        """Return one workspace member by id, masking fields for guests.

        Returns HTTP 404 if no membership matches ``pk``. Guests
        (``role <= ROLE.GUEST.value``) receive ``WorkSpaceMemberSerializer``;
        others receive ``WorkspaceMemberAdminSerializer``.
        """
        workspace_member = WorkspaceMember.objects.get(member=request.user, workspace__slug=slug, is_active=True)

        try:
            # Get the specific workspace member by pk
            member = self.get_queryset().get(pk=pk)
        except WorkspaceMember.DoesNotExist:
            return Response(
                {"error": "Workspace member not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        if workspace_member.role > ROLE.GUEST.value:
            serializer = WorkspaceMemberAdminSerializer(member, fields=("id", "member", "role"))
        else:
            serializer = WorkSpaceMemberSerializer(member, fields=("id", "member", "role"))
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def partial_update(self, request, slug, pk):
        """Update a member's role; reject self-updates and cascade guest demotion.

        Returns HTTP 400 with ``{"error": "You cannot update your own role"}``
        if the caller targets their own membership. If the new role is 5
        (guest), every ``ProjectMember`` row for that member in the workspace
        is downgraded to role 5 as well so guests cannot hold elevated
        project roles.
        """
        workspace_member = WorkspaceMember.objects.get(
            pk=pk, workspace__slug=slug, member__is_bot=False, is_active=True
        )
        if request.user.id == workspace_member.member_id:
            return Response(
                {"error": "You cannot update your own role"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # If a user is moved to a guest role he can't have any other role in projects
        if "role" in request.data and int(request.data.get("role")) == 5:
            ProjectMember.objects.filter(workspace__slug=slug, member_id=workspace_member.member_id).update(role=5)

        serializer = WorkSpaceMemberSerializer(workspace_member, data=request.data, partial=True)

        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN], level="WORKSPACE")
    def destroy(self, request, slug, pk):
        """Soft-remove a workspace member with multi-stage safety checks.

        Rejection paths (each returns HTTP 400):
            * Caller tries to remove themselves — use leave instead.
            * Requester's role is lower than the target's.
            * Target is the only admin (role 20) of at least one project in
              the workspace.

        On success the user is deactivated (``is_active = False``) on the
        ``WorkspaceMember`` row and on every active ``ProjectMember`` row in
        the workspace. Returns HTTP 204.
        """
        # Check the user role who is deleting the user
        workspace_member = WorkspaceMember.objects.get(
            workspace__slug=slug, pk=pk, member__is_bot=False, is_active=True
        )

        # check requesting user role
        requesting_workspace_member = WorkspaceMember.objects.get(
            workspace__slug=slug, member=request.user, is_active=True
        )

        if str(workspace_member.id) == str(requesting_workspace_member.id):
            return Response(
                {"error": "You cannot remove yourself from the workspace. Please use leave workspace"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if requesting_workspace_member.role < workspace_member.role:
            return Response(
                {"error": "You cannot remove a user having role higher than you"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if (
            Project.objects.annotate(
                total_members=Count("project_projectmember"),
                member_with_role=Count(
                    "project_projectmember",
                    filter=Q(
                        project_projectmember__member_id=workspace_member.id,
                        project_projectmember__role=20,
                    ),
                ),
            )
            .filter(total_members=1, member_with_role=1, workspace__slug=slug)
            .exists()
        ):
            return Response(
                {
                    "error": "User is a part of some projects where they are the only admin, they should either leave that project or promote another user to admin."  # noqa: E501
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Deactivate the users from the projects where the user is part of
        _ = ProjectMember.objects.filter(
            workspace__slug=slug, member_id=workspace_member.member_id, is_active=True
        ).update(is_active=False, updated_at=timezone.now())

        workspace_member.is_active = False
        workspace_member.save()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @invalidate_cache(
        path="/api/workspaces/:slug/members/",
        url_params=True,
        user=False,
        multiple=True,
    )
    @invalidate_cache(path="/api/users/me/settings/")
    @invalidate_cache(path="api/users/me/workspaces/", user=False, multiple=True)
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def leave(self, request, slug):
        """Allow the caller to leave the workspace, with anti-orphan guards.

        Cache invalidation (decorator chain):
            * ``/api/workspaces/:slug/members/`` (per-URL)
            * ``/api/users/me/settings/``
            * ``api/users/me/workspaces/`` (multi)

        Rejection paths (each returns HTTP 400):
            * Caller is the only admin (role 20) of the workspace.
            * Caller is the only admin of at least one project in the
              workspace.

        On success the caller's ``WorkspaceMember`` is deactivated and every
        active ``ProjectMember`` row in the workspace is also deactivated.
        Returns HTTP 204.
        """
        workspace_member = WorkspaceMember.objects.get(workspace__slug=slug, member=request.user, is_active=True)

        # Check if the leaving user is the only admin of the workspace
        if (
            workspace_member.role == 20
            and not WorkspaceMember.objects.filter(workspace__slug=slug, role=20, is_active=True).count() > 1
        ):
            return Response(
                {
                    "error": "You cannot leave the workspace as you are the only admin of the workspace you will have to either delete the workspace or promote another user to admin."  # noqa: E501
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if (
            Project.objects.annotate(
                total_members=Count("project_projectmember"),
                member_with_role=Count(
                    "project_projectmember",
                    filter=Q(
                        project_projectmember__member_id=request.user.id,
                        project_projectmember__role=20,
                    ),
                ),
            )
            .filter(total_members=1, member_with_role=1, workspace__slug=slug)
            .exists()
        ):
            return Response(
                {
                    "error": "You are a part of some projects where you are the only admin, you should either leave the project or promote another user to admin."  # noqa: E501
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # # Deactivate the users from the projects where the user is part of
        _ = ProjectMember.objects.filter(
            workspace__slug=slug, member_id=workspace_member.member_id, is_active=True
        ).update(is_active=False, updated_at=timezone.now())

        # # Deactivate the user
        workspace_member.is_active = False
        workspace_member.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkspaceMemberUserViewsEndpoint(BaseAPIView):
    """Persist the caller's ``view_props`` blob on their workspace membership.

    HTTP methods + URL pattern:
        POST /api/workspaces/<str:slug>/workspace-views/

    Request body:
        ``view_props`` (JSON object): kanban/list/spreadsheet UI state
        persisted on ``WorkspaceMember.view_props`` to survive across
        devices.

    Response shape:
        HTTP 204 (no content).

    Permissions:
        Inherits default ``BaseAPIView`` permissions (authenticated
        workspace member context via ``WorkspaceMember.is_active``); no
        explicit decorator is applied because the queryset itself filters
        by ``member=request.user``.
    """

    def post(self, request, slug):
        """Overwrite the caller's ``view_props`` JSON blob and return 204."""
        workspace_member = WorkspaceMember.objects.get(workspace__slug=slug, member=request.user, is_active=True)
        workspace_member.view_props = request.data.get("view_props", {})
        workspace_member.save()

        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkspaceMemberUserEndpoint(BaseAPIView):
    """Return the caller's own ``WorkspaceMember`` row with a draft-issue count.

    HTTP methods + URL pattern:
        GET /api/workspaces/<str:slug>/workspace-members/me/

    Response shape:
        ``WorkspaceMemberMeSerializer`` — annotated with a non-null
        ``draft_issue_count`` (coalesced to 0 when the user has no
        drafts).

    Permissions:
        Inherits default ``BaseAPIView`` permissions (authenticated user);
        the query is scoped to ``member=request.user`` so it cannot leak
        other users' memberships.

    Read replica:
        ``use_read_replica = True``.
    """

    use_read_replica = True

    def get(self, request, slug):
        """Return the caller's membership row with ``draft_issue_count``."""
        draft_issue_count = (
            DraftIssue.objects.filter(created_by=request.user, workspace_id=OuterRef("workspace_id"))
            .values("workspace_id")
            .annotate(count=Count("id"))
            .values("count")
        )

        workspace_member = (
            WorkspaceMember.objects.filter(member=request.user, workspace__slug=slug, is_active=True)
            .annotate(draft_issue_count=Coalesce(Subquery(draft_issue_count, output_field=IntegerField()), 0))
            .first()
        )
        serializer = WorkspaceMemberMeSerializer(workspace_member)
        return Response(serializer.data, status=status.HTTP_200_OK)


class WorkspaceProjectMemberEndpoint(BaseAPIView):
    """Return the caller's project memberships in the workspace, grouped by project.

    HTTP methods + URL pattern:
        GET /api/workspaces/<str:slug>/project-members/

    Response shape:
        ``dict[str, list[ProjectMemberRoleSerializer]]`` — keyed by
        project id, listing the project members of every project the
        caller is an active member of (so the frontend can render role
        badges without a per-project round-trip).

    Permissions:
        ``permission_classes = [WorkspaceEntityPermission]`` — any active
        workspace member.
    """

    serializer_class = ProjectMemberRoleSerializer
    model = ProjectMember

    permission_classes = [WorkspaceEntityPermission]

    def get(self, request, slug):
        """Return project members keyed by ``project_id`` for the caller's projects.

        Looks up the caller's active project memberships, fetches every
        member of those projects in one query (joining ``project``,
        ``member``, ``workspace``), and pivots the serialized list into a
        dictionary keyed by ``project_id``.
        """
        # Fetch all project IDs where the user is involved
        project_ids = (
            ProjectMember.objects.filter(member=request.user, is_active=True)
            .values_list("project_id", flat=True)
            .distinct()
        )

        # Get all the project members in which the user is involved
        project_members = ProjectMember.objects.filter(
            workspace__slug=slug, project_id__in=project_ids, is_active=True
        ).select_related("project", "member", "workspace")
        project_members = ProjectMemberRoleSerializer(project_members, many=True).data

        project_members_dict = dict()

        # Construct a dictionary with project_id as key and project_members as value
        for project_member in project_members:
            project_id = project_member.pop("project")
            if str(project_id) not in project_members_dict:
                project_members_dict[str(project_id)] = []
            project_members_dict[str(project_id)].append(project_member)

        return Response(project_members_dict, status=status.HTTP_200_OK)
