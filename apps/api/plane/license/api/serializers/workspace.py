# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace serializer for license-admin workspace administration.

Defines ``WorkspaceSerializer``, used by license-admin endpoints to read
and create :class:`plane.db.models.Workspace` records. Enforces slug
naming rules at validation time, including reserved-word rejection and
case-insensitive uniqueness.
"""

# Third Party Imports
from rest_framework import serializers

# Module imports
from .base import BaseSerializer
from .user import UserLiteSerializer
from plane.db.models import Workspace
from plane.utils.constants import RESTRICTED_WORKSPACE_SLUGS


class WorkspaceSerializer(BaseSerializer):
    """``Workspace`` serializer with nested owner and view-annotated counters.

    Bound model: :class:`plane.db.models.Workspace`.

    Fields: ``"__all__"``. Read-only fields are ``id``, ``created_by``,
    ``updated_by``, ``created_at``, ``updated_at``, ``owner``, and
    ``logo_url`` — audit and ownership fields are server-managed and
    never accepted from client input.

    Nested / derived fields:
        - ``owner``: ``UserLiteSerializer`` (read-only) — compact summary
          of the workspace owner.
        - ``logo_url``: ``CharField`` (read-only) — resolved at the view
          layer (e.g., presigned URL composition).
        - ``total_projects`` / ``total_members``: ``IntegerField``
          (read-only) — expect ``Subquery`` annotation by the consuming
          view (see ``InstanceWorkSpaceEndpoint`` in
          :mod:`plane.license.api.views`).

    Validation:
        - :meth:`validate_slug` rejects restricted slugs and duplicate
          slugs (case-insensitive).
    """

    owner = UserLiteSerializer(read_only=True)
    logo_url = serializers.CharField(read_only=True)
    total_projects = serializers.IntegerField(read_only=True)
    total_members = serializers.IntegerField(read_only=True)

    def validate_slug(self, value):
        """Validate that the workspace slug is available and not reserved.

        Rejects values present in
        :data:`plane.utils.constants.RESTRICTED_WORKSPACE_SLUGS` (reserved
        platform paths) and any slug that already exists case-insensitively
        in the ``Workspace`` table. Raises
        :class:`rest_framework.serializers.ValidationError` with a
        human-readable message; otherwise returns the value unchanged.
        """
        # Check if the slug is restricted
        if value in RESTRICTED_WORKSPACE_SLUGS:
            raise serializers.ValidationError("Slug is not valid")
        # Check uniqueness case-insensitively
        if Workspace.objects.filter(slug__iexact=value).exists():
            raise serializers.ValidationError("Slug is already in use")
        return value

    class Meta:
        model = Workspace
        fields = "__all__"
        read_only_fields = [
            "id",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
            "owner",
            "logo_url",
        ]
