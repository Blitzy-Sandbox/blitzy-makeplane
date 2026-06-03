# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace-level label aggregation endpoint.

Exposes every ``Label`` that the requesting user can reach through an
active project membership, scoped to a single workspace. The endpoint is
cached for two hours via ``cache_response`` and uses the read-replica
routing flag so the cross-project query does not hit the primary DB.
"""

# Third party modules
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.serializers import LabelSerializer
from plane.app.views.base import BaseAPIView
from plane.db.models import Label
from plane.app.permissions import WorkspaceViewerPermission
from plane.utils.cache import cache_response


class WorkspaceLabelsEndpoint(BaseAPIView):
    """Return every workspace label visible to the caller.

    HTTP methods + URL pattern:
        GET /api/workspaces/<str:slug>/labels/

    Request body: none.

    Response shape:
        List[LabelSerializer] -- every ``Label`` whose project the caller
        is an active member of and whose project is not archived.

    Permissions:
        ``permission_classes = [WorkspaceViewerPermission]`` (declared
        on the class attribute; see
        ``apps/api/plane/app/views/workspace/label.py``) -- caller must
        be an active workspace member (any role).

    Caching:
        Wrapped with ``cache_response(60 * 60 * 2)`` (two-hour TTL).
        Redis is used purely as a cache here (not as a task broker --
        Celery routes through RabbitMQ, per architectural context).

    Cross-references:
        * Serializer: ``LabelSerializer`` in
          ``apps/api/plane/app/serializers/issue.py``.
        * Models: ``Label`` in
          ``apps/api/plane/db/models/label.py``;
          ``ProjectMember`` in
          ``apps/api/plane/db/models/project.py``.
        * Permissions: ``WorkspaceViewerPermission`` in
          ``apps/api/plane/app/permissions/workspace.py``.
        * Cache helper: ``cache_response`` in
          ``apps/api/plane/utils/cache.py``.
        * URL registration:
          ``apps/api/plane/app/urls/workspace.py``.
    """

    permission_classes = [WorkspaceViewerPermission]
    use_read_replica = True

    @cache_response(60 * 60 * 2)
    def get(self, request, slug):
        """List labels for the caller across the workspace.

        Filters ``Label`` rows by ``workspace__slug`` and restricts to
        labels whose project has the caller as an active member and that
        is not archived; the queryset is materialized via
        ``LabelSerializer``.
        """
        labels = Label.objects.filter(
            workspace__slug=slug,
            project__project_projectmember__member=request.user,
            project__project_projectmember__is_active=True,
            project__archived_at__isnull=True,
        )
        serializer = LabelSerializer(labels, many=True).data
        return Response(serializer, status=status.HTTP_200_OK)
