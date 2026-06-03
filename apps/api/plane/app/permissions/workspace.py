# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace-scoped DRF authorization classes.

Defines the six ``BasePermission`` subclasses that gate routes under
``/api/workspaces/<slug>/...``. Every class consumes ``view.workspace_slug``
and queries :class:`plane.db.models.WorkspaceMember` to resolve the
requesting user's role for that workspace.

Role values mirror the membership rows persisted in
``WorkspaceMember.role``:

* ``Admin`` (20) -- full administrative authority on the workspace.
* ``Member`` (15) -- read / write on most resources, no administrative
  destruction.
* ``Guest`` (5) -- read-only on the resources the workspace explicitly
  exposes.

Permission decisions are stateless: each request re-runs the membership
query. Do not add in-process caching without updating consumers that rely on
role changes taking effect on the next request.
"""

# Third Party imports
from rest_framework.permissions import BasePermission, SAFE_METHODS

# Module imports
from plane.db.models import WorkspaceMember


# Permission Mappings
Admin = 20
Member = 15
Guest = 5


# TODO: Move the below logic to python match - python v3.10
class WorkSpaceBasePermission(BasePermission):
    """Authorize broad workspace endpoints with method-based role rules.

    Access rules (consumes ``view.workspace_slug``):

    * Anonymous users: denied.
    * ``POST`` (workspace creation): allowed for any authenticated user.
    * ``SAFE_METHODS`` (``GET`` / ``HEAD`` / ``OPTIONS``): allowed for any
      authenticated user (downstream filtering lives in the view's queryset).
    * ``PUT`` / ``PATCH``: require active ``Admin`` or ``Member`` membership
      in the workspace.
    * ``DELETE``: require active ``Admin`` membership in the workspace.
    """

    def has_permission(self, request, view):
        """Return ``True`` if the user is allowed to act on the workspace by HTTP method and role."""
        # allow anyone to create a workspace
        if request.user.is_anonymous:
            return False

        if request.method == "POST":
            return True

        ## Safe Methods
        if request.method in SAFE_METHODS:
            return True

        # allow only admins and owners to update the workspace settings
        if request.method in ["PUT", "PATCH"]:
            return WorkspaceMember.objects.filter(
                member=request.user,
                workspace__slug=view.workspace_slug,
                role__in=[Admin, Member],
                is_active=True,
            ).exists()

        # allow only owner to delete the workspace
        if request.method == "DELETE":
            return WorkspaceMember.objects.filter(
                member=request.user,
                workspace__slug=view.workspace_slug,
                role=Admin,
                is_active=True,
            ).exists()


class WorkspaceOwnerPermission(BasePermission):
    """Restrict access to active workspace admins regardless of HTTP method.

    Consumes ``view.workspace_slug`` and matches ``WorkspaceMember`` rows
    where ``role == Admin`` for the requesting user. Anonymous users are
    denied.
    """

    def has_permission(self, request, view):
        """Return ``True`` if the requesting user is an active admin of the workspace."""
        if request.user.is_anonymous:
            return False

        return WorkspaceMember.objects.filter(
            workspace__slug=view.workspace_slug, member=request.user, role=Admin
        ).exists()


class WorkSpaceAdminPermission(BasePermission):
    """Allow active workspace admins and members (excludes guests).

    Consumes ``view.workspace_slug`` and matches active ``WorkspaceMember``
    rows where ``role`` is in ``[Admin, Member]``. Anonymous users are
    denied. Despite the name, both admins and members satisfy this rule;
    use :class:`WorkspaceOwnerPermission` for admin-only routes.
    """

    def has_permission(self, request, view):
        """Return ``True`` if the requesting user is an active admin or member of the workspace."""
        if request.user.is_anonymous:
            return False

        return WorkspaceMember.objects.filter(
            member=request.user,
            workspace__slug=view.workspace_slug,
            role__in=[Admin, Member],
            is_active=True,
        ).exists()


class WorkspaceEntityPermission(BasePermission):
    """Split safe and unsafe methods between any member and admins/members.

    Consumes ``view.workspace_slug``. Anonymous users are denied. ``SAFE_METHODS``
    (``GET`` / ``HEAD`` / ``OPTIONS``) are allowed for any active workspace
    member; unsafe methods require active ``Admin`` or ``Member`` membership.
    """

    def has_permission(self, request, view):
        """Return ``True`` for safe methods on any member, unsafe methods on admins / members only."""
        if request.user.is_anonymous:
            return False

        ## Safe Methods -> Handle the filtering logic in queryset
        if request.method in SAFE_METHODS:
            return WorkspaceMember.objects.filter(
                workspace__slug=view.workspace_slug, member=request.user, is_active=True
            ).exists()

        return WorkspaceMember.objects.filter(
            member=request.user,
            workspace__slug=view.workspace_slug,
            role__in=[Admin, Member],
            is_active=True,
        ).exists()


class WorkspaceViewerPermission(BasePermission):
    """Allow any authenticated user with active workspace membership.

    Consumes ``view.workspace_slug``. Role is not constrained -- admins,
    members, and guests all pass. Anonymous users are denied.
    """

    def has_permission(self, request, view):
        """Return ``True`` if the requesting user has any active membership in the workspace."""
        if request.user.is_anonymous:
            return False

        return WorkspaceMember.objects.filter(
            member=request.user, workspace__slug=view.workspace_slug, is_active=True
        ).exists()


class WorkspaceUserPermission(BasePermission):
    """Allow any authenticated user with active workspace membership.

    Synonym of :class:`WorkspaceViewerPermission`; preserved for naming
    parity with view-side import sites. Consumes ``view.workspace_slug``.
    """

    def has_permission(self, request, view):
        """Return ``True`` if the requesting user has any active membership in the workspace."""
        if request.user.is_anonymous:
            return False

        return WorkspaceMember.objects.filter(
            member=request.user, workspace__slug=view.workspace_slug, is_active=True
        ).exists()
