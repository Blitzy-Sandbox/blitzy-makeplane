# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Shared role enum and decorator-based permission helper for ``plane.app``.

This is the foundational module of :mod:`plane.app.permissions`. It exposes
the cross-package role vocabulary (:class:`ROLE`) used by every other
permission module and a reusable :func:`allow_permission` decorator factory
that can be applied to individual DRF view callables when class-based
``permission_classes`` is too coarse.

Architectural notes:

* The package is **stateless at runtime** -- every decision is recomputed
  from fresh DB lookups against :class:`plane.db.models.WorkspaceMember` and
  :class:`plane.db.models.ProjectMember`. Do not introduce in-process
  caching without updating callers that rely on role changes taking effect
  on the next request.
* Database role values mirror the integer values of :class:`ROLE`
  (``ADMIN = 20``, ``MEMBER = 15``, ``GUEST = 5``) and are stored in the
  ``role`` columns of the membership tables; the migrator container runs
  Django migrations before API services start, so these values are already
  persisted when this module is imported at boot.
"""

from plane.db.models import WorkspaceMember, ProjectMember
from functools import wraps
from rest_framework.response import Response
from rest_framework import status

from enum import Enum


class ROLE(Enum):
    """Membership role enum shared across workspace, project, and page permissions.

    Members and their integer values (these values are persisted in
    ``WorkspaceMember.role`` and ``ProjectMember.role`` and are referenced
    by raw integer in :mod:`plane.app.permissions.workspace`):

    * ``ADMIN = 20`` -- full administrative authority within the scope.
    * ``MEMBER = 15`` -- read / write on most resources, no destructive
      administrative actions.
    * ``GUEST = 5`` -- read-only on the resources the scope explicitly
      exposes.

    The numeric values are intentional and stable; do not renumber without a
    data migration on every membership table that stores ``role``.
    """

    ADMIN = 20
    MEMBER = 15
    GUEST = 5


def allow_permission(allowed_roles, level="PROJECT", creator=False, model=None):
    """Build a DRF view decorator that enforces role-based access for a single endpoint.

    Wraps a DRF view callable and admits the request iff the requesting user
    holds one of ``allowed_roles`` (or, when ``creator`` is set, owns the
    target object). When access is denied the decorator returns a DRF
    ``Response`` with HTTP 403 and a body of
    ``{"error": "You don't have the required permissions."}``; the wrapped
    view is never invoked.

    Args:
        allowed_roles: Iterable of :class:`ROLE` members (or raw integer
            values) that pass the role check. Enum members are converted to
            their integer ``.value`` before comparison.
        level: ``"PROJECT"`` (default) routes the role check against
            :class:`plane.db.models.ProjectMember` (using
            ``kwargs["slug"]`` and ``kwargs["project_id"]``);
            ``"WORKSPACE"`` routes against
            :class:`plane.db.models.WorkspaceMember` (using
            ``kwargs["slug"]`` only).
        creator: If ``True``, the requesting user is granted access when
            they created the target object identified by ``kwargs["pk"]``
            on ``model``, regardless of role. Requires a workspace
            membership row to exist before the creator shortcut is honored.
        model: Django model class used for the creator shortcut. Only
            consulted when ``creator`` is ``True``; ignored otherwise.

    Returns:
        Callable: A view decorator that delegates to ``view_func`` on
        success and returns a 403 ``Response`` on failure.

    Workspace-admin fallback: For ``level="PROJECT"`` checks, a user who
    fails the role match is still admitted when they hold an active
    workspace ``ADMIN`` membership AND any active ``ProjectMember`` row for
    the target project. This mirrors the implicit project access that
    workspace admins enjoy through class-based permissions such as
    :class:`plane.app.permissions.project.ProjectBasePermission`.
    """
    def decorator(view_func):
        @wraps(view_func)
        def _wrapped_view(instance, request, *args, **kwargs):
            # Check for creator if required
            if creator and model:
                # check if the user is part of the workspace or not
                if not WorkspaceMember.objects.filter(
                    member=request.user,
                    workspace__slug=kwargs["slug"],
                    is_active=True,
                ).exists():
                    return Response(
                        {"error": "You don't have the required permissions."},
                        status=status.HTTP_403_FORBIDDEN,
                    )

                obj = model.objects.filter(id=kwargs["pk"], created_by=request.user).exists()
                if obj:
                    return view_func(instance, request, *args, **kwargs)

            # Convert allowed_roles to their values if they are enum members
            allowed_role_values = [role.value if isinstance(role, ROLE) else role for role in allowed_roles]

            # Check role permissions
            if level == "WORKSPACE":
                if WorkspaceMember.objects.filter(
                    member=request.user,
                    workspace__slug=kwargs["slug"],
                    role__in=allowed_role_values,
                    is_active=True,
                ).exists():
                    return view_func(instance, request, *args, **kwargs)
            else:
                is_user_has_allowed_role = ProjectMember.objects.filter(
                    member=request.user,
                    workspace__slug=kwargs["slug"],
                    project_id=kwargs["project_id"],
                    role__in=allowed_role_values,
                    is_active=True,
                ).exists()

                # Return if the user has the allowed role else if they are workspace admin and part of the project regardless of the role # noqa: E501
                if is_user_has_allowed_role:
                    return view_func(instance, request, *args, **kwargs)
                elif (
                    ProjectMember.objects.filter(
                        member=request.user,
                        workspace__slug=kwargs["slug"],
                        project_id=kwargs["project_id"],
                        is_active=True,
                    ).exists()
                    and WorkspaceMember.objects.filter(
                        member=request.user,
                        workspace__slug=kwargs["slug"],
                        role=ROLE.ADMIN.value,
                        is_active=True,
                    ).exists()
                ):
                    return view_func(instance, request, *args, **kwargs)

            # Return permission denied if no conditions are met
            return Response(
                {"error": "You don't have the required permissions."},
                status=status.HTTP_403_FORBIDDEN,
            )

        return _wrapped_view

    return decorator
