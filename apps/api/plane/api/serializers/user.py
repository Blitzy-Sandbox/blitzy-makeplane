# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""Lightweight user serializer for the ``/api/v1/`` API surface.

Embedded by sibling serializers in :mod:`plane.api.serializers` (assignees,
project / workspace members, comment actors, audit fields like
``created_by`` / ``updated_by``) and by the expansion mechanism in
:class:`plane.api.serializers.base.BaseSerializer`. All fields are read-only
because the API never accepts user data through this serializer — it is
purely a read projection.
"""

from rest_framework import serializers

# Module imports
from plane.db.models import User

from .base import BaseSerializer


class UserLiteSerializer(BaseSerializer):
    """
    Lightweight user serializer for minimal data transfer.

    Provides essential user information including names, avatar, and contact details
    optimized for member lists, assignee displays, and user references.
    """

    avatar_url = serializers.CharField(
        help_text="Avatar URL",
        read_only=True,
    )

    class Meta:
        """DRF metadata: serialize ``User`` exposing read-only id, names, email, avatar, and display_name."""

        model = User
        fields = [
            "id",
            "first_name",
            "last_name",
            "email",
            "avatar",
            "avatar_url",
            "display_name",
            "email",
        ]
        read_only_fields = fields
