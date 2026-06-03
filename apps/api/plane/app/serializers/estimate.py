# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for project estimates and their estimation points.

An ``Estimate`` is a labeled scale (e.g., t-shirt sizes, Fibonacci) attached
to a project. Each estimate owns a small ordered set of ``EstimatePoint``
rows that enumerate the values on that scale; tickets reference a single
point when sized. ``workspace`` and ``project`` are derived from the URL
context for every write surface here, so they are always declared
read-only on the underlying ``Meta`` blocks.
"""

# Module imports
from .base import BaseSerializer

from plane.db.models import Estimate, EstimatePoint

from rest_framework import serializers


class EstimateSerializer(BaseSerializer):
    """Write/read serializer for the ``Estimate`` scale model.

    The ``workspace`` and ``project`` fields are set from the URL context
    by the owning view and are declared read-only here so a payload
    cannot relocate an estimate to a different parent.
    """

    class Meta:
        """DRF metaclass binding ``Estimate`` with ``workspace``/``project`` as read-only."""

        model = Estimate
        fields = "__all__"
        read_only_fields = ["workspace", "project"]


class EstimatePointSerializer(BaseSerializer):
    """Write/read serializer for ``EstimatePoint`` rows belonging to an ``Estimate``.

    The parent ``estimate`` as well as the ambient ``workspace`` and
    ``project`` are resolved from the URL context by the owning view and
    are declared read-only so a payload cannot reparent an estimate point.
    """

    def validate(self, data):
        """Reject empty payloads and any ``value`` longer than 20 characters.

        The 20-character ceiling guards against unbounded UI labels and is
        kept in sync with the ``EstimatePoint.value`` ``max_length`` on the
        underlying model.
        """
        if not data:
            raise serializers.ValidationError("Estimate points are required")
        value = data.get("value")
        if value and len(value) > 20:
            raise serializers.ValidationError("Value can't be more than 20 characters")
        return data

    class Meta:
        """DRF metaclass binding ``EstimatePoint`` with parent fields read-only."""

        model = EstimatePoint
        fields = "__all__"
        read_only_fields = ["estimate", "workspace", "project"]


class EstimateReadSerializer(BaseSerializer):
    """Read-only ``Estimate`` view that nests its associated ``EstimatePoint`` rows.

    ``points`` is provided by the reverse ``Estimate.points`` related
    manager and serialized via :class:`EstimatePointSerializer`. The
    ``points``, ``name``, and ``description`` fields are declared read-only
    because this serializer is purely informational; writes go through
    :class:`EstimateSerializer` (and :class:`EstimatePointSerializer` for
    individual points).
    """

    points = EstimatePointSerializer(read_only=True, many=True)

    class Meta:
        """DRF metaclass binding ``Estimate`` with the read-only nested ``points`` payload."""

        model = Estimate
        fields = "__all__"
        read_only_fields = ["points", "name", "description"]


class WorkspaceEstimateSerializer(BaseSerializer):
    """Workspace-scoped read view of ``Estimate`` with nested ``points``.

    Mirrors :class:`EstimateReadSerializer` but is used by aggregate
    workspace queries that surface every estimate across all projects in
    the workspace in a single response.
    """

    points = EstimatePointSerializer(read_only=True, many=True)

    class Meta:
        """DRF metaclass binding ``Estimate`` for the workspace-wide aggregate view."""

        model = Estimate
        fields = "__all__"
        read_only_fields = ["points", "name", "description"]
