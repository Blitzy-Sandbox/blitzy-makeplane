# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Recent-visit listing endpoint for workspace navigation.

Consumes rows written asynchronously by ``plane.bgtasks.recent_visited_task``
(Celery via RabbitMQ — Redis is used only for caching/session, per
architectural context). The endpoint is the read-side of the recent-visit
pipeline that powers "recently visited" surfaces in the frontend.
"""

# Third party imports
from rest_framework import status
from rest_framework.response import Response

from plane.db.models import UserRecentVisit
from plane.app.serializers import WorkspaceRecentVisitSerializer

# Modules imports
from ..base import BaseViewSet
from plane.app.permissions import allow_permission, ROLE


class UserRecentVisitViewSet(BaseViewSet):
    """Expose the caller's recent visits in a workspace.

    HTTP methods + URL pattern:
        GET /api/workspaces/<str:slug>/recent-visits/

    Request body: none. Query parameters:
        entity_name (str, optional): one of ``"issue"`` | ``"page"`` |
            ``"project"``. When supplied, restricts the result to that entity
            type.

    Response shape:
        List[WorkspaceRecentVisitSerializer] — at most 20 entries, ordered by
        the model's default ``Meta.ordering``.

    Permissions:
        Enforced by ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST],
        level="WORKSPACE")`` on each handler — any active workspace member.

    Read replica:
        ``use_read_replica = True`` — listing is read-only and offloaded from
        the primary DB.

    Writes:
        None here. Recent-visit rows are persisted by the
        ``plane.bgtasks.recent_visited_task`` Celery task, dispatched via
        ``.delay()`` from view base classes.

    Cross-references:
        * Serializer: ``WorkspaceRecentVisitSerializer`` in
          ``apps/api/plane/app/serializers/workspace.py``.
        * Model: ``UserRecentVisit`` in
          ``apps/api/plane/db/models/recent_visit.py``.
        * Permissions: ``allow_permission`` decorator in
          ``apps/api/plane/app/permissions/base.py``.
        * Celery task:
          ``apps/api/plane/bgtasks/recent_visited_task.py`` (queued
          via RabbitMQ).
        * URL registration:
          ``apps/api/plane/app/urls/workspace.py``.
    """

    model = UserRecentVisit
    use_read_replica = True

    def get_serializer_class(self):
        """Return ``WorkspaceRecentVisitSerializer`` for every action."""
        return WorkspaceRecentVisitSerializer

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug):
        """Return the caller's twenty most recent visits in the workspace.

        Filters ``UserRecentVisit`` by ``workspace__slug`` and ``user``. If the
        ``entity_name`` query parameter is present, narrows by that field before
        clamping the result to entities of type ``"issue"``, ``"page"``, or
        ``"project"`` and serializing the first twenty rows.
        """
        user_recent_visits = UserRecentVisit.objects.filter(workspace__slug=slug, user=request.user)

        entity_name = request.query_params.get("entity_name")

        if entity_name:
            user_recent_visits = user_recent_visits.filter(entity_name=entity_name)

        user_recent_visits = user_recent_visits.filter(entity_name__in=["issue", "page", "project"])

        serializer = WorkspaceRecentVisitSerializer(user_recent_visits[:20], many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)
