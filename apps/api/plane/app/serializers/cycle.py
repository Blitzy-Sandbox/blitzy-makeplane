# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for cycles and their per-user properties.

Cycles are time-boxed sprints attached to projects. This module owns the
write contract (:class:`CycleWriteSerializer`), the read view that exposes
queryset-annotated completion counts and a derived ``status`` value
(:class:`CycleSerializer`), the cycle/issue join row
(:class:`CycleIssueSerializer`), and per-user cycle preferences
(:class:`CycleUserPropertiesSerializer`).
"""

# Third party imports
from rest_framework import serializers

# Module imports
from .base import BaseSerializer
from .issue import IssueStateSerializer
from plane.db.models import Cycle, CycleIssue, CycleUserProperties
from plane.utils.timezone_converter import convert_to_utc


class CycleWriteSerializer(BaseSerializer):
    """Write serializer for ``Cycle`` records.

    Accepts ``start_date`` / ``end_date`` and normalizes them to UTC using the
    owning project's timezone via :func:`convert_to_utc`. The model's
    ``workspace``, ``project``, ``owned_by``, and ``archived_at`` fields are
    server-managed and therefore declared read-only. The annotated counts and
    derived ``status`` value exposed by :class:`CycleSerializer` are
    intentionally absent here -- those values are computed at read time from
    queryset annotations and have no setter contract.
    """

    def validate(self, data):
        """Reject inverted date ranges and normalize start/end to project-anchored UTC.

        The API accepts naive dates while the DB stores timezone-aware UTC
        datetimes, so :func:`convert_to_utc` is invoked with the project's
        timezone resolved from ``initial_data`` then ``self.instance`` then
        ``self.context`` in that fallback order.
        """
        if (
            data.get("start_date", None) is not None
            and data.get("end_date", None) is not None
            and data.get("start_date", None) > data.get("end_date", None)
        ):
            raise serializers.ValidationError("Start date cannot exceed end date")
        if data.get("start_date", None) is not None and data.get("end_date", None) is not None:
            project_id = (
                self.initial_data.get("project_id", None)
                or (self.instance and self.instance.project_id)
                or self.context.get("project_id", None)
            )
            data["start_date"] = convert_to_utc(
                date=str(data.get("start_date").date()),
                project_id=project_id,
                is_start_date=True,
            )
            data["end_date"] = convert_to_utc(
                date=str(data.get("end_date", None).date()),
                project_id=project_id,
            )
        return data

    class Meta:
        """Bind the write serializer to ``Cycle`` with server-managed fields kept read-only."""

        model = Cycle
        fields = "__all__"
        read_only_fields = ["workspace", "project", "owned_by", "archived_at"]


class CycleSerializer(BaseSerializer):
    """Read-only ``Cycle`` serializer with annotated rollups and a derived ``status``.

    The ``is_favorite``, ``total_issues``, ``cancelled_issues``,
    ``completed_issues``, ``started_issues``, ``unstarted_issues``,
    ``backlog_issues``, and ``status`` fields are NOT model columns -- they are
    annotated onto the queryset by the cycle ViewSet's ``get_queryset`` and are
    absent at serialization time without those annotations. ``status`` is one
    of ``"active"``, ``"draft"``, ``"upcoming"``, or ``"completed"``, computed
    from start/end dates and the cycle's completion state at queryset time.
    """

    # favorite
    is_favorite = serializers.BooleanField(read_only=True)
    total_issues = serializers.IntegerField(read_only=True)
    # state group wise distribution
    cancelled_issues = serializers.IntegerField(read_only=True)
    completed_issues = serializers.IntegerField(read_only=True)
    started_issues = serializers.IntegerField(read_only=True)
    unstarted_issues = serializers.IntegerField(read_only=True)
    backlog_issues = serializers.IntegerField(read_only=True)

    # active | draft | upcoming | completed
    status = serializers.CharField(read_only=True)

    class Meta:
        """Bind the read view to ``Cycle`` with every listed field exposed read-only."""

        model = Cycle
        fields = [
            # necessary fields
            "id",
            "workspace_id",
            "project_id",
            # model fields
            "name",
            "description",
            "start_date",
            "end_date",
            "owned_by_id",
            "view_props",
            "sort_order",
            "external_source",
            "external_id",
            "progress_snapshot",
            "logo_props",
            # meta fields
            "is_favorite",
            "total_issues",
            "cancelled_issues",
            "completed_issues",
            "started_issues",
            "unstarted_issues",
            "backlog_issues",
            "status",
        ]
        read_only_fields = fields


class CycleIssueSerializer(BaseSerializer):
    """Serializer for the ``CycleIssue`` join row.

    Exposes the linked issue's state details via a nested ``issue_detail``
    payload sourced from :class:`IssueStateSerializer`. ``workspace``,
    ``project``, and ``cycle`` are read-only because those foreign keys are
    set from URL context rather than the request body.
    """

    issue_detail = IssueStateSerializer(read_only=True, source="issue")
    sub_issues_count = serializers.IntegerField(read_only=True)

    class Meta:
        """Bind the serializer to ``CycleIssue`` with URL-derived foreign keys kept read-only."""

        model = CycleIssue
        fields = "__all__"
        read_only_fields = ["workspace", "project", "cycle"]


class CycleUserPropertiesSerializer(BaseSerializer):
    """Serializer for per-user filter and display preferences on a cycle.

    Maps to the ``CycleUserProperties`` model. ``workspace``, ``project``,
    ``cycle``, and ``user`` are read-only because the row is keyed by URL
    context plus the authenticated user.
    """

    class Meta:
        """Bind the serializer to ``CycleUserProperties`` with composite-key fields kept read-only."""

        model = CycleUserProperties
        fields = "__all__"
        read_only_fields = ["workspace", "project", "cycle", "user"]
