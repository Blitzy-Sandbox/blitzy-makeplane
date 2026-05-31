# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace-level estimate aggregation endpoints.

Exposes a read-only listing of every distinct ``Estimate`` referenced by any
project in a workspace. The result is cached for two hours via
``cache_response`` because estimate definitions rarely change. Uses the
read-replica routing flag so the heavy join does not hit the primary DB.
"""

# Third party modules
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import WorkspaceEntityPermission
from plane.app.serializers import WorkspaceEstimateSerializer
from plane.app.views.base import BaseAPIView
from plane.db.models import Estimate, Project
from plane.utils.cache import cache_response


class WorkspaceEstimatesEndpoint(BaseAPIView):
    """Return every estimate used across a workspace.

    HTTP methods + URL pattern:
        GET /api/workspaces/<str:slug>/estimates/

    Request body: none (GET only).

    Response shape:
        List[WorkspaceEstimateSerializer] — one entry per project-level
        ``Estimate`` reachable from the workspace, with ``points`` prefetched.

    Permissions:
        permission_classes = [WorkspaceEntityPermission] — caller must be an
        active workspace member.

    Caching:
        Wrapped with ``cache_response(60 * 60 * 2)`` (two-hour TTL). Redis is
        used purely as a cache here (not as a task broker — Celery routes
        through RabbitMQ, per architectural context).
    """

    permission_classes = [WorkspaceEntityPermission]
    use_read_replica = True

    @cache_response(60 * 60 * 2)
    def get(self, request, slug):
        """List estimates for every project in the workspace.

        Collects estimate IDs from projects belonging to ``slug`` whose
        ``estimate`` foreign key is set, then returns the matching ``Estimate``
        rows with their ``points`` prefetched and the related workspace/project
        selected in a single query.
        """
        estimate_ids = Project.objects.filter(workspace__slug=slug, estimate__isnull=False).values_list(
            "estimate_id", flat=True
        )
        estimates = (
            Estimate.objects.filter(pk__in=estimate_ids, workspace__slug=slug)
            .prefetch_related("points")
            .select_related("workspace", "project")
        )

        serializer = WorkspaceEstimateSerializer(estimates, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)
