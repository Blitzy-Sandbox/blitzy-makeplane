# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Top-level :class:`Instance` serializer for license API payloads.

Defines ``InstanceSerializer`` — the full representation of the license
``Instance`` singleton, enriched with a compact nested ``primary_owner``
user summary.
"""

# Module imports
from plane.license.models import Instance
from plane.app.serializers import BaseSerializer
from plane.app.serializers import UserAdminLiteSerializer


class InstanceSerializer(BaseSerializer):
    """Full ``Instance`` serializer with nested primary-owner details.

    Bound model: :class:`plane.license.models.Instance` — the singleton
    row identifying this Plane deployment.

    Fields: ``"__all__"`` — every column on the ``Instance`` model is
    serialized. The following are marked ``read_only`` because they are
    populated by server-side flows rather than client input:

    - ``id`` — UUID PK assigned at row creation.
    - ``email`` — set during instance registration; not mutated via API.
    - ``last_checked_at`` — updated by background telemetry, not clients.
    - ``is_setup_done`` — flipped by the bootstrap endpoint, not direct PATCH.

    Nested fields:
        - ``primary_owner_details``: ``UserAdminLiteSerializer`` over the
          ``primary_owner`` relation (read-only). Surfaces the bootstrap
          admin user as a compact nested summary on every payload.

    Extends :class:`plane.app.serializers.BaseSerializer` (the app-level
    base), not the sibling ``.base.BaseSerializer`` used elsewhere in
    this package.
    """

    primary_owner_details = UserAdminLiteSerializer(source="primary_owner", read_only=True)

    class Meta:
        """DRF binding to the ``Instance`` model with all columns exposed."""

        model = Instance
        fields = "__all__"
        read_only_fields = ["id", "email", "last_checked_at", "is_setup_done"]
