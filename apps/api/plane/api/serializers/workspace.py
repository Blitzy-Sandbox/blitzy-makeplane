# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""Lightweight workspace serializer for the ``/api/v1/`` API surface.

Embedded by sibling serializers in :mod:`plane.api.serializers` via the
``?expand=workspace`` mechanism wired in
:class:`plane.api.serializers.base.BaseSerializer`. All fields are read-only
because the API never accepts workspace data through this serializer — it
is purely a read projection used to attach ``{id, slug, name}`` to enclosing
records.
"""

# Module imports
from plane.db.models import Workspace
from .base import BaseSerializer


class WorkspaceLiteSerializer(BaseSerializer):
    """
    Lightweight workspace serializer for minimal data transfer.

    Provides essential workspace identifiers including name, slug, and ID
    optimized for navigation, references, and performance-critical operations.
    """

    class Meta:
        """DRF metadata: serialize ``Workspace`` exposing read-only ``id``, ``slug``, and ``name``."""

        model = Workspace
        fields = ["name", "slug", "id"]
        read_only_fields = fields
