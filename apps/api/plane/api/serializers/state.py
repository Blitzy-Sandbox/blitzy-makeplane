# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""Workflow-state serializers for the ``/api/v1/`` API surface.

Used by :mod:`plane.api.views.state`. :class:`StateSerializer` enforces the
"only one default state per project" invariant (by resetting other defaults
inside :meth:`validate`) and forbids client-side creation of TRIAGE states,
which are reserved for the platform's intake workflow.
"""

# Module imports
from .base import BaseSerializer
from plane.db.models import State, StateGroup
from rest_framework import serializers


class StateSerializer(BaseSerializer):
    """
    Serializer for work item states with default state management.

    Handles state creation and updates including default state validation
    and automatic default state switching for workflow management.
    """

    def validate(self, data):
        """Reset other defaults when ``default=True`` and reject TRIAGE-group state creation.

        When a state is being marked as default, all other states for the same
        project have their ``default`` field reset to ``False`` so only one
        default state exists per project. TRIAGE-group states cannot be created
        via this serializer because they are managed by the intake workflow.
        """
        # If the default is being provided then make all other states default False
        if data.get("default", False):
            State.objects.filter(project_id=self.context.get("project_id")).update(default=False)

        if data.get("group", None) == StateGroup.TRIAGE.value:
            raise serializers.ValidationError("Cannot create triage state")
        return data

    class Meta:
        """DRF metadata: serialize ``State`` with all fields and standard read-only audit / scoping columns."""

        model = State
        fields = "__all__"
        read_only_fields = [
            "id",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
            "workspace",
            "project",
            "deleted_at",
            "slug",
        ]


class StateLiteSerializer(BaseSerializer):
    """
    Lightweight state serializer for minimal data transfer.

    Provides essential state information including visual properties
    and grouping data optimized for UI display and filtering.
    """

    class Meta:
        """DRF metadata: serialize ``State`` exposing read-only id, name, color, and group for compact payloads."""

        model = State
        fields = ["id", "name", "color", "group"]
        read_only_fields = fields
