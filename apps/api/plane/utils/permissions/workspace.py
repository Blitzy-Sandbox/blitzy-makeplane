# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace-scoped DRF permission classes for Plane's workspace endpoints.

This module exposes the ``WorkSpaceBasePermission``,
``WorkspaceOwnerPermission``, ``WorkSpaceAdminPermission``,
``WorkspaceEntityPermission``, ``WorkspaceViewerPermission``, and
``WorkspaceUserPermission`` classes used by workspace ViewSets to gate
access by workspace membership and role. Each class resolves access on
every request from ``view.workspace_slug`` and the authenticated user via
``WorkspaceMember`` lookups, comparing roles against the local integer
constants ``Admin = 20``, ``Member = 15``, and ``Guest = 5`` declared
below for legacy compatibility with stored role values.

The ``migrator`` container runs Django migrations before any API service
starts, so the ``WorkspaceMember`` table is guaranteed to exist at
module import time.
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
    """Catch-all workspace gate covering creation, safe reads, and mutating methods.

    Anonymous requests are rejected. POST is always allowed so any
    authenticated user may create a new workspace. Safe methods are
    allowed unconditionally for authenticated users. PUT/PATCH require an
    active ``WorkspaceMember`` row with role ``Admin`` or ``Member``.
    DELETE requires an active ``WorkspaceMember`` row with role ``Admin``.
    """

    def has_permission(self, request, view):
        """Return ``True`` when the request matches the per-method workspace policy."""
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
    """Workspace ADMIN-only gate; rejects all non-admins regardless of method.

    Anonymous requests are rejected. The check does not filter by
    ``is_active``, so it matches the original implementation exactly.
    """

    def has_permission(self, request, view):
        """Return ``True`` when the user has a ``WorkspaceMember`` row with role ``Admin``."""
        if request.user.is_anonymous:
            return False

        return WorkspaceMember.objects.filter(
            workspace__slug=view.workspace_slug, member=request.user, role=Admin
        ).exists()


class WorkSpaceAdminPermission(BasePermission):
    """Workspace ADMIN/MEMBER gate for endpoints that exclude guests.

    Anonymous requests are rejected. All other requests require an active
    ``WorkspaceMember`` row with role ``Admin`` or ``Member``.
    """

    def has_permission(self, request, view):
        """Return ``True`` when the user is an active workspace Admin or Member."""
        if request.user.is_anonymous:
            return False

        return WorkspaceMember.objects.filter(
            member=request.user,
            workspace__slug=view.workspace_slug,
            role__in=[Admin, Member],
            is_active=True,
        ).exists()


class WorkspaceEntityPermission(BasePermission):
    """Workspace entity gate distinguishing safe reads from mutating writes.

    Anonymous requests are rejected. Safe methods require any active
    ``WorkspaceMember`` row (filtering is delegated to the queryset).
    Mutating methods require an active ``WorkspaceMember`` row with role
    ``Admin`` or ``Member``.
    """

    def has_permission(self, request, view):
        """Return ``True`` when the request satisfies the workspace entity policy."""
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
    """Loose viewer gate: any active workspace member, regardless of role.

    Anonymous requests are rejected. All other requests are allowed as long
    as the user has an active ``WorkspaceMember`` row for ``workspace_slug``.
    """

    def has_permission(self, request, view):
        """Return ``True`` when the user has any active workspace membership."""
        if request.user.is_anonymous:
            return False

        return WorkspaceMember.objects.filter(
            member=request.user, workspace__slug=view.workspace_slug, is_active=True
        ).exists()


class WorkspaceUserPermission(BasePermission):
    """Alias-shaped viewer gate identical in behavior to ``WorkspaceViewerPermission``.

    Maintained as a separate class for clearer call-site intent. Any
    active workspace member is allowed; anonymous requests are rejected.
    """

    def has_permission(self, request, view):
        """Return ``True`` when the user has any active workspace membership."""
        if request.user.is_anonymous:
            return False

        return WorkspaceMember.objects.filter(
            member=request.user, workspace__slug=view.workspace_slug, is_active=True
        ).exists()
