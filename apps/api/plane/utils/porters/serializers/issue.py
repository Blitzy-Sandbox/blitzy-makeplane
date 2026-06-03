# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Export-tuned DRF serializer that flattens issue relations into export rows.

Defines :class:`IssueExportSerializer`, an extension of
:class:`plane.app.serializers.IssueSerializer` whose ``SerializerMethodField``
resolvers normalize nested project, state, assignee, label, cycle, module,
comment, link, relation, subscriber, and estimate data into export-safe
scalars and primitive collections suitable for CSV / JSON / XLSX output.

Invoked synchronously by :class:`plane.utils.porters.exporter.DataExporter`
inside Celery export workers (broker: RabbitMQ -- see AAP section 0.2.2
architectural context). The :class:`Meta.fields` order in this serializer is
the authoritative CSV / XLSX column order; do not reorder entries silently.
"""

# Third party imports
from rest_framework import serializers

# Module imports
from plane.app.serializers import IssueSerializer


class IssueExportSerializer(IssueSerializer):
    """Flatten an issue and its relations into a single export-friendly row.

    Extends :class:`plane.app.serializers.IssueSerializer` and overlays
    read-only ``CharField`` source mappings (``project_name``,
    ``project_identifier``, ``state_name``, ``created_by_name``) plus
    :class:`SerializerMethodField` resolvers (``identifier``, ``assignees``,
    ``parent``, ``labels``, ``cycles``, ``modules``, ``comments``,
    ``estimate``, ``links``, ``relations``, ``subscribers``) so callers do
    not need to traverse nested relations, resolve UUIDs, or inspect
    related model objects at read time.

    Consumed by :class:`plane.utils.porters.exporter.DataExporter`
    (instantiated in :mod:`plane.bgtasks.export_task` at the
    ``DataExporter(IssueExportSerializer, format_type=...)`` call site) and
    emitted as CSV / JSON / XLSX. The :attr:`Meta.fields` ordering is the
    **authoritative export column order** for CSV and XLSX outputs --
    silent reordering will break downstream consumers and is forbidden by
    AAP section 0.12.3 system boundaries.
    """

    identifier = serializers.SerializerMethodField()
    project_name = serializers.CharField(source='project.name', read_only=True, default="")
    project_identifier = serializers.CharField(source='project.identifier', read_only=True, default="")
    state_name = serializers.CharField(source='state.name', read_only=True, default="")
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True, default="")

    assignees = serializers.SerializerMethodField()
    parent = serializers.SerializerMethodField()
    labels = serializers.SerializerMethodField()
    cycles = serializers.SerializerMethodField()
    modules = serializers.SerializerMethodField()
    comments = serializers.SerializerMethodField()
    estimate = serializers.SerializerMethodField()
    links = serializers.SerializerMethodField()
    relations = serializers.SerializerMethodField()
    subscribers = serializers.SerializerMethodField()

    class Meta(IssueSerializer.Meta):
        """Declare the ordered export field set; sequence is the CSV / XLSX column order."""

        fields = [
            "project_name",
            "project_identifier",
            "parent",
            "identifier",
            "sequence_id",
            "name",
            "state_name",
            "priority",
            "assignees",
            "subscribers",
            "created_by_name",
            "start_date",
            "target_date",
            "completed_at",
            "created_at",
            "updated_at",
            "archived_at",
            "estimate",
            "labels",
            "cycles",
            "modules",
            "links",
            "relations",
            "comments",
            "sub_issues_count",
            "link_count",
            "attachment_count",
            "is_draft",
        ]

    def get_identifier(self, obj):
        """Return human-readable issue key ``"<PROJECT_IDENTIFIER>-<SEQUENCE_ID>"`` for export rows and breadcrumbs."""
        return f"{obj.project.identifier}-{obj.sequence_id}"

    def get_assignees(self, obj):
        """Emit display names of currently active assignees so deactivated users are excluded from exports."""
        return [u.full_name for u in obj.assignees.all() if u.is_active]

    def get_subscribers(self, obj):
        """Return list of subscriber names."""
        return [sub.subscriber.full_name for sub in obj.issue_subscribers.all() if sub.subscriber]

    def get_parent(self, obj):
        """Return the parent issue key for sub-issues, or an empty string when the issue has no parent."""
        if not obj.parent:
            return ""
        return f"{obj.parent.project.identifier}-{obj.parent.sequence_id}"

    def get_labels(self, obj):
        """Flatten attached labels to a list of label names, skipping soft-deleted ``IssueLabel`` rows."""
        return [
            il.label.name
            for il in obj.label_issue.all()
            if il.deleted_at is None
        ]

    def get_cycles(self, obj):
        """Flatten cycle memberships to a list of cycle names for the export row."""
        return [ic.cycle.name for ic in obj.issue_cycle.all()]

    def get_modules(self, obj):
        """Flatten module memberships to a list of module names for the export row."""
        return [im.module.name for im in obj.issue_module.all()]

    def get_estimate(self, obj):
        """Return estimate point value."""
        if obj.estimate_point:
            return obj.estimate_point.value if hasattr(obj.estimate_point, 'value') else str(obj.estimate_point)
        return ""

    def get_links(self, obj):
        """Return list of issue links with titles."""
        return [
            {
                "url": link.url,
                "title": link.title if link.title else link.url,
            }
            for link in obj.issue_link.all()
        ]

    def get_relations(self, obj):
        """Return list of related issues."""
        relations = []

        # Outgoing relations (this issue relates to others)
        for rel in obj.issue_relation.all():
            if rel.related_issue:
                relations.append({
                    "type": rel.relation_type if hasattr(rel, 'relation_type') else "related",
                    "issue": f"{rel.related_issue.project.identifier}-{rel.related_issue.sequence_id}",
                    "direction": "outgoing"
                })

        # Incoming relations (other issues relate to this one)
        for rel in obj.issue_related.all():
            if rel.issue:
                relations.append({
                    "type": rel.relation_type if hasattr(rel, 'relation_type') else "related",
                    "issue": f"{rel.issue.project.identifier}-{rel.issue.sequence_id}",
                    "direction": "incoming"
                })

        return relations

    def get_comments(self, obj):
        """Return list of comments with author and timestamp."""
        return [
            {
                "comment": comment.comment_stripped if hasattr(comment, 'comment_stripped') else comment.comment_html,
                "created_by": comment.actor.full_name if comment.actor else "",
                "created_at": comment.created_at.strftime("%Y-%m-%d %H:%M:%S") if comment.created_at else "",
            }
            for comment in obj.issue_comments.all()
        ]
