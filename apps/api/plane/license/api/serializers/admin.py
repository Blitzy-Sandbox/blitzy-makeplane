# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Admin-facing serializers for the current admin profile and admin-membership rows.

Defines ``InstanceAdminMeSerializer`` (the signed-in admin's user
profile for ``GET /me``-style endpoints) and ``InstanceAdminSerializer``
(the ``InstanceAdmin`` membership row tying a :class:`User` to the
deployment :class:`Instance`).
"""

# Module imports
from .base import BaseSerializer
from plane.db.models import User
from plane.app.serializers import UserAdminLiteSerializer
from plane.license.models import InstanceAdmin


class InstanceAdminMeSerializer(BaseSerializer):
    """Current-admin profile serializer for the signed-in user.

    Bound model: :class:`plane.db.models.User` (NOT ``InstanceAdmin``) —
    this surface represents the user record of the currently authenticated
    admin, not the admin-membership row.

    Fields enumerated explicitly: ``id``, ``avatar``, ``avatar_url``,
    ``cover_image``, ``date_joined``, ``display_name``, ``email``,
    ``first_name``, ``last_name``, ``is_active``, ``is_bot``,
    ``is_email_verified``, ``user_timezone``, ``username``, and
    ``is_password_autoset``. All fields are read-only
    (``read_only_fields = fields``) because this serializer powers a
    read-only "GET /me" surface, not profile editing.
    """

    class Meta:
        model = User
        fields = [
            "id",
            "avatar",
            "avatar_url",
            "cover_image",
            "date_joined",
            "display_name",
            "email",
            "first_name",
            "last_name",
            "is_active",
            "is_bot",
            "is_email_verified",
            "user_timezone",
            "username",
            "is_password_autoset",
            "is_email_verified",
        ]
        read_only_fields = fields


class InstanceAdminSerializer(BaseSerializer):
    """``InstanceAdmin`` membership row serializer with nested user details.

    Bound model: :class:`plane.license.models.InstanceAdmin` — represents
    a ``User`` ↔ ``Instance`` admin-membership relationship rather than a
    user profile.

    Fields: ``"__all__"``. Read-only fields: ``id``, ``instance``,
    ``user`` — these are server-assigned at admin-creation time and must
    not be rebound through client payloads.

    Nested fields:
        - ``user_detail``: ``UserAdminLiteSerializer`` over the ``user``
          relation (read-only) — surfaces full admin user details inline
          on list and detail responses.
    """

    user_detail = UserAdminLiteSerializer(source="user", read_only=True)

    class Meta:
        model = InstanceAdmin
        fields = "__all__"
        read_only_fields = ["id", "instance", "user"]
