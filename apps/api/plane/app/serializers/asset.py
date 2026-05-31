# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializer for the ``FileAsset`` model — the storage-side representation of every uploaded file.

``FileAsset`` is shared across the codebase (project covers, workspace
logos, user avatars, issue attachments, page covers, page logos, comment
attachments) — the same row stores object-storage metadata regardless of
the consuming entity, discriminated only by ``entity_type``. The serializer
therefore deliberately exposes ``__all__`` so callers can read any field
they need; per-entity views constrain the surface they actually expose to
the client.

Most asset workflows do not write through this serializer at all — the
upload path is presigned-POST, executed end-to-end in
:mod:`plane.app.views.asset` and :mod:`plane.app.views.asset.v2` (see
tech spec §5.2.9). This serializer is used where the row itself needs to
round-trip through DRF (lookups, listings, admin/debug surfaces).

Cross-references:
    * Model: :class:`plane.db.models.FileAsset`
      (``apps/api/plane/db/models/asset.py``).
    * Presigned-POST upload workflow: ``apps/api/plane/app/views/asset/``
      and ``views/asset/v2.py``.
"""

from .base import BaseSerializer
from plane.db.models import FileAsset


class FileAssetSerializer(BaseSerializer):
    """Read/write serializer for :class:`~plane.db.models.FileAsset` rows.

    Stores object-storage references and metadata for every uploaded file in
    the Plane backend. The ``created_by``, ``updated_by``, ``created_at``,
    and ``updated_at`` columns are declared read-only because they are
    server-managed audit fields populated automatically by the ``BaseModel``
    / ``BaseSerializer`` machinery and must not be set by API clients.

    This is a thin wrapper — there are no custom ``validate_*`` methods, no
    ``to_representation`` override, and no computed fields. The
    presigned-POST upload contract that drives nearly all asset writes
    lives in the ``views/asset/`` viewset layer (see tech spec §5.2.9),
    not here.
    """

    class Meta:
        """DRF metaclass binding :class:`~plane.db.models.FileAsset` with audit columns declared read-only."""

        model = FileAsset
        fields = "__all__"
        read_only_fields = ["created_by", "updated_by", "created_at", "updated_at"]
