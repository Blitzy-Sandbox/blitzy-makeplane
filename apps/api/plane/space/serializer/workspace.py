# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Compact ``Workspace`` projection for the ``plane.space`` public API.

Defines :class:`WorkspaceLiteSerializer`, a minimal ``(id, name, slug)`` shape
used by nested fields on published-board issue and comment payloads. The
narrow field selection is a deliberate security boundary: published deploy
boards mounted under ``api/public/`` (see :mod:`plane.urls`) serve anonymous
traffic, so workspace internals (logo, member counts, billing/plan status,
integration tokens) MUST NOT leak through this projection.
"""

# Module imports
from .base import BaseSerializer
from plane.db.models import Workspace


class WorkspaceLiteSerializer(BaseSerializer):
    """Minimal read-only ``Workspace`` projection: ``(id, name, slug)``.

    Serializes :class:`plane.db.models.Workspace` down to the three identity
    fields that are safe to surface on the anonymous ``api/public/`` read
    surface. ``id`` supports client-side keying of nested workspace records,
    ``name`` is the human display label, and ``slug`` is the URL component
    already exposed by the public route path itself (so re-exposing it in the
    payload introduces no new disclosure).

    Fields exposed (all read-only via ``read_only_fields = fields``):
        - ``id`` -- primary key, used for client-side keying.
        - ``name`` -- workspace display name shown alongside the issue or
          comment.
        - ``slug`` -- URL slug; already part of the public route path.

    Fields intentionally NOT exposed: ``logo`` / ``logo_asset``, member
    counts, billing/plan info, owner, integration credentials, and every
    other column on :class:`plane.db.models.Workspace`. These are private
    workspace internals that must not leak to anonymous traffic; future
    contributors must not "improve" this serializer by widening the field
    list without re-evaluating the security posture of the
    ``api/public/`` surface.

    Consumers:
        - :class:`plane.space.serializer.issue.LabelSerializer` -- nested as
          ``workspace_detail`` on label payloads
          (``issue.py``, line 51).
        - :class:`plane.space.serializer.issue.IssueCommentSerializer` --
          nested as ``workspace_detail`` on comment payloads
          (``issue.py``, line 223).
        - :class:`plane.space.serializer.issue.IssueCreateSerializer` --
          nested as ``workspace_detail`` on issue payloads
          (``issue.py``, line 247).
    """

    class Meta:
        """DRF serializer configuration binding to :class:`Workspace` with a fully read-only field allowlist."""

        model = Workspace
        fields = ["name", "slug", "id"]
        read_only_fields = fields
