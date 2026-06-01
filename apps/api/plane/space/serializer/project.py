# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Compact ``Project`` projection for the ``plane.space`` public API.

Defines :class:`ProjectLiteSerializer`, a small read-only ``Project`` payload
exposing only the display-oriented fields needed by published deploy boards
(identifier, name, cover image, icon, emoji, description). This is the only
serializer in :mod:`plane.space.serializer` that is imported directly by a
``plane.space.views`` module (``views/meta.py``) for the project-by-anchor
metadata endpoint; other view modules consume serializers re-exported from
``plane.app.serializers``.
"""

# Module imports
from .base import BaseSerializer
from plane.db.models import Project


class ProjectLiteSerializer(BaseSerializer):
    """Read-only display-oriented projection of the ``Project`` model.

    Serializes :class:`plane.db.models.Project` down to the minimal field set
    needed to render the header of a published deploy board and to inline
    project identity inside nested issue/comment payloads. All fields are
    read-only (``read_only_fields = fields``) because this serializer is
    consumed exclusively by the anonymous ``api/public/`` read surface, which
    must never accept project writes nor leak workspace-internal state.

    Fields exposed (all read-only):
        - ``id``, ``identifier`` -- primary key and human-readable shortcode
          used for client-side keying and routing.
        - ``name``, ``description`` -- display copy shown on the published
          board.
        - ``cover_image``, ``icon_prop``, ``emoji`` -- visual branding for
          the board header.

    Fields intentionally NOT exposed: workspace ownership, member counts,
    integration tokens, and project-level settings. These are private
    workspace internals and must not leak through the anonymous
    ``api/public/`` read surface.

    Consumers:
        - Directly instantiated by
          :class:`plane.space.views.meta.ProjectMetaDataEndpoint` for the
          ``GET /api/public/.../meta/`` project-by-anchor endpoint.
        - Nested as the ``project_detail`` field of multiple serializers in
          :mod:`plane.space.serializer.issue` and
          :mod:`plane.space.serializer.intake` to inline project identity in
          issue and comment payloads.
    """

    class Meta:
        """DRF serializer configuration binding to :class:`Project` with a read-only field allowlist."""

        model = Project
        fields = [
            "id",
            "identifier",
            "name",
            "cover_image",
            "icon_prop",
            "emoji",
            "description",
        ]
        read_only_fields = fields
