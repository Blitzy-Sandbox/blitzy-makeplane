# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Shared role enum and permission decorator for Plane's DRF endpoints.

This module is the foundational layer of ``plane.utils.permissions`` and
defines two reusable primitives: the ``ROLE`` enum that normalizes
ADMIN/MEMBER/GUEST role comparisons across the codebase, and
``allow_permission``, a decorator factory used to declaratively gate DRF
view methods by workspace or project membership and role.

The decorator computes access on every request from ``request.user``,
``kwargs['slug']``, optionally ``kwargs['project_id']``, and ``kwargs['pk']``
combined with live ORM lookups against ``WorkspaceMember`` and
``ProjectMember``. The ``migrator`` container runs Django migrations
before any API service starts, so those membership tables are guaranteed
to exist at module import time.
"""

from plane.db.models import WorkspaceMember, ProjectMember
from functools import wraps
from rest_framework.response import Response
from rest_framework import status

from enum import Enum


class ROLE(Enum):
    """Canonical workspace/project role enum used by the permission decorator.

    Members carry the integer role values stored in ``WorkspaceMember.role``
    and ``ProjectMember.role`` columns: ``ADMIN = 20``, ``MEMBER = 15``,
    ``GUEST = 5``. Higher integer values denote higher privilege.
    """

    ADMIN = 20
    MEMBER = 15
    GUEST = 5


def allow_permission(allowed_roles, level="PROJECT", creator=False, model=None):
    """Build a DRF view-method decorator that gates access by membership role.

    ``allowed_roles`` accepts a list of ``ROLE`` enum members or raw integer
    role values; both forms are normalized internally. ``level`` selects
    between a ``WorkspaceMember`` check (``"WORKSPACE"``) and the default
    ``ProjectMember`` check (``"PROJECT"``). When ``creator=True`` and
    ``model`` is provided, the decorator first short-circuits to allow
    requests whose ``request.user`` is the ``created_by`` of the object
    identified by ``kwargs['pk']``. On the project path, a workspace-ADMIN
    user who is also an active member of the target project is allowed
    regardless of their project role. Denied requests return HTTP 403 with
    a standard error payload.
    """

    def decorator(view_func):
        """Wrap ``view_func`` with the configured role/membership policy."""

        @wraps(view_func)
        def _wrapped_view(instance, request, *args, **kwargs):
            """Run the configured role/membership policy for one DRF request."""
            # Check for creator if required
            if creator and model:
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
