# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Page-scoped DRF authorization class.

Defines :class:`ProjectPagePermission`, the access-control rule for endpoints
under ``/api/workspaces/<slug>/projects/<project_id>/pages/`` and nested page
routes. The rule combines four facts:

* Whether the requesting user is an authenticated, active member of the project
  identified by ``slug`` and ``project_id``.
* Whether the targeted page (resolved from ``page_id``) is owned by the user.
* Whether the page is public or private (``Page.access``).
* The HTTP method on the request.

Each permission decision is recomputed from fresh DB lookups against
``ProjectMember`` and ``Page`` -- no in-process caching. Pages with
``access == Page.PRIVATE_ACCESS`` are restricted to their owner by the base
implementation; subclasses may relax this via
``_has_private_page_action_access`` to introduce feature-flag-gated sharing.
"""

from plane.db.models import ProjectMember, Page
from plane.app.permissions import ROLE


from rest_framework.permissions import BasePermission, SAFE_METHODS


# Permission Mappings for workspace members
ADMIN = ROLE.ADMIN.value
MEMBER = ROLE.MEMBER.value
GUEST = ROLE.GUEST.value


class ProjectPagePermission(BasePermission):
    """Authorize page requests by membership, ownership, page visibility, and HTTP method.

    Consumes ``view.kwargs["slug"]``, ``view.kwargs["project_id"]``, and the
    optional ``view.kwargs["page_id"]``. Anonymous users are denied. Active
    project members are routed through the method-and-role matrix below;
    private pages are restricted to their owner by default.

    Access rules:

    * The page owner (``page.owned_by_id == user.id``) is granted access
      regardless of role.
    * Public pages: safe methods (``GET``/``HEAD``/``OPTIONS``) allowed for any
      active project member (admin / member / guest); ``POST`` and
      ``PUT``/``PATCH`` require ``ADMIN`` or ``MEMBER``; ``DELETE`` requires
      ``ADMIN``.
    * Private pages: only the owner is allowed by the base implementation;
      subclasses may override ``_has_private_page_action_access`` to relax
      this under feature flags.
    """

    def has_permission(self, request, view):
        """Return ``True`` if the request satisfies project membership, ownership, and visibility rules."""
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
        """Return the requesting user's active ``ProjectMember.role`` for the project, or ``None`` if not a member."""
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
        """Return ``(allowed, role)`` after resolving project membership.

        Returns ``(True, role)`` when the user is an active project member,
        ``(False, None)`` otherwise. Subclasses may override to inject
        feature-flag-gated access decisions.
        """
        role = self._check_project_member_access(request, slug, project_id)
        if not role:
            return False, None
        return True, role

    def _has_private_page_action_access(self, request, slug, page, project_id):
        """Return ``False``; private pages are restricted to their owner in the base implementation."""
        # Base implementation: only owner can access private pages
        return False

    def _check_project_action_access(self, request, role):
        """Return ``True`` if the supplied ``role`` is allowed to perform ``request.method`` on a public page."""
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
        """Return ``True`` if the member's ``role`` is allowed to perform ``request.method`` on a public page."""
        project_member_exists = self._check_project_action_access(request, role)
        if not project_member_exists:
            return False
        return True
