# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""Cycle (sprint / iteration) serializers for the ``/api/v1/`` API surface.

Used by :mod:`plane.api.views.cycle`. Cycle write paths normalise client
dates to UTC through :func:`plane.utils.timezone_converter.convert_to_utc`,
honouring the host project's timezone, and gate creation on the project's
``cycle_view`` feature flag. Read serializers attach the per-status work-item
counters and estimate roll-ups annotated by the ViewSet's queryset.
"""

# Third party imports
import pytz
from rest_framework import serializers

# Module imports
from .base import BaseSerializer
from plane.db.models import Cycle, CycleIssue, User, Project
from plane.utils.timezone_converter import convert_to_utc


class CycleCreateSerializer(BaseSerializer):
    """
    Serializer for creating cycles with timezone handling and date validation.

    Manages cycle creation including project timezone conversion, date range validation,
    and UTC normalization for time-bound iteration planning and sprint management.
    """

    owned_by = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(),
        required=False,
        allow_null=True,
        help_text="User who owns the cycle. If not provided, defaults to the current user.",
    )

    def __init__(self, *args, **kwargs):
        """Bind the project's timezone to ``start_date`` / ``end_date`` fields.

        Applied only when the host project is timezone-aware so client-side
        date inputs are interpreted in the project's local timezone before
        normalisation to UTC.
        """
        super().__init__(*args, **kwargs)
        project = self.context.get("project")
        if project and project.timezone:
            project_timezone = pytz.timezone(project.timezone)
            self.fields["start_date"].timezone = project_timezone
            self.fields["end_date"].timezone = project_timezone

    class Meta:
        """DRF metadata: serialize ``Cycle`` write payload; audit, scope, and identifier columns are read-only."""

        model = Cycle
        fields = [
            "name",
            "description",
            "start_date",
            "end_date",
            "owned_by",
            "external_source",
            "external_id",
            "timezone",
        ]
        read_only_fields = [
            "id",
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
            "deleted_at",
        ]

    def validate(self, data):
        """Validate the host project, the cycle feature flag, and the date range.

        Resolves ``project_id`` from initial data or the bound instance, rejects projects
        without ``cycle_view`` enabled, enforces ``start_date <= end_date``, and normalises
        both dates to UTC via :func:`plane.utils.timezone_converter.convert_to_utc`. When
        ``owned_by`` is blank, defaults it to the request user.
        """
        project_id = self.initial_data.get("project_id") or (
            self.instance.project_id if self.instance and hasattr(self.instance, "project_id") else None
        )

        if not project_id:
            raise serializers.ValidationError("Project ID is required")

        project = Project.objects.filter(id=project_id).first()
        if not project:
            raise serializers.ValidationError("Project not found")
        if not project.cycle_view:
            raise serializers.ValidationError("Cycles are not enabled for this project")
        if (
            data.get("start_date", None) is not None
            and data.get("end_date", None) is not None
            and data.get("start_date", None) > data.get("end_date", None)
        ):
            raise serializers.ValidationError("Start date cannot exceed end date")

        if data.get("start_date", None) is not None and data.get("end_date", None) is not None:
            data["start_date"] = convert_to_utc(
                date=str(data.get("start_date").date()),
                project_id=project_id,
                is_start_date=True,
            )
            data["end_date"] = convert_to_utc(
                date=str(data.get("end_date", None).date()),
                project_id=project_id,
            )

        if not data.get("owned_by"):
            data["owned_by"] = self.context["request"].user

        return data


class CycleUpdateSerializer(CycleCreateSerializer):
    """
    Serializer for updating cycles with enhanced ownership management.

    Extends cycle creation with update-specific features including ownership
    assignment and modification tracking for cycle lifecycle management.
    """

    class Meta(CycleCreateSerializer.Meta):
        """DRF metadata: extend :class:`CycleCreateSerializer.Meta` to expose ``owned_by`` on update."""

        model = Cycle
        fields = CycleCreateSerializer.Meta.fields + [
            "owned_by",
        ]


class CycleSerializer(BaseSerializer):
    """
    Cycle serializer with comprehensive project metrics and time tracking.

    Provides cycle details including work item counts by status, progress estimates,
    and time-bound iteration data for project management and sprint planning.
    """

    total_issues = serializers.IntegerField(read_only=True)
    cancelled_issues = serializers.IntegerField(read_only=True)
    completed_issues = serializers.IntegerField(read_only=True)
    started_issues = serializers.IntegerField(read_only=True)
    unstarted_issues = serializers.IntegerField(read_only=True)
    backlog_issues = serializers.IntegerField(read_only=True)
    total_estimates = serializers.FloatField(read_only=True)
    completed_estimates = serializers.FloatField(read_only=True)
    started_estimates = serializers.FloatField(read_only=True)

    class Meta:
        """DRF metadata: serialize ``Cycle`` with all fields; audit, scope, and ownership columns are read-only."""

        model = Cycle
        fields = "__all__"
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
            "workspace",
            "project",
            "owned_by",
            "deleted_at",
        ]


class CycleIssueSerializer(BaseSerializer):
    """
    Serializer for cycle-issue relationships with sub-issue counting.

    Manages the association between cycles and work items, including
    hierarchical issue tracking for nested work item structures.
    """

    sub_issues_count = serializers.IntegerField(read_only=True)

    class Meta:
        """DRF metadata: serialize ``CycleIssue``; ``workspace``, ``project``, ``cycle`` are read-only."""

        model = CycleIssue
        fields = "__all__"
        read_only_fields = ["workspace", "project", "cycle"]


class CycleLiteSerializer(BaseSerializer):
    """
    Lightweight cycle serializer for minimal data transfer.

    Provides essential cycle information without computed metrics,
    optimized for list views and reference lookups.
    """

    class Meta:
        """DRF metadata: serialize ``Cycle`` with all fields for lightweight read-only payloads."""

        model = Cycle
        fields = "__all__"


class CycleIssueRequestSerializer(serializers.Serializer):
    """
    Serializer for bulk work item assignment to cycles.

    Validates work item ID lists for batch operations including
    cycle assignment and sprint planning workflows.
    """

    issues = serializers.ListField(child=serializers.UUIDField(), help_text="List of issue IDs to add to the cycle")


class TransferCycleIssueRequestSerializer(serializers.Serializer):
    """
    Serializer for transferring work items between cycles.

    Handles work item migration between cycles including validation
    and relationship updates for sprint reallocation workflows.
    """

    new_cycle_id = serializers.UUIDField(help_text="ID of the target cycle to transfer issues to")
