# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializer for the exporter history audit log (read-only).

Each :class:`~plane.db.models.ExporterHistory` row records a single export
job's lifecycle -- its ``status`` (``queued`` / ``processing`` / ``completed``
/ ``failed``), the ``provider`` format (``json`` / ``csv`` / ``xlsx``), the
output ``url`` once persisted to object storage, the user who initiated it,
and the opaque ``token`` that scopes the generated download.

The actual export work runs as a Celery task on the RabbitMQ-backed worker
queue (see ``plane.bgtasks.export_task.issue_export_task``); this serializer
only exposes the audit row that the task creates and updates as the job
progresses. No write paths exist through this serializer.
"""

# Module imports
from .base import BaseSerializer
from plane.db.models import ExporterHistory
from .user import UserLiteSerializer


class ExporterHistorySerializer(BaseSerializer):
    """Read-only serializer for ``ExporterHistory`` audit rows.

    Every exposed field is read-only: ``read_only_fields`` is set equal to
    ``fields`` on the inner ``Meta`` so consumers cannot mutate the audit
    log through the API. The underlying row is written by the export
    Celery task (RabbitMQ-backed; see ``plane.bgtasks.export_task``), and
    this serializer is the rendering surface that the export-status
    endpoint returns to the web client.

    The ``initiated_by_detail`` field is a nested :class:`UserLiteSerializer`
    projection of the initiator (id, names, avatar, ``is_bot``,
    ``display_name``) supplied as a read-only UI convenience so callers do
    not need to issue a second request to resolve the ``initiated_by`` FK.
    """

    initiated_by_detail = UserLiteSerializer(source="initiated_by", read_only=True)

    class Meta:
        """DRF metaclass binding ``ExporterHistory`` with every field read-only."""

        model = ExporterHistory
        fields = [
            "id",
            "created_at",
            "updated_at",
            "project",
            "provider",
            "status",
            "url",
            "initiated_by",
            "initiated_by_detail",
            "token",
            "created_by",
            "updated_by",
        ]
        read_only_fields = fields
