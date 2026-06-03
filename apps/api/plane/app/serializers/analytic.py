# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for analytic-view definitions exposed by the Plane analytics API.

Incoming query parameters are normalized through
:func:`plane.utils.issue_filters.issue_filters` so the persisted
:attr:`AnalyticView.query` JSON has a canonical shape that downstream
analytics rollups and rendering helpers can rely on.

Cross-references:
    * Model: :class:`plane.db.models.AnalyticView`
      (``apps/api/plane/db/models/analytic.py``).
    * Query normalizer: :func:`plane.utils.issue_filters.issue_filters`
      (``apps/api/plane/utils/issue_filters.py``).
"""

from .base import BaseSerializer
from plane.db.models import AnalyticView
from plane.utils.issue_filters import issue_filters


class AnalyticViewSerializer(BaseSerializer):
    """Serializer for the ``AnalyticView`` model used by the workspace analytics dashboard.

    ``workspace`` and ``query`` are declared read-only on ``Meta``:
    ``workspace`` is bound from URL context by the consuming ViewSet rather
    than the request body, and ``query`` is computed server-side from
    ``query_dict`` (on create) or ``query_data`` (on update) — never
    accepted directly from clients — so the persisted JSON always passes
    through :func:`plane.utils.issue_filters.issue_filters` normalization
    before it reaches the database.

    Inherits from :class:`BaseSerializer` (not
    :class:`DynamicBaseSerializer`), so this serializer does NOT support
    the ``fields`` / ``expand`` runtime field-selection arguments offered
    by the dynamic variant.
    """

    class Meta:
        """DRF metaclass binding ``AnalyticView`` with ``workspace`` and ``query`` declared read-only."""

        model = AnalyticView
        fields = "__all__"
        read_only_fields = ["workspace", "query"]

    def create(self, validated_data):
        """Normalize ``query_dict`` through ``issue_filters`` and persist as the canonical ``query`` JSON.

        When ``query_dict`` is missing or empty, ``query`` falls back to an
        empty dict (``{}``) without invoking the filter resolver. The
        :func:`issue_filters` call is tagged with the ``"POST"`` method
        because creation payloads carry filter values as JSON arrays in
        the request body rather than the comma-separated query-string
        segments used by ``"GET"``-mode reads.
        """
        query_params = validated_data.get("query_dict", {})
        if bool(query_params):
            validated_data["query"] = issue_filters(query_params, "POST")
        else:
            validated_data["query"] = {}
        return AnalyticView.objects.create(**validated_data)

    def update(self, instance, validated_data):
        """Recompute the canonical ``query`` JSON from ``query_data`` and delegate the model write to the parent.

        The final assignment of ``validated_data["query"]`` is
        unconditional: ``query`` is always overwritten with the
        ``"PATCH"``-mode normalization of ``query_data`` regardless of
        which branch of the preceding conditional ran, so the parent
        ``ModelSerializer.update`` always persists the freshly normalized
        payload.
        """
        query_params = validated_data.get("query_data", {})
        if bool(query_params):
            validated_data["query"] = issue_filters(query_params, "POST")
        else:
            validated_data["query"] = {}
        validated_data["query"] = issue_filters(query_params, "PATCH")
        return super().update(instance, validated_data)
