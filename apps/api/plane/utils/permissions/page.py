# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Page-scoped DRF permission helper for Plane's project pages API.

This module exposes ``ProjectPagePermission``, a ``BasePermission`` subclass
used by the page ViewSets to gate access by project membership role, page
ownership, and page visibility (public versus private). The module also
declares the local integer aliases ``ADMIN``, ``MEMBER``, and ``GUEST``
derived from ``plane.app.permissions.ROLE`` so the method/role policy matrix
below can compare against raw role values without re-reading the enum on
every call.

Decisions are computed per request from ``view.kwargs`` (``slug``,
``project_id``, ``page_id``) plus live ORM lookups against ``ProjectMember``
and ``Page``. Because the ``migrator`` container runs Django migrations
before any API service starts, the project membership and page tables are
guaranteed to exist when this module is imported by the WSGI/ASGI workers.
"""

from plane.db.models import ProjectMember, Page
from plane.app.permissions import ROLE


from rest_framework.permissions import BasePermission, SAFE_METHODS


# Permission Mappings for workspace members
ADMIN = ROLE.ADMIN.value
MEMBER = ROLE.MEMBER.value
GUEST = ROLE.GUEST.value


class ProjectPagePermission(BasePermission):
    """Control access to pages within a workspace.

    Authorizes requests based on user roles, page visibility
    (public/private), and feature flags.
    """

    def has_permission(self, request, view):
        """Check basic project-level permissions before object-level checks."""
        if request.user.is_anonymous:
            return False

        user_id = request.user.id
        slug = view.kwargs.get("slug")
        page_id = view.kwargs.get("page_id")
        project_id = view.kwargs.get("project_id")

        # Hook for extended validation
        extended_access, role = self._check_access_and_get_role(request, slug, project_id)
        if extended_access is False:
            return False

        if page_id:
            page = Page.objects.get(id=page_id, workspace__slug=slug)

            # Allow access if the user is the owner of the page
            if page.owned_by_id == user_id:
                return True

            # Handle private page access
            if page.access == Page.PRIVATE_ACCESS:
                return self._has_private_page_action_access(request, slug, page, project_id)

        # Handle public page access
        return self._has_public_page_action_access(request, role)

    def _check_project_member_access(self, request, slug, project_id):
        """Check if the user is a project member."""
        return (
            ProjectMember.objects.filter(
                member=request.user,
                workspace__slug=slug,
                is_active=True,
                project_id=project_id,
            )
            .values_list("role", flat=True)
            .first()
        )

    def _check_access_and_get_role(self, request, slug, project_id):
        """Resolve the caller's project role and grant/deny access.

        Subclass hook for extended access checking. Returns the tuple
        ``(allowed, role)`` where ``allowed`` is ``True`` (allow), ``False``
        (deny), or ``None`` (continue with normal flow).
        """
        role = self._check_project_member_access(request, slug, project_id)
        if not role:
            return False, None
        return True, role

    def _has_private_page_action_access(self, request, slug, page, project_id):
        """Check access to private pages. Override for feature flag logic."""
        # Base implementation: only owner can access private pages
        return False

    def _check_project_action_access(self, request, role):
        """Resolve HTTP-method-and-role matrix for public-page access.

        Returns ``True`` when ``role`` is permitted to perform the request's
        HTTP method on a public page (POST/PUT/PATCH allowed for ADMIN and
        MEMBER, DELETE allowed for ADMIN only, SAFE_METHODS allowed for all
        active project roles), ``False`` otherwise.
        """
        method = request.method

        # Only admins can create (POST) pages
        if method == "POST":
            if role in [ADMIN, MEMBER]:
                return True
            return False

        # Safe methods (GET, HEAD, OPTIONS) allowed for all active roles
        if method in SAFE_METHODS:
            if role in [ADMIN, MEMBER, GUEST]:
                return True
            return False

        # PUT/PATCH: Admins and members can update
        if method in ["PUT", "PATCH"]:
            if role in [ADMIN, MEMBER]:
                return True
            return False

        # DELETE: Only admins can delete
        if method == "DELETE":
            if role in [ADMIN]:
                return True
            return False

        # Deny by default
        return False

    def _has_public_page_action_access(self, request, role):
        """Check if the user can access and act on a public page.

        Returns ``True`` when the caller's role permits the request's HTTP
        method on a public page (delegating the role/method matrix to
        :meth:`_check_project_action_access`), ``False`` otherwise.
        """
        project_member_exists = self._check_project_action_access(request, role)
        if not project_member_exists:
            return False
        return True
