# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Anchor-scoped public ``Module`` listing for the ``plane.space`` API.

Defines :class:`ProjectModulesEndpoint`, a read-only compact listing
(``[{"id", "name"}, ...]``) of modules belonging to the published project
behind a given ``anchor``. The ``anchor`` URL parameter resolves to a
:class:`plane.db.models.DeployBoard` row, which scopes the query to that
board's workspace and project; the endpoint is mounted under
``api/public/`` and serves anonymous traffic on published deploy boards.
"""

# Third Party imports
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

# Module imports
from .base import BaseAPIView
from plane.db.models import DeployBoard, Module


class ProjectModulesEndpoint(BaseAPIView):
    """Public read-only endpoint listing ``Module`` rows bound to a published board.

    HTTP methods and URL patterns:
        GET /api/public/anchor/<str:anchor>/modules/   (name: ``project-modules``)

    Request body:
        None (read-only endpoint).

    Response shape:
        200 OK: JSON array of ``{"id": UUID, "name": str}`` objects, one per
            module in the project bound to the given anchor.
        404 Not Found: ``{"error": "Invalid anchor"}`` when the anchor does
            not resolve to a :class:`plane.db.models.DeployBoard` row.

    Permissions:
        ``permission_classes = [AllowAny]`` -- anonymous public read surface
        on ``api/public/``.

    Queryset filter:
        Resolves ``anchor`` to a :class:`DeployBoard` row, then returns
        ``Module.objects.filter(workspace__slug=..., project_id=...).values(
        "id", "name")``. The compact ``values()`` projection is a deliberate
        security boundary: module owners, dates, statuses, and scope are
        NOT exposed on the anonymous surface.
    """

    permission_classes = [AllowAny]

    def get(self, request, anchor):
        """Return the compact module list for the published board behind ``anchor``.

        Resolves ``anchor`` to a :class:`DeployBoard`, then returns the
        ``(id, name)`` projection of ``Module`` rows under that board's
        workspace and project. Responds with HTTP 404 when the anchor does
        not resolve to any deploy board.
        """
        deploy_board = DeployBoard.objects.filter(anchor=anchor).first()
        if not deploy_board:
            return Response({"error": "Invalid anchor"}, status=status.HTTP_404_NOT_FOUND)

        modules = Module.objects.filter(
            workspace__slug=deploy_board.workspace.slug,
            project_id=deploy_board.project_id,
        ).values("id", "name")

        return Response(modules, status=status.HTTP_200_OK)
