# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for the ``State`` model in the ``plane.space`` public API.

Defines two projections of the workflow-state model used by published deploy
boards (``api/public/``):

* :class:`StateSerializer` -- full ``State`` payload with ``workspace`` and
  ``project`` write-protected; re-exported from the
  :mod:`plane.space.serializer` package barrel and embedded as the
  ``state_detail`` nested serializer inside :class:`IssueSerializer` and
  :class:`IssueCreateSerializer` in :mod:`plane.space.serializer.issue`.
* :class:`StateLiteSerializer` -- compact ``(id, name, color, group)``
  projection with every field read-only; embedded as ``state_detail`` inside
  :class:`IssueStateFlatSerializer` (:mod:`plane.space.serializer.issue`) and
  :class:`IssueStateIntakeSerializer` (:mod:`plane.space.serializer.intake`).

The lite variant exists to avoid N+1 over-fetching when state identity needs
to be inlined into list responses on the anonymous public surface: it
deliberately omits sequence, default-flag, group ordering, and other
workflow metadata that nested call-sites do not render.
"""

# Module imports
from .base import BaseSerializer
from plane.db.models import State


class StateSerializer(BaseSerializer):
    """Full ``State`` payload with ``workspace`` and ``project`` write-protected.

    Serializes :class:`plane.db.models.State` with the entire field surface
    (``fields = "__all__"``) for callers that need the complete workflow-state
    record -- name, color, group, sequence, default flag, description, and
    audit fields. The ``workspace`` and ``project`` foreign keys are
    ``read_only_fields`` because state ownership is scoped by the URL path on
    the published deploy board (resolved server-side from the board anchor),
    never by the request body; accepting either field from input would let an
    anonymous caller rebind a state to a different project.

    Consumers:
        * Re-exported from the :mod:`plane.space.serializer` package barrel
          so downstream code can import it from the package namespace.
        * Embedded as ``state_detail`` (read-only nested serializer) inside
          :class:`plane.space.serializer.issue.IssueSerializer` and
          :class:`plane.space.serializer.issue.IssueCreateSerializer` to
          inline the full workflow-state metadata on every issue payload
          served by the public deploy-board API.
        * Lives alongside the state-listing view in
          :mod:`plane.space.views.state`, which serves anonymous traffic
          mounted under ``api/public/`` for published projects.
    """

    class Meta:
        """DRF :class:`ModelSerializer` binding to :class:`State` with workspace/project write-protected."""

        model = State
        fields = "__all__"
        read_only_fields = ["workspace", "project"]


class StateLiteSerializer(BaseSerializer):
    """Compact ``State`` projection (``id``, ``name``, ``color``, ``group``) for nested payloads.

    Serializes :class:`plane.db.models.State` with a deliberately narrow,
    fully read-only field set (``read_only_fields = fields``) so it can be
    safely inlined inside other serializers without exposing additional
    workflow metadata or accepting writes through the nested path.

    Fields exposed (all read-only):
        * ``id`` -- stable key for client-side state de-duplication and
          React list keying.
        * ``name`` -- human-readable label rendered in issue rows and
          status pills.
        * ``color`` -- hex color string used to tint state badges.
        * ``group`` -- workflow group bucket (e.g. backlog / unstarted /
          started / completed / cancelled) used for cross-board grouping
          and filtering.

    Fields intentionally NOT exposed: ``sequence``, ``default``, workflow
    transitions, description, audit timestamps, and the ``workspace`` /
    ``project`` foreign keys -- these are not rendered by nested call-sites
    and shipping them per row would cause unnecessary payload bloat (and an
    N+1 read amplification) on published-board issue list responses.

    Consumers:
        * Embedded as ``state_detail`` inside
          :class:`plane.space.serializer.issue.IssueStateFlatSerializer` to
          inline state identity in parent-issue summaries.
        * Embedded as ``state_detail`` inside
          :class:`plane.space.serializer.intake.IssueStateIntakeSerializer`
          to inline state identity on intake-issue listings.
    """

    class Meta:
        """DRF :class:`ModelSerializer` binding the lite ``State`` projection; every listed field is read-only."""

        model = State
        fields = ["id", "name", "color", "group"]
        read_only_fields = fields
