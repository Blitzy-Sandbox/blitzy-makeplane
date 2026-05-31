# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for the intake (triage) queue — incoming issues awaiting acceptance into the active board.

Intake issues live in the ``TRIAGE`` state until accepted (``status=1``), at which point the
linked :class:`Issue` is transitioned to the project's default state.
"""

# Third party frameworks
from rest_framework import serializers

# Module imports
from .base import BaseSerializer
from .issue import IssueIntakeSerializer, LabelLiteSerializer, IssueDetailSerializer
from .project import ProjectLiteSerializer
from .state import StateLiteSerializer
from .user import UserLiteSerializer
from plane.db.models import Intake, IntakeIssue, Issue, StateGroup, State


class IntakeSerializer(BaseSerializer):
    """Serializer for ``Intake`` records.

    Exposes the intake row with a queryset-annotated ``pending_issue_count``
    (not a model column).
    """

    project_detail = ProjectLiteSerializer(source="project", read_only=True)
    pending_issue_count = serializers.IntegerField(read_only=True)

    class Meta:
        """DRF serializer Meta options."""

        model = Intake
        fields = "__all__"
        read_only_fields = ["project", "workspace"]


class IntakeIssueSerializer(BaseSerializer):
    """Write serializer for ``IntakeIssue`` records.

    Owns the acceptance lifecycle that moves an issue out of the ``TRIAGE`` state into the
    project's default state. The nested ``issue`` field is a read-only
    :class:`IssueIntakeSerializer`; the inbound payload mutates only the ``IntakeIssue`` row,
    not the nested issue.
    """

    issue = IssueIntakeSerializer(read_only=True)

    class Meta:
        """DRF serializer Meta options."""

        model = IntakeIssue
        fields = [
            "id",
            "status",
            "duplicate_to",
            "snoozed_till",
            "source",
            "issue",
            "created_by",
        ]
        read_only_fields = ["project", "workspace"]

    def validate(self, attrs):
        """Reject acceptance (status=1) when the issue is in ``TRIAGE``.

        Raises ``ValidationError`` if the target project has no default state to transition to.
        """
        # Check if status is being updated to accepted
        if attrs.get("status") == 1:
            intake_issue = self.instance
            issue = intake_issue.issue

            # Check if issue is in TRIAGE state
            if issue.state and issue.state.group == StateGroup.TRIAGE.value:
                # Verify default state exists before allowing the update
                default_state = State.objects.filter(
                    workspace=intake_issue.workspace, project=intake_issue.project, default=True
                ).first()

                if not default_state:
                    raise serializers.ValidationError(
                        {"status": "Cannot accept intake issue: No default state found for the project"}
                    )

        return attrs

    def update(self, instance, validated_data):
        """Persist the ``IntakeIssue`` changes.

        On acceptance (``status=1``), transition the linked ``Issue`` out of ``TRIAGE``
        into the project's default state.
        """
        # Update the intake issue
        instance = super().update(instance, validated_data)

        # If status is accepted (1), transition the issue state from TRIAGE to default
        if validated_data.get("status") == 1:
            issue = instance.issue
            if issue.state and issue.state.group == StateGroup.TRIAGE.value:
                # Get the default project state
                default_state = State.objects.filter(
                    workspace=instance.workspace, project=instance.project, default=True
                ).first()
                if default_state:
                    issue.state = default_state
                    issue.save()

        return instance

    def to_representation(self, instance):
        """Forward the queryset-annotated ``label_ids`` onto the nested ``issue`` instance.

        Lets the read view expose label IDs without an extra round-trip.
        """
        # Pass the annotated fields to the Issue instance if they exist
        if hasattr(instance, "label_ids"):
            instance.issue.label_ids = instance.label_ids
        return super().to_representation(instance)


class IntakeIssueDetailSerializer(BaseSerializer):
    """Read-only detail view of ``IntakeIssue``.

    Adds the nested :class:`IssueDetailSerializer` for the full issue payload and a
    ``duplicate_issue_detail`` payload when the row is marked as a duplicate.
    """

    issue = IssueDetailSerializer(read_only=True)
    duplicate_issue_detail = IssueIntakeSerializer(read_only=True, source="duplicate_to")

    class Meta:
        """DRF serializer Meta options."""

        model = IntakeIssue
        fields = [
            "id",
            "status",
            "duplicate_to",
            "snoozed_till",
            "duplicate_issue_detail",
            "source",
            "issue",
        ]
        read_only_fields = ["project", "workspace"]

    def to_representation(self, instance):
        """Forward queryset-annotated ``assignee_ids`` and ``label_ids`` onto the nested ``issue``.

        Delegates the final rendering to the parent ``to_representation``.
        """
        # Pass the annotated fields to the Issue instance if they exist
        if hasattr(instance, "assignee_ids"):
            instance.issue.assignee_ids = instance.assignee_ids
        if hasattr(instance, "label_ids"):
            instance.issue.label_ids = instance.label_ids

        return super().to_representation(instance)


class IntakeIssueLiteSerializer(BaseSerializer):
    """Compact read-only ``IntakeIssue`` serializer used as the nested representation inside richer issue views."""

    class Meta:
        """DRF serializer Meta options."""

        model = IntakeIssue
        fields = ["id", "status", "duplicate_to", "snoozed_till", "source"]
        read_only_fields = fields


class IssueStateIntakeSerializer(BaseSerializer):
    """Read serializer for an ``Issue`` rendered in intake context.

    Nests state, project, labels, assignees, and the lite intake row plus a queryset-annotated
    ``sub_issues_count``.
    """

    state_detail = StateLiteSerializer(read_only=True, source="state")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    label_details = LabelLiteSerializer(read_only=True, source="labels", many=True)
    assignee_details = UserLiteSerializer(read_only=True, source="assignees", many=True)
    sub_issues_count = serializers.IntegerField(read_only=True)
    issue_intake = IntakeIssueLiteSerializer(read_only=True, many=True)

    class Meta:
        """DRF serializer Meta options."""

        model = Issue
        fields = "__all__"
