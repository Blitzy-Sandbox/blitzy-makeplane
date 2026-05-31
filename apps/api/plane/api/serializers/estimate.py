# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""Estimate and estimate-point serializers for the ``/api/v1/`` API surface.

Used by :mod:`plane.api.views.estimate`. Estimates own a set of
:class:`EstimatePoint` rows representing the discrete values (e.g. story
points, T-shirt sizes) selectable on an Issue's ``estimate_point`` field.
:class:`EstimateSerializer.create` injects workspace/project context from
the view, while :class:`EstimatePointSerializer.validate` caps point values
at 20 characters.
"""

# Third party imports
from rest_framework import serializers

# Module imports
from plane.db.models import Estimate, EstimatePoint
from .base import BaseSerializer


class EstimateSerializer(BaseSerializer):
    """Read/write representation of an ``Estimate`` definition for the ``/api/v1/`` API.

    Workspace and project are read-only on the wire (injected from
    ``context`` in :meth:`create`), so callers reference the parent scope
    via URL paths rather than the request body.
    """

    class Meta:
        """DRF metadata: serialize ``Estimate`` with workspace, project, and deleted_at as read-only."""

        model = Estimate
        fields = "__all__"
        read_only_fields = ["workspace", "project", "deleted_at"]

    def create(self, validated_data):
        """Create an ``Estimate`` row, injecting ``workspace`` and ``project`` from the serializer context."""
        validated_data["workspace"] = self.context["workspace"]
        validated_data["project"] = self.context["project"]
        return super().create(validated_data)


class EstimatePointSerializer(BaseSerializer):
    """Read/write representation of an :class:`EstimatePoint` value within an :class:`Estimate`.

    ``estimate``, ``workspace``, and ``project`` are read-only — every point
    is bound to its parent estimate by the ViewSet, and the parent's scope
    is inherited automatically.
    """

    def validate(self, data):
        """Reject empty payloads and cap the ``value`` field at 20 characters."""
        if not data:
            raise serializers.ValidationError("Estimate points are required")
        value = data.get("value")
        if value and len(value) > 20:
            raise serializers.ValidationError("Value can't be more than 20 characters")
        return data

    class Meta:
        """DRF metadata: serialize ``EstimatePoint`` with estimate, workspace, and project as read-only."""

        model = EstimatePoint
        fields = "__all__"
        read_only_fields = ["estimate", "workspace", "project"]
