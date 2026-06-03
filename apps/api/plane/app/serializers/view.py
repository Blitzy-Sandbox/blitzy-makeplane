# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for saved issue views (``IssueView``) and the lightweight issue-list payload they render.

This module owns two distinct serialization surfaces:

* :class:`ViewIssueListSerializer` -- a hand-rolled (non-``ModelSerializer``)
  serializer that flattens an :class:`~plane.db.models.Issue` row plus its
  reverse-related M2M ID projections (assignees, labels, modules) into the
  payload format expected by saved-view list endpoints.
* :class:`IssueViewSerializer` -- a :class:`DynamicBaseSerializer` for the
  :class:`~plane.db.models.IssueView` entity itself, which normalizes the
  inbound ``filters`` payload through :func:`plane.utils.issue_filters.issue_filters`
  and persists the canonical ``query`` JSON on every create/update.
"""

# Third party imports
from rest_framework import serializers

# Module imports
from .base import DynamicBaseSerializer
from plane.db.models import IssueView
from plane.utils.issue_filters import issue_filters


class ViewIssueListSerializer(serializers.Serializer):
    """Flatten an ``Issue`` row plus its M2M ID projections into the saved-view list payload.

    Hand-rolled (non-``ModelSerializer``) list serializer: unlike a standard
    :class:`~rest_framework.serializers.ModelSerializer`, this class declares
    no field bindings -- the entire payload is constructed in
    :meth:`to_representation` directly from the prefetched
    :class:`~plane.db.models.Issue` instance and the three reverse-relation
    ID projections (assignees via ``issue_assignee``, labels via
    ``label_issue``, modules via ``issue_module``). Callers must ensure
    those reverse-relation managers are prefetched on the queryset to
    avoid N+1 queries on list endpoints.
    """

    def get_assignee_ids(self, instance):
        """Project the assignee IDs from the prefetched ``issue_assignee`` reverse-relation manager."""
        return [assignee.assignee_id for assignee in instance.issue_assignee.all()]

    def get_label_ids(self, instance):
        """Project the label IDs from the prefetched ``label_issue`` reverse-relation manager."""
        return [label.label_id for label in instance.label_issue.all()]

    def get_module_ids(self, instance):
        """Project the module IDs from the prefetched ``issue_module`` reverse-relation manager."""
        return [module.module_id for module in instance.issue_module.all()]

    def to_representation(self, instance):
        """Build the flat issue payload from the prefetched instance plus the three reverse-M2M ID projections."""
        data = {
            "id": instance.id,
            "name": instance.name,
            "state_id": instance.state_id,
            "sort_order": instance.sort_order,
            "completed_at": instance.completed_at,
            "estimate_point": instance.estimate_point_id,
            "priority": instance.priority,
            "start_date": instance.start_date,
            "target_date": instance.target_date,
            "sequence_id": instance.sequence_id,
            "project_id": instance.project_id,
            "parent_id": instance.parent_id,
            "cycle_id": instance.cycle_id,
            "sub_issues_count": instance.sub_issues_count,
            "created_at": instance.created_at,
            "updated_at": instance.updated_at,
            "created_by": instance.created_by_id,
            "updated_by": instance.updated_by_id,
            "attachment_count": instance.attachment_count,
            "link_count": instance.link_count,
            "is_draft": instance.is_draft,
            "archived_at": instance.archived_at,
            "state__group": instance.state.group if instance.state else None,
            "assignee_ids": self.get_assignee_ids(instance),
            "label_ids": self.get_label_ids(instance),
            "module_ids": self.get_module_ids(instance),
        }
        return data


class IssueViewSerializer(DynamicBaseSerializer):
    """Serializer for saved ``IssueView`` definitions.

    Normalizes the inbound ``filters`` payload through
    :func:`plane.utils.issue_filters.issue_filters` and persists the
    canonical ``query`` JSON on every create/update.

    The serializer exposes every ``IssueView`` field via ``fields = "__all__"``
    but pins the following as read-only because they are server-managed
    (bound from request context) or computed from ``filters`` rather than
    accepted directly from clients:

    * ``workspace``, ``project`` -- bound from the URL context.
    * ``owned_by`` -- bound from the authenticated user at create time.
    * ``access``, ``is_locked`` -- managed via dedicated lock/share endpoints.
    * ``query`` -- recomputed from ``filters`` on every create/update by
      this serializer (see :meth:`create` and :meth:`update`).

    The ``is_favorite`` field is declared on the class as a write-blocked
    boolean so that view consumers can hydrate it from a join annotation
    without exposing it as a writable attribute.
    """

    is_favorite = serializers.BooleanField(read_only=True)

    class Meta:
        """DRF model binding for the ``IssueView`` table."""

        model = IssueView
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "query",
            "owned_by",
            "access",
            "is_locked",
        ]

    def create(self, validated_data):
        """Normalize ``filters`` via ``issue_filters(..., 'POST')`` and persist as the canonical ``query`` JSON."""
        query_params = validated_data.get("filters", {})
        if bool(query_params):
            validated_data["query"] = issue_filters(query_params, "POST")
        else:
            validated_data["query"] = {}
        return IssueView.objects.create(**validated_data)

    def update(self, instance, validated_data):
        """Recompute the ``query`` JSON from ``filters`` and delegate the model write to the parent."""
        query_params = validated_data.get("filters", {})
        if bool(query_params):
            validated_data["query"] = issue_filters(query_params, "POST")
        else:
            validated_data["query"] = {}
        validated_data["query"] = issue_filters(query_params, "PATCH")
        return super().update(instance, validated_data)
