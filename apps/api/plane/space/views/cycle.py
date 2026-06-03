# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Anchor-scoped public ``Cycle`` listing for the ``plane.space`` API.

Defines :class:`ProjectCyclesEndpoint`, a read-only compact listing
(``[{"id", "name"}, ...]``) of cycles belonging to the published project
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
from plane.db.models import DeployBoard, Cycle


class ProjectCyclesEndpoint(BaseAPIView):
    """Public read-only endpoint listing ``Cycle`` rows bound to a published board.

    HTTP methods and URL patterns:
        ``GET /api/public/anchor/<str:anchor>/cycles/``
        (URL name: ``project-cycles``; mounted via
        ``apps/api/plane/space/urls/project.py`` under the
        ``api/public/`` root prefix declared in ``apps/api/plane/urls.py``.)

    Request body:
        None. This is a read-only endpoint that accepts no payload; the
        ``anchor`` segment of the URL is the only input.

    Response shape:
        ``200 OK``: JSON array of ``{"id": UUID, "name": str}`` objects,
            one entry per :class:`plane.db.models.Cycle` row belonging to
            the project bound to ``anchor``. Order is database-default
            (no explicit ``order_by``).
        ``404 Not Found``: ``{"error": "Invalid anchor"}`` when the
            ``anchor`` does not resolve to any
            :class:`plane.db.models.DeployBoard` row.

    Permissions:
        ``permission_classes = [AllowAny]`` -- this surface is part of the
        anonymous public read surface for published deploy boards and is
        deliberately reachable without authentication.

    Queryset filter:
        Resolves ``anchor`` to a :class:`plane.db.models.DeployBoard` row,
        then returns
        ``Cycle.objects.filter(workspace__slug=<board.workspace.slug>,
        project_id=<board.project_id>).values("id", "name")``. The compact
        ``values("id", "name")`` projection is a deliberate security
        boundary: cycle start/end dates, owners, descriptions, and goals
        are intentionally NOT exposed on this anonymous surface, even
        though they exist on the underlying model.
    """

    permission_classes = [AllowAny]

    def get(self, request, anchor):
        """Return the compact cycle list for the published board behind ``anchor``.

        Resolves ``anchor`` to a :class:`plane.db.models.DeployBoard`, then
        returns the ``(id, name)`` projection of
        :class:`plane.db.models.Cycle` rows scoped to that board's
        workspace and project. Responds with HTTP 404 when ``anchor`` does
        not resolve to any deploy board.
        """
        deploy_board = DeployBoard.objects.filter(anchor=anchor).first()
        if not deploy_board:
            return Response({"error": "Invalid anchor"}, status=status.HTTP_404_NOT_FOUND)

        cycles = Cycle.objects.filter(
            workspace__slug=deploy_board.workspace.slug,
            project_id=deploy_board.project_id,
        ).values("id", "name")

        return Response(cycles, status=status.HTTP_200_OK)
