# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Lightweight ``User`` serializer for nested license payloads.

Defines ``UserLiteSerializer`` — a compact, read-oriented representation
intended for nesting inside other license serializers when full user
data would be excessive or could leak sensitive fields.
"""

from .base import BaseSerializer
from plane.db.models import User


class UserLiteSerializer(BaseSerializer):
    """Compact ``User`` representation safe to embed in nested payloads.

    Bound model: :class:`plane.db.models.User`.
    Exposes only ``id``, ``email``, ``first_name``, and ``last_name`` —
    kept intentionally minimal so password hashes, MFA secrets, and other
    sensitive account fields cannot be leaked through transitive nesting.

    Consumed within this package by :class:`WorkspaceSerializer` for the
    ``owner`` field; not re-exported from :mod:`__init__` because it is
    an internal building block rather than a public API surface.
    """

    class Meta:
        """DRF ``Meta`` binding to :class:`User` projecting only safe nested-payload fields.

        The field list is deliberately minimal -- ``id``, ``email``,
        ``first_name``, ``last_name`` -- to keep transitive nesting from
        exposing password hashes, MFA secrets, or other sensitive
        account state.
        """

        model = User
        fields = ["id", "email", "first_name", "last_name"]
