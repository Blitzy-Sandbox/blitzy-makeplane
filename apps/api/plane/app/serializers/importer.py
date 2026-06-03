# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializer for the third-party ``Importer`` audit/job rows.

Each ``Importer`` row records an inbound migration job (for example
from GitHub or Jira) and tracks status, provider, and timing. Import
work runs as Celery tasks via RabbitMQ (per the architectural
contract for async infrastructure); this serializer exposes the row
written by those workers to the Django REST Framework API layer.
"""

# Module imports
from .base import BaseSerializer
from .user import UserLiteSerializer
from .project import ProjectLiteSerializer
from .workspace import WorkspaceLiteSerializer
from plane.db.models import Importer


class ImporterSerializer(BaseSerializer):
    """Serializer for ``Importer`` rows with compact nested user/project/workspace details.

    The ``initiated_by_detail``, ``project_detail`` and
    ``workspace_detail`` fields are read-only nested views supplied for
    UI rendering convenience; writes go to the bare foreign-key columns
    ``initiated_by``, ``project`` and ``workspace`` populated by the
    underlying ``Importer`` model.
    """

    initiated_by_detail = UserLiteSerializer(source="initiated_by", read_only=True)
    project_detail = ProjectLiteSerializer(source="project", read_only=True)
    workspace_detail = WorkspaceLiteSerializer(source="workspace", read_only=True)

    class Meta:
        """Bind the serializer to the ``Importer`` model and expose every field."""

        model = Importer
        fields = "__all__"
