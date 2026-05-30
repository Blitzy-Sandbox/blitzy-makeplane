# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Project-scoped DRF permission classes for Plane's project endpoints.

This module exposes the ``ProjectBasePermission``, ``ProjectMemberPermission``,
``ProjectEntityPermission``, ``ProjectAdminPermission``, and
``ProjectLitePermission`` classes that gate project endpoints by project
membership and workspace membership. Each class resolves access on every
request from ``view.workspace_slug`` and ``view.project_id`` (and optionally
``view.project_identifier``) combined with live lookups against
``ProjectMember`` and ``WorkspaceMember``, comparing roles against
``plane.db.models.project.ROLE`` values (``ADMIN``, ``MEMBER``, ``GUEST``).

The ``migrator`` container runs Django migrations before any API service
starts, so the ``ProjectMember`` and ``WorkspaceMember`` tables are
guaranteed to exist at module import time.
"""

# Third Party imports
from rest_framework.permissions import SAFE_METHODS, BasePermission

# Module import
from plane.db.models import ProjectMember, WorkspaceMember
from plane.db.models.project import ROLE


class ProjectBasePermission(BasePermission):
    """Combined workspace+project membership gate for project ViewSets.

    Anonymous requests are rejected. Safe methods require an active
    ``WorkspaceMember`` row. POST is restricted to workspace ADMIN and
    MEMBER. Other methods (PUT/PATCH/DELETE) require either an active
    ``ProjectMember`` with role ADMIN or an active ``ProjectMember`` of any
    role combined with a workspace-level ADMIN row for the same user.
    """

    def has_permission(self, request, view):
        """Return ``True`` when the request satisfies the project access policy."""
        if request.user.is_anonymous:
            return False

        ## Safe Methods -> Handle the filtering logic in queryset
        if request.method in SAFE_METHODS:
            return WorkspaceMember.objects.filter(
                workspace__slug=view.workspace_slug, member=request.user, is_active=True
            ).exists()

        ## Only workspace owners or admins can create the projects
        if request.method == "POST":
            return WorkspaceMember.objects.filter(
                workspace__slug=view.workspace_slug,
                member=request.user,
                role__in=[ROLE.ADMIN.value, ROLE.MEMBER.value],
                is_active=True,
            ).exists()

        project_member_qs = ProjectMember.objects.filter(
            workspace__slug=view.workspace_slug,
            member=request.user,
            project_id=view.project_id,
            is_active=True,
        )

        ## Only project admins or workspace admin who is part of the project can access

        if project_member_qs.filter(role=ROLE.ADMIN.value).exists():
            return True
        else:
            return (
                project_member_qs.exists()
                and WorkspaceMember.objects.filter(
                    member=request.user,
                    workspace__slug=view.workspace_slug,
                    role=ROLE.ADMIN.value,
                    is_active=True,
                ).exists()
            )


class ProjectMemberPermission(BasePermission):
    """Project membership gate that delegates POST authorization to workspace admins/members.

    Anonymous requests are rejected. Safe methods require any active
    ``ProjectMember`` for the user in the workspace. POST is gated by an
    active workspace-level ADMIN or MEMBER row. PUT/PATCH/DELETE require
    an active ``ProjectMember`` with role ADMIN or MEMBER for the target
    ``project_id``.
    """

    def has_permission(self, request, view):
        """Return ``True`` when the request satisfies the project member policy."""
        if request.user.is_anonymous:
            return False

        ## Safe Methods -> Handle the filtering logic in queryset
        if request.method in SAFE_METHODS:
            return ProjectMember.objects.filter(
                workspace__slug=view.workspace_slug, member=request.user, is_active=True
            ).exists()
        ## Only workspace owners or admins can create the projects
        if request.method == "POST":
            return WorkspaceMember.objects.filter(
                workspace__slug=view.workspace_slug,
                member=request.user,
                role__in=[ROLE.ADMIN.value, ROLE.MEMBER.value],
                is_active=True,
            ).exists()

        ## Only Project Admins can update project attributes
        return ProjectMember.objects.filter(
            workspace__slug=view.workspace_slug,
            member=request.user,
            role__in=[ROLE.ADMIN.value, ROLE.MEMBER.value],
            project_id=view.project_id,
            is_active=True,
        ).exists()


class ProjectEntityPermission(BasePermission):
    """Project entity gate that also supports ``project_identifier``-keyed routes.

    Anonymous requests are rejected. When ``view.project_identifier`` is
    set, safe methods are authorized by joining ``ProjectMember`` against
    ``project__identifier``. Otherwise safe methods require an active
    ``ProjectMember`` keyed by ``project_id``. Mutating methods require
    an active ``ProjectMember`` with role ADMIN or MEMBER.
    """

    def has_permission(self, request, view):
        """Return ``True`` when the request satisfies the project entity policy."""
        if request.user.is_anonymous:
            return False

        # Handle requests based on project__identifier
        if hasattr(view, "project_identifier") and view.project_identifier:
            if request.method in SAFE_METHODS:
                return ProjectMember.objects.filter(
                    workspace__slug=view.workspace_slug,
                    member=request.user,
                    project__identifier=view.project_identifier,
                    is_active=True,
                ).exists()

        ## Safe Methods -> Handle the filtering logic in queryset
        if request.method in SAFE_METHODS:
            return ProjectMember.objects.filter(
                workspace__slug=view.workspace_slug,
                member=request.user,
                project_id=view.project_id,
                is_active=True,
            ).exists()

        ## Only project members or admins can create and edit the project attributes
        return ProjectMember.objects.filter(
            workspace__slug=view.workspace_slug,
            member=request.user,
            role__in=[ROLE.ADMIN.value, ROLE.MEMBER.value],
            project_id=view.project_id,
            is_active=True,
        ).exists()


class ProjectAdminPermission(BasePermission):
    """Project ADMIN-only gate for sensitive project administration endpoints.

    Anonymous requests are rejected. All other requests require an active
    ``ProjectMember`` row for the user with role exactly equal to
    ``ROLE.ADMIN`` for the target ``project_id``.
    """

    def has_permission(self, request, view):
        """Return ``True`` when the user is an active project ADMIN."""
        if request.user.is_anonymous:
            return False

        return ProjectMember.objects.filter(
            workspace__slug=view.workspace_slug,
            member=request.user,
            role=ROLE.ADMIN.value,
            project_id=view.project_id,
            is_active=True,
        ).exists()


class ProjectLitePermission(BasePermission):
    """Loosest project gate: any active ``ProjectMember`` may proceed.

    Anonymous requests are rejected. Otherwise the request is allowed as
    long as the user has any active ``ProjectMember`` row for the target
    ``project_id`` regardless of role.
    """

    def has_permission(self, request, view):
        """Return ``True`` when the user has any active project membership."""
        if request.user.is_anonymous:
            return False

        return ProjectMember.objects.filter(
            workspace__slug=view.workspace_slug,
            member=request.user,
            project_id=view.project_id,
            is_active=True,
        ).exists()
