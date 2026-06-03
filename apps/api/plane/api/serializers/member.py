# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""Project-member serializer for the ``/api/v1/`` API surface.

Used by :mod:`plane.api.views.member`. Resolves the candidate ``User`` from
the workspace member roster (via slug-based context) and restricts the role
to the trio of ``ROLE.ADMIN``, ``ROLE.MEMBER``, ``ROLE.GUEST`` exposed by
:mod:`plane.utils.permissions`.
"""

# Third party imports
from rest_framework import serializers

# Module imports
from plane.db.models import ProjectMember, WorkspaceMember
from .base import BaseSerializer
from plane.db.models import User
from plane.utils.permissions import ROLE


class ProjectMemberSerializer(BaseSerializer):
    """Read/write representation of a ``ProjectMember`` for the ``/api/v1/`` API.

    The ``member`` field accepts a User UUID and is validated against the
    workspace roster identified by the ``slug`` context key (so cross-workspace
    user IDs cannot leak into a project). ``id`` is read-only; ``role`` is
    constrained to ``ROLE.ADMIN`` / ``ROLE.MEMBER`` / ``ROLE.GUEST``.
    """

    member = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(),
        required=True,
    )

    def validate_member(self, value):
        """Confirm the candidate user is an active member of the workspace identified by the ``slug`` context key."""
        slug = self.context.get("slug")
        if not slug:
            raise serializers.ValidationError("Slug is required", code="INVALID_SLUG")
        if not value:
            raise serializers.ValidationError("Member is required", code="INVALID_MEMBER")
        if not WorkspaceMember.objects.filter(workspace__slug=slug, member=value).exists():
            raise serializers.ValidationError("Member not found in workspace", code="INVALID_MEMBER")
        return value

    def validate_role(self, value):
        """Restrict the role to ``ROLE.ADMIN``, ``ROLE.MEMBER``, or ``ROLE.GUEST``."""
        if value not in [ROLE.ADMIN.value, ROLE.MEMBER.value, ROLE.GUEST.value]:
            raise serializers.ValidationError("Invalid role", code="INVALID_ROLE")
        return value

    class Meta:
        """DRF metadata: serialize ``ProjectMember`` exposing id, member, and role with id as read-only."""

        model = ProjectMember
        fields = ["id", "member", "role"]
        read_only_fields = ["id"]
