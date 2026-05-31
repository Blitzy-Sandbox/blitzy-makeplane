# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Project invitation flow endpoints (invite, list, accept, join).

Exposes three DRF views:

* :class:`ProjectInvitationsViewset` -- admin-facing CRUD over
  :class:`plane.db.models.ProjectMemberInvite`. ``POST`` validates each
  email, signs a JWT invitation token with ``settings.SECRET_KEY``, bulk
  creates invite rows, and enqueues invitation email tasks (Celery via
  RabbitMQ, NOT Redis -- Redis is caching/session only per the
  architectural context).
* :class:`UserProjectInvitationsViewset` -- invited-user-facing list of
  pending invitations and bulk project join. ``POST`` activates or
  creates :class:`plane.db.models.ProjectMember` rows after enforcing
  that secret-network projects can only be joined by workspace admins.
* :class:`ProjectJoinEndpoint` -- public ``AllowAny`` invite-link landing
  endpoint. ``POST`` validates the supplied email matches the invite,
  records the acceptance/rejection, and (on accept) ensures both
  ``WorkspaceMember`` and ``ProjectMember`` rows exist for the user.

Role values (from :class:`plane.app.permissions.base.ROLE`):
``Admin=20``, ``Member=15``, ``Guest=5``. Network values (from
:class:`plane.db.models.project.ProjectNetwork`): ``SECRET=0``,
``PUBLIC=2``.
"""

# Python imports
import jwt
from datetime import datetime

# Django imports
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.conf import settings
from django.utils import timezone

# Third Party imports
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny

# Module imports
from .base import BaseViewSet, BaseAPIView
from plane.app.serializers import ProjectMemberInviteSerializer
from plane.app.permissions import allow_permission, ROLE
from plane.db.models import (
    ProjectMember,
    Workspace,
    ProjectMemberInvite,
    User,
    WorkspaceMember,
    Project,
    ProjectUserProperty,
)
from plane.db.models.project import ProjectNetwork
from plane.utils.host import base_host


class ProjectInvitationsViewset(BaseViewSet):
    """Admin-facing CRUD for project member invitations.

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<project_id>/invitations/
        POST   /api/workspaces/<slug>/projects/<project_id>/invitations/
        GET    /api/workspaces/<slug>/projects/<project_id>/invitations/<pk>/
        DELETE /api/workspaces/<slug>/projects/<project_id>/invitations/<pk>/

    Request body (POST):
        emails (list[dict], required): Each item is
            ``{"email": str, "role": int}`` where ``role`` is one of
            ``Admin=20``, ``Member=15``, ``Guest=5`` and defaults to
            ``5`` (Guest) when omitted.

    Response shape:
        :class:`plane.app.serializers.ProjectMemberInviteSerializer`
        output (``id``, ``project``, ``workspace``, ``email``, ``role``,
        ``token``, ``accepted``, ``responded_at``, ``message``,
        ``created_at``, ``created_by``).

    Permissions:
        :class:`plane.app.permissions.ProjectBasePermission` (the default
        for project-scoped viewsets) plus
        ``@allow_permission([ROLE.ADMIN])`` on ``create`` -- only project
        admins may invite new members.

    Side effects (POST):
        * Bulk creates :class:`ProjectMemberInvite` rows with JWT tokens
          (HS256-signed with ``settings.SECRET_KEY``).
        * Enqueues invitation email tasks (Celery via RabbitMQ); the
          worker module is :mod:`plane.bgtasks.project_invitation_task`.

    Queryset filter logic:
        Scoped to ``workspace.slug == kwargs["slug"]`` and
        ``project_id == kwargs["project_id"]``, with related
        ``project``, ``workspace``, and ``workspace.owner`` selected
        eagerly.
    """

    serializer_class = ProjectMemberInviteSerializer
    model = ProjectMemberInvite

    search_fields = []

    def get_queryset(self):
        """Return the workspace + project scoped invitation queryset with project and workspace eager-loaded."""
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .select_related("project")
            .select_related("workspace", "workspace__owner")
        )

    @allow_permission([ROLE.ADMIN])
    def create(self, request, slug, project_id):
        """Bulk create project member invitations and enqueue invitation email tasks (Celery via RabbitMQ).

        Each invitation row carries an HS256 JWT token signed with
        ``settings.SECRET_KEY``. Workspace role consistency is enforced
        upfront: a workspace ``Guest`` cannot be invited as ``Member`` /
        ``Admin``, and a workspace ``Admin`` cannot be invited as a
        lesser role.
        """
        emails = request.data.get("emails", [])

        # Check if email is provided
        if not emails:
            return Response({"error": "Emails are required"}, status=status.HTTP_400_BAD_REQUEST)

        for email in emails:
            workspace_role = WorkspaceMember.objects.filter(
                workspace__slug=slug, member__email=email.get("email"), is_active=True
            ).role

            if workspace_role in [5, 20] and workspace_role != email.get("role", 5):
                return Response({"error": "You cannot invite a user with different role than workspace role"})

        workspace = Workspace.objects.get(slug=slug)

        project_invitations = []
        for email in emails:
            try:
                validate_email(email.get("email"))
                project_invitations.append(
                    ProjectMemberInvite(
                        email=email.get("email").strip().lower(),
                        project_id=project_id,
                        workspace_id=workspace.id,
                        token=jwt.encode(
                            {"email": email, "timestamp": datetime.now().timestamp()},
                            settings.SECRET_KEY,
                            algorithm="HS256",
                        ),
                        role=email.get("role", 5),
                        created_by=request.user,
                    )
                )
            except ValidationError:
                return Response(
                    {
                        "error": f"Invalid email - {email} provided a valid email address is required to send the invite"  # noqa: E501
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Create workspace member invite
        project_invitations = ProjectMemberInvite.objects.bulk_create(
            project_invitations, batch_size=10, ignore_conflicts=True
        )
        current_site = base_host(request=request, is_app=True)

        # Send invitations
        for invitation in project_invitations:
            project_invitations.delay(
                invitation.email,
                project_id,
                invitation.token,
                current_site,
                request.user.email,
            )

        return Response({"message": "Email sent successfully"}, status=status.HTTP_200_OK)


class UserProjectInvitationsViewset(BaseViewSet):
    """Invited-user facing pending invitations + bulk project join.

    HTTP methods + URL patterns:
        GET    /api/users/me/workspaces/<slug>/projects/invitations/
        POST   /api/users/me/workspaces/<slug>/projects/invitations/

    Request body (POST):
        project_ids (list[UUID], required): IDs of workspace projects
            the requesting user wishes to join in bulk.

    Response shape:
        ``{"message": "Projects joined successfully"}`` with HTTP 201
        on success.

    Permissions:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")``
        on ``create`` -- only active workspace members or admins may
        bulk-join projects. Projects with
        ``network == ProjectNetwork.SECRET`` (0) additionally require
        the requester to be a workspace admin.

    Side effects (POST):
        * Reactivates existing :class:`ProjectMember` rows for the
          requesting user across all supplied ``project_ids``.
        * Bulk creates new :class:`ProjectMember` rows (with the
          requester's workspace role) and matching
          :class:`ProjectUserProperty` rows where membership did not
          previously exist.

    Queryset filter logic:
        Scoped to ``email == request.user.email``, with ``workspace``,
        ``workspace.owner``, and ``project`` eager-loaded.
    """

    serializer_class = ProjectMemberInviteSerializer
    model = ProjectMemberInvite

    def get_queryset(self):
        """Return invitations addressed to ``request.user.email`` with workspace and project eager-loaded."""
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(email=self.request.user.email)
            .select_related("workspace", "workspace__owner", "project")
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def create(self, request, slug):
        """Bulk join the requesting user to ``project_ids`` (reactivating existing memberships, creating new ones).

        Secret-network projects (``ProjectNetwork.SECRET == 0``) are
        joinable only by workspace admins; for those the workspace role
        is propagated to the new project membership.
        """
        project_ids = request.data.get("project_ids", [])

        # Get the workspace user role
        workspace_member = WorkspaceMember.objects.get(member=request.user, workspace__slug=slug, is_active=True)

        # Get all the projects
        projects = Project.objects.filter(id__in=project_ids, workspace__slug=slug).only("id", "network")
        # Check if user has permission to join each project
        for project in projects:
            if project.network == ProjectNetwork.SECRET.value and workspace_member.role != ROLE.ADMIN.value:
                return Response(
                    {"error": "Only workspace admins can join private project"},
                    status=status.HTTP_403_FORBIDDEN,
                )

        workspace_role = workspace_member.role
        workspace = workspace_member.workspace

        # If the user was already part of workspace
        _ = ProjectMember.objects.filter(workspace__slug=slug, project_id__in=project_ids, member=request.user).update(
            is_active=True
        )

        ProjectMember.objects.bulk_create(
            [
                ProjectMember(
                    project_id=project_id,
                    member=request.user,
                    role=workspace_role,
                    workspace=workspace,
                    created_by=request.user,
                )
                for project_id in project_ids
            ],
            ignore_conflicts=True,
        )

        ProjectUserProperty.objects.bulk_create(
            [
                ProjectUserProperty(
                    project_id=project_id,
                    user=request.user,
                    workspace=workspace,
                    created_by=request.user,
                )
                for project_id in project_ids
            ],
            ignore_conflicts=True,
        )

        return Response({"message": "Projects joined successfully"}, status=status.HTTP_201_CREATED)


class ProjectJoinEndpoint(BaseAPIView):
    """Public invite-link landing endpoint (accept / reject / inspect).

    HTTP methods + URL patterns:
        POST   /api/workspaces/<slug>/projects/<project_id>/join/<pk>/
        GET    /api/workspaces/<slug>/projects/<project_id>/join/<pk>/

    Request body (POST):
        email (str, required): Must match
            ``ProjectMemberInvite.email`` for the invitation identified
            by ``pk``.
        accepted (bool, required): ``True`` to accept the invitation
            and create / reactivate workspace + project membership;
            ``False`` to record a rejection.

    Response shape:
        POST: ``{"message": str}`` with HTTP 200 (accepted, rejected,
        or already-responded). GET:
        :class:`plane.app.serializers.ProjectMemberInviteSerializer`
        output.

    Permissions:
        permission_classes = [AllowAny] -- the invite link must be
        openable without a prior session. The supplied ``email`` is
        the integrity check that gates acceptance.

    Side effects (POST, on accept):
        * Stamps ``responded_at`` and ``accepted`` on the
          :class:`ProjectMemberInvite` row.
        * Creates or reactivates a :class:`WorkspaceMember` row
          (capped at ``Member=15`` even if invite role is higher).
        * Creates or reactivates a :class:`ProjectMember` row carrying
          the invitation's role.
    """

    permission_classes = [AllowAny]

    def post(self, request, slug, project_id, pk):
        """Accept or reject a project invitation.

        On accept, create / reactivate the workspace and project
        membership rows for the user identified by the supplied email.
        """
        project_invite = ProjectMemberInvite.objects.get(pk=pk, project_id=project_id, workspace__slug=slug)

        email = request.data.get("email", "")

        if email == "" or project_invite.email != email:
            return Response(
                {"error": "You do not have permission to join the project"},
                status=status.HTTP_403_FORBIDDEN,
            )

        if project_invite.responded_at is None:
            project_invite.accepted = request.data.get("accepted", False)
            project_invite.responded_at = timezone.now()
            project_invite.save()

            if project_invite.accepted:
                # Check if the user account exists
                user = User.objects.filter(email=email).first()

                # Check if user is a part of workspace
                workspace_member = WorkspaceMember.objects.filter(workspace__slug=slug, member=user).first()
                # Add him to workspace
                if workspace_member is None:
                    _ = WorkspaceMember.objects.create(
                        workspace_id=project_invite.workspace_id,
                        member=user,
                        role=(15 if project_invite.role >= 15 else project_invite.role),
                    )
                else:
                    # Else make him active
                    workspace_member.is_active = True
                    workspace_member.save()

                # Check if the user was already a member of project then activate the user
                project_member = ProjectMember.objects.filter(
                    workspace_id=project_invite.workspace_id, member=user
                ).first()
                if project_member is None:
                    # Create a Project Member
                    _ = ProjectMember.objects.create(
                        project_id=project_id,
                        member=user,
                        role=project_invite.role,
                    )
                else:
                    project_member.is_active = True
                    project_member.role = project_member.role
                    project_member.save()

                return Response(
                    {"message": "Project Invitation Accepted"},
                    status=status.HTTP_200_OK,
                )

            return Response(
                {"message": "Project Invitation was not accepted"},
                status=status.HTTP_200_OK,
            )

        return Response(
            {"error": "You have already responded to the invitation request"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    def get(self, request, slug, project_id, pk):
        """Return the serialized :class:`ProjectMemberInvite` identified by ``pk`` for the given workspace + project."""
        project_invitation = ProjectMemberInvite.objects.get(workspace__slug=slug, project_id=project_id, pk=pk)
        serializer = ProjectMemberInviteSerializer(project_invitation)
        return Response(serializer.data, status=status.HTTP_200_OK)
