# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""Workspace-invite serializer for the ``/api/v1/`` API surface.

Used by :mod:`plane.api.views.invite`. Validates invite payloads
(email, role) and rejects duplicate pending invites within the same
workspace slug. The set of accepted roles is sourced from
:class:`plane.app.permissions.base.ROLE`.
"""

# Django imports
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from rest_framework import serializers

# Module imports
from plane.db.models import WorkspaceMemberInvite
from .base import BaseSerializer
from plane.app.permissions.base import ROLE


class WorkspaceInviteSerializer(BaseSerializer):
    """Read/write representation of a ``WorkspaceMemberInvite`` for the ``/api/v1/`` API.

    Accepted role values are restricted to ``ROLE.ADMIN``, ``ROLE.MEMBER``,
    and ``ROLE.GUEST``. ``workspace`` is read-only and set by the ViewSet from
    the URL's slug; ``responded_at`` and ``accepted`` are read-only because
    they are mutated when the invitee acts on the invite, not when it is
    created.
    """

    class Meta:
        """DRF metadata: serialize ``WorkspaceMemberInvite`` with workspace and acceptance columns as read-only."""

        model = WorkspaceMemberInvite
        fields = [
            "id",
            "email",
            "role",
            "created_at",
            "updated_at",
            "responded_at",
            "accepted",
        ]
        read_only_fields = [
            "id",
            "workspace",
            "created_at",
            "updated_at",
            "responded_at",
            "accepted",
        ]

    def validate_email(self, value):
        """Reject malformed addresses via Django's ``validate_email`` validator."""
        try:
            validate_email(value)
        except ValidationError:
            raise serializers.ValidationError("Invalid email address", code="INVALID_EMAIL_ADDRESS")
        return value

    def validate_role(self, value):
        """Restrict the role to ``ROLE.ADMIN``, ``ROLE.MEMBER``, or ``ROLE.GUEST``."""
        if value not in [ROLE.ADMIN.value, ROLE.MEMBER.value, ROLE.GUEST.value]:
            raise serializers.ValidationError("Invalid role", code="INVALID_WORKSPACE_MEMBER_ROLE")
        return value

    def validate(self, data):
        """Reject duplicate pending invites for the same ``(email, workspace.slug)`` pair."""
        slug = self.context["slug"]
        if (
            data.get("email")
            and WorkspaceMemberInvite.objects.filter(email=data["email"], workspace__slug=slug).exists()
        ):
            raise serializers.ValidationError("Email already invited", code="EMAIL_ALREADY_INVITED")
        return data
