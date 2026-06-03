# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializer for the ``Cycle`` model in the ``plane.space`` public API.

Defines :class:`CycleBaseSerializer`, the full ``Cycle`` payload embedded
inside :class:`plane.space.serializer.issue.IssueCycleDetailSerializer`
when issues are rendered on published deploy boards. The ``plane.space``
app is mounted under ``api/public/`` (see ``apps/api/plane/urls.py``) and
serves anonymous traffic, so workspace/project ownership and audit-trail
fields are write-protected at the serializer level.
"""

# Module imports
from .base import BaseSerializer
from plane.db.models import Cycle


class CycleBaseSerializer(BaseSerializer):
    """Full ``Cycle`` payload with ownership and audit fields write-protected.

    Wraps :class:`plane.db.models.Cycle` with ``fields = "__all__"`` so every
    declared model field is exposed in responses. Six fields are read-only
    because the surface serves anonymous deploy-board traffic:

    * ``workspace`` and ``project`` -- ownership scoping is fixed by the
      deploy-board anchor in the URL path, never set from the request body.
    * ``created_by`` and ``updated_by`` -- audit user attribution is set by
      :meth:`plane.db.models.base.BaseModel.save` from the request-scoped
      user via ``crum.get_current_user``, never by the client.
    * ``created_at`` and ``updated_at`` -- timestamp bookkeeping is managed
      by :class:`plane.db.mixins.AuditModel`.

    Consumed via ``cycle_detail`` on
    :class:`plane.space.serializer.issue.IssueCycleDetailSerializer`, which
    embeds this payload as a nested projection so cycle metadata is inlined
    inside issue detail responses on published deploy boards.
    """

    class Meta:
        """DRF metadata: full ``Cycle`` payload with ownership/audit fields read-only."""

        model = Cycle
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]
