# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Project-scoped DRF authorization classes.

Defines the five ``BasePermission`` subclasses that gate routes under
``/api/workspaces/<slug>/projects/<project_id>/...``. Every class consumes
``view.workspace_slug`` and ``view.project_id`` from the URL kwargs, and
some additionally consume ``view.project_identifier`` for human-readable
identifier lookups.

Each class issues at most two membership queries against
:class:`plane.db.models.ProjectMember` (project-scoped role check) and
:class:`plane.db.models.WorkspaceMember` (workspace-admin fallback). Role
values reference ``ROLE.ADMIN.value`` (20) and ``ROLE.MEMBER.value`` (15)
imported from :mod:`plane.db.models.project`.

Workspace-admin fallback (applies to :class:`ProjectBasePermission` only in
this module): a workspace administrator who is also an active member of the
project is granted access even if their ``ProjectMember.role`` does not
match the required role. This fallback is intentional and documented; do not
remove it without auditing every consuming ViewSet.

Permission decisions are stateless: each request re-runs the membership
queries against the database with no in-process caching.
"""

# Third Party imports
from rest_framework.permissions import SAFE_METHODS, BasePermission

# Module import
from plane.db.models import ProjectMember, WorkspaceMember
from plane.db.models.project import ROLE


class ProjectBasePermission(BasePermission):
    """Gate project routes with combined workspace + project membership checks.

    Access rules (consumes ``view.workspace_slug`` and ``view.project_id``):

    * Anonymous users: denied.
    * ``SAFE_METHODS`` (``GET`` / ``HEAD`` / ``OPTIONS``): allowed for any
      active workspace member (downstream filtering lives in the view
      queryset).
    * ``POST``: requires active workspace ``Admin`` or ``Member`` role
      (project creation is a workspace-level action).
    * Other unsafe methods: require ``ProjectMember`` with
      ``role == ROLE.ADMIN`` OR (any active project membership AND active
      workspace ``Admin`` role -- the workspace-admin fallback).
    """

    def has_permission(self, request, view):
        """Return ``True`` if the user satisfies the project + workspace role rule for ``request.method``."""
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
    """Gate project-member routes with explicit member or admin role on the project.

    Access rules (consumes ``view.workspace_slug`` and ``view.project_id``):

    * Anonymous users: denied.
    * ``SAFE_METHODS``: allowed for any active project member of the
      workspace (project membership, not workspace-level).
    * ``POST``: requires active workspace ``Admin`` or ``Member`` role.
    * Other unsafe methods: require ``ProjectMember.role`` in
      ``[ROLE.ADMIN, ROLE.MEMBER]`` on the target project.
    """

    def has_permission(self, request, view):
        """Return ``True`` if the user is an active project member with the role required by ``request.method``."""
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
    """Gate entity routes inside a project; allow members for safe methods, admins / members for writes.

    This is the most-applied permission class on entity-level routes such as
    issues, links, cycles, modules, and pages. ViewSet docstrings that cite
    ``permission_classes = [ProjectEntityPermission]`` rely on this contract.

    Access rules (consumes ``view.workspace_slug`` and ``view.project_id``;
    optionally ``view.project_identifier`` when the route accepts a
    human-readable identifier instead of a UUID):

    * Anonymous users: denied.
    * ``SAFE_METHODS`` on a route exposing ``view.project_identifier``:
      allowed if the user is an active ``ProjectMember`` of the project
      identified by the supplied ``project__identifier``.
    * ``SAFE_METHODS`` on a standard route: allowed if the user is an
      active ``ProjectMember`` of ``view.project_id`` in the workspace
      identified by ``view.workspace_slug``.
    * Unsafe methods (``POST`` / ``PUT`` / ``PATCH`` / ``DELETE``):
      require active ``ProjectMember.role`` in
      ``[ROLE.ADMIN, ROLE.MEMBER]`` on ``view.project_id``.

    Note: unlike :class:`ProjectBasePermission`, this class does NOT include
    the workspace-admin fallback; project access is granted only via direct
    ``ProjectMember`` rows.
    """

    def has_permission(self, request, view):
        """Return ``True`` for safe methods on any project member, unsafe methods on admins / members only."""
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
    """Restrict access to active project admins regardless of HTTP method.

    Consumes ``view.workspace_slug`` and ``view.project_id``. Anonymous users
    are denied. Only ``ProjectMember`` rows with ``role == ROLE.ADMIN`` on
    the target project pass. There is NO workspace-admin fallback -- a
    workspace administrator who is not a project admin is denied.
    """

    def has_permission(self, request, view):
        """Return ``True`` if the requesting user is an active admin of the project."""
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
    """Allow any authenticated user with active project membership regardless of role.

    Consumes ``view.workspace_slug`` and ``view.project_id``. Anonymous
    users are denied. Used on read-only or low-privilege endpoints where
    role granularity is not required.
    """

    def has_permission(self, request, view):
        """Return ``True`` if the requesting user has any active membership in the project."""
        if request.user.is_anonymous:
            return False

        return ProjectMember.objects.filter(
            workspace__slug=view.workspace_slug,
            member=request.user,
            project_id=view.project_id,
            is_active=True,
        ).exists()
