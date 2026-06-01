# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Project member roster management and per-member preference endpoints.

Exposes four DRF views:

* :class:`ProjectMemberViewSet` -- admin-facing CRUD over
  :class:`plane.db.models.ProjectMember`. Enforces a strict role
  hierarchy: ``Admin=20 > Member=15 > Guest=5``. Workspace role
  consistency is enforced upfront so a workspace Guest cannot be
  promoted past Guest at the project layer, and a workspace Admin
  cannot be added with a lower role.
* :class:`ProjectMemberUserEndpoint` -- read-only "what is my
  membership?" endpoint used by the web client to render project
  context.
* :class:`UserProjectRolesEndpoint` -- workspace-wide read-replica
  endpoint returning a ``{project_id: role}`` mapping for the
  requesting user.
* :class:`ProjectMemberPreferenceEndpoint` -- read/update the JSON
  ``preferences`` blob on a specific project membership row.

Side effects (``ProjectMemberViewSet.create``):
    * Bulk creates or reactivates :class:`ProjectMember` and
      :class:`ProjectUserProperty` rows.
    * Enqueues ``project_add_user_email`` Celery tasks (RabbitMQ, not
      Redis -- Redis is caching/session only per the architectural
      context) for each freshly added member.

Role wire values (preserved as literals throughout this module for
serializer compatibility): ``Admin=20``, ``Member=15``, ``Guest=5``.
"""

# Third Party imports
from rest_framework.response import Response
from rest_framework import status
from django.db.models import Min

# Module imports
from .base import BaseViewSet, BaseAPIView
from plane.app.serializers import (
    ProjectMemberSerializer,
    ProjectMemberAdminSerializer,
    ProjectMemberRoleSerializer,
    ProjectMemberPreferenceSerializer,
)

from plane.app.permissions import WorkspaceUserPermission

from plane.db.models import Project, ProjectMember, ProjectUserProperty, WorkspaceMember
from plane.bgtasks.project_add_user_email_task import project_add_user_email
from plane.utils.host import base_host
from plane.app.permissions.base import allow_permission, ROLE


class ProjectMemberViewSet(BaseViewSet):
    """Per-project member roster CRUD and bulk-add endpoint.

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<project_id>/members/
        POST   /api/workspaces/<slug>/projects/<project_id>/members/
        GET    /api/workspaces/<slug>/projects/<project_id>/members/<pk>/
        PATCH  /api/workspaces/<slug>/projects/<project_id>/members/<pk>/
        DELETE /api/workspaces/<slug>/projects/<project_id>/members/<pk>/
        POST   /api/workspaces/<slug>/projects/<project_id>/members/leave/

    Request body (POST):
        members (list[dict], required): Each item is
            ``{"member_id": UUID, "role": int}``. Role values:
            ``Admin=20``, ``Member=15``, ``Guest=5``.

    Request body (PATCH):
        role (int, optional): New role for the target member. Subject
            to the role hierarchy rules below.

    Response shape (GET list, POST):
        :class:`plane.app.serializers.ProjectMemberRoleSerializer`
        output with fields ``id``, ``member``, ``role``.

    Response shape (GET detail):
        :class:`plane.app.serializers.ProjectMemberAdminSerializer`
        when the requesting user's role > ``ROLE.GUEST.value``, else
        the lighter :class:`ProjectMemberRoleSerializer`.

    Permissions:
        Default :class:`plane.app.permissions.ProjectBasePermission`
        plus per-method ``@allow_permission`` decorators:

        * ``create`` / ``destroy`` -- ``[ROLE.ADMIN]`` only.
        * ``list`` / ``retrieve`` / ``partial_update`` / ``leave`` --
          ``[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST]``.

    Role hierarchy rules enforced on ``partial_update``:
        * A non-admin cannot edit their own role.
        * Cannot modify a member whose role is equal to or higher
          than your own.
        * Cannot assign a role equal to or higher than your own.
        * Workspace Guests cannot be elevated to Member or Admin at
          the project layer.

    Role hierarchy rules enforced on ``destroy`` (soft-delete):
        * Cannot remove yourself (use ``leave`` instead).
        * Cannot remove a member whose role is higher than yours.
        * Removal is implemented as ``is_active = False`` (soft).

    Side effects (POST):
        Bulk creates ``ProjectMember`` + ``ProjectUserProperty`` rows
        and enqueues ``project_add_user_email`` Celery tasks via
        RabbitMQ (worker module
        :mod:`plane.bgtasks.project_add_user_email_task`).

    Queryset filter logic:
        Scoped to ``workspace.slug == kwargs["slug"]``,
        ``project_id == kwargs["project_id"]``, and
        ``member.is_bot=False`` (system service accounts are excluded
        from human-readable rosters). ``project``, ``member``,
        ``workspace``, and ``workspace.owner`` are eager-loaded.

    Cross-references:
        * Serializers: ``ProjectMemberAdminSerializer``,
          ``ProjectMemberRoleSerializer`` in
          ``apps/api/plane/app/serializers/project.py``.
        * Models: ``ProjectMember``, ``ProjectUserProperty``,
          ``WorkspaceMember`` in
          ``apps/api/plane/db/models/project.py`` and
          ``apps/api/plane/db/models/workspace.py``.
        * Permissions: ``ProjectBasePermission`` in
          ``apps/api/plane/app/permissions/project.py``;
          ``allow_permission`` decorator in
          ``apps/api/plane/app/permissions/base.py``.
        * Celery task:
          ``apps/api/plane/bgtasks/project_add_user_email_task.py``
          (queued via RabbitMQ).
        * URL registration:
          ``apps/api/plane/app/urls/project.py``.
    """

    serializer_class = ProjectMemberAdminSerializer
    model = ProjectMember

    search_fields = ["member__display_name", "member__first_name"]

    def get_queryset(self):
        """Return active non-bot members of the workspace+project with project, member, and workspace eager-loaded."""
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(member__is_bot=False)
            .filter()
            .select_related("project")
            .select_related("member")
            .select_related("workspace", "workspace__owner")
        )

    @allow_permission([ROLE.ADMIN])
    def create(self, request, slug, project_id):
        """Bulk add or reactivate project members; enqueues ``project_add_user_email`` Celery tasks (RabbitMQ).

        Workspace role consistency is enforced upfront: a workspace
        ``Admin`` cannot be added as ``Member`` / ``Guest`` and a
        workspace ``Guest`` cannot be added as ``Member`` / ``Admin``.
        Existing ``ProjectMember`` rows for the supplied member ids are
        reactivated and re-roled in bulk; new rows are bulk inserted
        with a fresh :class:`ProjectUserProperty` per member.
        """
        # Get the list of members to be added to the project and their roles i.e. the user_id and the role
        members = request.data.get("members", [])

        # get the project
        project = Project.objects.get(pk=project_id, workspace__slug=slug)

        # Check if the members array is empty
        if not len(members):
            return Response(
                {"error": "At least one member is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Initialize the bulk arrays
        bulk_project_members = []
        bulk_issue_props = []

        # Create a dictionary of the member_id and their roles
        member_roles = {member.get("member_id"): member.get("role") for member in members}

        # check the workspace role of the new user
        for member in member_roles:
            workspace_member_role = WorkspaceMember.objects.get(
                workspace__slug=slug, member=member, is_active=True
            ).role
            if workspace_member_role in [20] and member_roles.get(member) in [5, 15]:
                return Response(
                    {"error": "You cannot add a user with role lower than the workspace role"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if workspace_member_role in [5] and member_roles.get(member) in [15, 20]:
                return Response(
                    {"error": "You cannot add a user with role higher than the workspace role"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Update roles in the members array based on the member_roles dictionary and set is_active to True
        for project_member in ProjectMember.objects.filter(
            project_id=project_id,
            member_id__in=[member.get("member_id") for member in members],
        ):
            project_member.role = member_roles[str(project_member.member_id)]
            project_member.is_active = True
            bulk_project_members.append(project_member)

        # Update the roles of the existing members
        ProjectMember.objects.bulk_update(bulk_project_members, ["is_active", "role"], batch_size=100)

        # Get the minimum sort_order for each member in the workspace
        member_sort_orders = (
            ProjectUserProperty.objects.filter(
                workspace__slug=slug,
                user_id__in=[member.get("member_id") for member in members],
            )
            .values("user_id")
            .annotate(min_sort_order=Min("sort_order"))
        )
        # Convert to dictionary for easy lookup: {user_id: min_sort_order}
        sort_order_map = {str(item["user_id"]): item["min_sort_order"] for item in member_sort_orders}

        # Loop through requested members
        for member in members:
            member_id = str(member.get("member_id"))
            # Get the minimum sort_order for this member, or use default
            min_sort_order = sort_order_map.get(member_id)
            # Create a new project member
            bulk_project_members.append(
                ProjectMember(
                    member_id=member.get("member_id"),
                    role=member.get("role", 5),
                    project_id=project_id,
                    workspace_id=project.workspace_id,
                )
            )
            # Create a new issue property
            bulk_issue_props.append(
                ProjectUserProperty(
                    user_id=member.get("member_id"),
                    project_id=project_id,
                    workspace_id=project.workspace_id,
                    sort_order=(min_sort_order - 10000 if min_sort_order is not None else 65535),
                )
            )

        # Bulk create the project members and issue properties
        project_members = ProjectMember.objects.bulk_create(bulk_project_members, batch_size=10, ignore_conflicts=True)

        _ = ProjectUserProperty.objects.bulk_create(bulk_issue_props, batch_size=10, ignore_conflicts=True)

        project_members = ProjectMember.objects.filter(
            project_id=project_id,
            member_id__in=[member.get("member_id") for member in members],
        )
        # Send emails to notify the users
        [
            project_add_user_email.delay(
                base_host(request=request, is_app=True),
                project_member.id,
                request.user.id,
            )
            for project_member in project_members
        ]
        # Serialize the project members
        serializer = ProjectMemberRoleSerializer(project_members, many=True)
        # Return the serialized data
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def list(self, request, slug, project_id):
        """List active non-bot project members; serializer is restricted to ``id``, ``member``, ``role`` fields."""
        # Get the list of project members for the project
        project_members = ProjectMember.objects.filter(
            project_id=project_id,
            workspace__slug=slug,
            member__is_bot=False,
            is_active=True,
            member__member_workspace__workspace__slug=slug,
            member__member_workspace__is_active=True,
        ).select_related("project", "member", "workspace")

        serializer = ProjectMemberRoleSerializer(project_members, fields=("id", "member", "role"), many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def retrieve(self, request, slug, project_id, pk):
        """Return a single project member; uses the admin serializer when the requester's role exceeds ``Guest``."""
        requesting_project_member = ProjectMember.objects.get(
            project_id=project_id,
            workspace__slug=slug,
            member=request.user,
            is_active=True,
        )

        project_member = (
            ProjectMember.objects.filter(
                pk=pk,
                project_id=project_id,
                workspace__slug=slug,
                member__is_bot=False,
                is_active=True,
            )
            .select_related("project", "member", "workspace")
            .first()
        )

        if not project_member:
            return Response(
                {"error": "Project member not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        if requesting_project_member.role > ROLE.GUEST.value:
            serializer = ProjectMemberAdminSerializer(project_member)
        else:
            serializer = ProjectMemberRoleSerializer(project_member, fields=("id", "member", "role"))

        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def partial_update(self, request, slug, project_id, pk):
        """Partial update of a project membership with strict role-hierarchy enforcement (see class docstring)."""
        project_member = ProjectMember.objects.get(pk=pk, workspace__slug=slug, project_id=project_id, is_active=True)

        # Fetch the target's workspace role (used to cap the new project role)
        target_workspace_role = WorkspaceMember.objects.get(
            workspace__slug=slug, member=project_member.member, is_active=True
        ).role
        # Fetch the requester's workspace role to decide if they may bypass project-role checks
        requester_workspace_role = WorkspaceMember.objects.get(
            workspace__slug=slug, member=request.user, is_active=True
        ).role
        is_workspace_admin = requester_workspace_role == ROLE.ADMIN.value

        # Check if the user is not editing their own role if they are not an admin
        if request.user.id == project_member.member_id and not is_workspace_admin:
            return Response(
                {"error": "You cannot update your own role"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Check while updating user roles
        requested_project_member = ProjectMember.objects.get(
            project_id=project_id,
            workspace__slug=slug,
            member=request.user,
            is_active=True,
        )

        if "role" in request.data:
            # Only Admins can modify roles
            if requested_project_member.role < ROLE.ADMIN.value and not is_workspace_admin:
                return Response(
                    {"error": "You do not have permission to update roles"},
                    status=status.HTTP_403_FORBIDDEN,
                )

            # Cannot modify a member whose role is equal to or higher than your own
            if project_member.role >= requested_project_member.role and not is_workspace_admin:
                return Response(
                    {"error": "You cannot update the role of a member with a role equal to or higher than your own"},
                    status=status.HTTP_403_FORBIDDEN,
                )

            new_role = int(request.data.get("role"))

            # Cannot assign a role equal to or higher than your own
            if new_role >= requested_project_member.role and not is_workspace_admin:
                return Response(
                    {"error": "You cannot assign a role equal to or higher than your own"},
                    status=status.HTTP_403_FORBIDDEN,
                )

            # Cannot assign a role higher than the target's workspace role
            if target_workspace_role in [5] and new_role in [15, 20]:
                return Response(
                    {"error": "You cannot add a user with role higher than the workspace role"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        serializer = ProjectMemberSerializer(project_member, data=request.data, partial=True)

        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission([ROLE.ADMIN])
    def destroy(self, request, slug, project_id, pk):
        """Soft-deactivate (``is_active=False``) a project member; cannot remove self or a higher-role member."""
        project_member = ProjectMember.objects.get(
            workspace__slug=slug,
            project_id=project_id,
            pk=pk,
            member__is_bot=False,
            is_active=True,
        )
        # check requesting user role
        requesting_project_member = ProjectMember.objects.get(
            workspace__slug=slug,
            member=request.user,
            project_id=project_id,
            is_active=True,
        )
        # User cannot remove himself
        if str(project_member.id) == str(requesting_project_member.id):
            return Response(
                {"error": "You cannot remove yourself from the workspace. Please use leave workspace"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # User cannot deactivate higher role
        if requesting_project_member.role < project_member.role:
            return Response(
                {"error": "You cannot remove a user having role higher than you"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        project_member.is_active = False
        project_member.save()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def leave(self, request, slug, project_id):
        """Soft-deactivate the requester's project membership (self-leave); sole-admin guard blocks abandonment."""
        project_member = ProjectMember.objects.get(
            workspace__slug=slug,
            project_id=project_id,
            member=request.user,
            is_active=True,
        )

        # Check if the leaving user is the only admin of the project
        if (
            project_member.role == 20
            and not ProjectMember.objects.filter(
                workspace__slug=slug, project_id=project_id, role=20, is_active=True
            ).count()
            > 1
        ):
            return Response(
                {
                    "error": "You cannot leave the project as your the only admin of the project you will have to either delete the project or create an another admin"  # noqa: E501
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Deactivate the user
        project_member.is_active = False
        project_member.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectMemberUserEndpoint(BaseAPIView):
    """Return the requesting user's own active membership row for a project.

    HTTP methods + URL patterns:
        GET /api/workspaces/<slug>/projects/<project_id>/project-members/me/

    Request body:
        None (GET only).

    Response shape:
        :class:`plane.app.serializers.ProjectMemberSerializer` output
        for the single active membership row keyed by
        ``(workspace.slug, project_id, member=request.user,
        is_active=True)``.

    Permissions:
        Inherits :class:`plane.app.views.base.BaseAPIView` default of
        ``[IsAuthenticated]``. Used by the web client to render
        project-context UI without requiring elevated permissions.

    Cross-references:
        * Serializer: ``ProjectMemberSerializer`` in
          ``apps/api/plane/app/serializers/project.py``.
        * Model: ``ProjectMember`` in
          ``apps/api/plane/db/models/project.py``.
        * URL registration:
          ``apps/api/plane/app/urls/project.py``.
    """

    def get(self, request, slug, project_id):
        """Return the requesting user's active :class:`ProjectMember` row for the workspace+project."""
        project_member = ProjectMember.objects.get(
            project_id=project_id,
            workspace__slug=slug,
            member=request.user,
            is_active=True,
        )
        serializer = ProjectMemberSerializer(project_member)

        return Response(serializer.data, status=status.HTTP_200_OK)


class UserProjectRolesEndpoint(BaseAPIView):
    """Workspace-wide ``{project_id: role}`` mapping for the requesting user.

    HTTP methods + URL patterns:
        GET /api/users/me/workspaces/<slug>/project-roles/

    Request body:
        None (GET only).

    Response shape:
        ``dict[str, int]`` mapping each project UUID (string) to the
        requesting user's integer role in that project. Role values:
        ``Admin=20``, ``Member=15``, ``Guest=5``.

    Permissions:
        ``permission_classes = [WorkspaceUserPermission]`` (declared on
        the class attribute; see
        ``apps/api/plane/app/views/project/member.py``) -- the
        requesting user must have an active workspace membership;
        per-project permissions are unnecessary because the response
        only enumerates the requester's own roles.

    Read replica:
        use_read_replica = True -- this endpoint is read-heavy and is
        polled by the web client on workspace switch, so it is routed
        through the read replica to offload the primary.

    Cross-references:
        * Model: ``ProjectMember`` in
          ``apps/api/plane/db/models/project.py``.
        * Permissions: ``WorkspaceUserPermission`` in
          ``apps/api/plane/app/permissions/workspace.py``.
        * URL registration:
          ``apps/api/plane/app/urls/project.py``.
    """

    permission_classes = [WorkspaceUserPermission]
    use_read_replica = True

    def get(self, request, slug):
        """Return ``{project_id: role}`` for every project in which the requesting user has an active membership."""
        project_members = ProjectMember.objects.filter(
            workspace__slug=slug,
            member_id=request.user.id,
            is_active=True,
            member__member_workspace__workspace__slug=slug,
            member__member_workspace__is_active=True,
        ).values("project_id", "role")

        project_members = {str(member["project_id"]): member["role"] for member in project_members}
        return Response(project_members, status=status.HTTP_200_OK)


class ProjectMemberPreferenceEndpoint(BaseAPIView):
    """Read / update the JSON ``preferences`` blob on a specific project membership row.

    HTTP methods + URL patterns:
        GET   /api/workspaces/<slug>/projects/<project_id>/preferences/member/<member_id>/
        PATCH /api/workspaces/<slug>/projects/<project_id>/preferences/member/<member_id>/

    Request body (PATCH):
        Any JSON object. The payload is merged into
        :attr:`ProjectMember.preferences` via
        :meth:`ProjectMemberPreferenceSerializer.validate_preferences`,
        which calls ``existing.update(value)`` so unspecified keys are
        retained.

    Response shape (GET):
        :class:`plane.app.serializers.ProjectMemberPreferenceSerializer`
        output (``preferences``, ``project_id``, ``member_id``,
        ``workspace_id``).

    Response shape (PATCH):
        ``{"preferences": <merged-blob>}`` on success.

    Permissions:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])``
        on both ``get`` and ``patch`` -- any active project member
        may inspect or modify their own (or another member's)
        preferences row.
    """

    def get_queryset(self, slug, project_id, member_id):
        """Return the :class:`ProjectMember` row keyed by ``(slug, project_id, member_id)`` (raises if missing)."""
        return ProjectMember.objects.get(
            project_id=project_id,
            member_id=member_id,
            workspace__slug=slug,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def patch(self, request, slug, project_id, member_id):
        """Merge the request body into ``ProjectMember.preferences`` (existing keys are retained on partial update)."""
        project_member = self.get_queryset(slug, project_id, member_id)

        serializer = ProjectMemberPreferenceSerializer(project_member, {"preferences": request.data}, partial=True)

        if serializer.is_valid():
            serializer.save()

            return Response({"preferences": serializer.data["preferences"]}, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, member_id):
        """Return the serialized ``preferences`` payload for the target ``ProjectMember`` row."""
        project_member = self.get_queryset(slug, project_id, member_id)

        serializer = ProjectMemberPreferenceSerializer(project_member)

        return Response(serializer.data, status=status.HTTP_200_OK)
