# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for project workflow states (e.g., Backlog, Todo, In Progress, Done).

TRIAGE states are reserved for the intake workflow and cannot be created via
``StateSerializer`` — see :mod:`plane.app.serializers.intake` for the consumer
that performs the TRIAGE → default-state transition when an intake issue is
accepted into the project.
"""

# Module imports
from .base import BaseSerializer
from rest_framework import serializers

from plane.db.models import State, StateGroup


class StateSerializer(BaseSerializer):
    """Write/read serializer for ``State``.

    Exposes the state's group, color, order, and default flag, with
    ``workspace`` and ``project`` declared read-only. The ``order`` field is
    overridden as a ``FloatField`` here (instead of the integer ``sequence``
    persisted on the model) to support drag-and-drop reordering with
    fractional values that can be inserted between any two adjacent states
    without renumbering siblings.
    """

    order = serializers.FloatField(required=False)

    class Meta:
        """DRF metaclass binding ``State`` with ``workspace``/``project`` as read-only."""

        model = State
        fields = [
            "id",
            "project_id",
            "workspace_id",
            "name",
            "color",
            "group",
            "default",
            "description",
            "sequence",
            "order",
        ]
        read_only_fields = ["workspace", "project"]

    def validate(self, attrs):
        """Reject any state whose ``group`` equals ``TRIAGE``.

        TRIAGE is reserved for the project intake workflow and cannot be
        created or updated through this serializer.
        """
        if attrs.get("group") == StateGroup.TRIAGE.value:
            raise serializers.ValidationError("Cannot create triage state")
        return attrs


class StateLiteSerializer(BaseSerializer):
    """Compact ``State`` representation (id, name, color, group).

    Used as a nested field on issue/cycle/module serializers; all four
    exposed fields are read-only.
    """

    class Meta:
        """DRF metaclass binding ``State`` with all four exposed fields read-only."""

        model = State
        fields = ["id", "name", "color", "group"]
        read_only_fields = fields
