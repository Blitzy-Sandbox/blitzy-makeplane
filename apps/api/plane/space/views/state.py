# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Anchor-scoped public ``State`` listing for the ``plane.space`` API.

Defines :class:`ProjectStatesEndpoint`, a read-only compact listing of
non-triage workflow states belonging to the published project behind a
given ``anchor``. The ``anchor`` URL parameter resolves to a
:class:`plane.db.models.DeployBoard` row, which scopes the query to that
board's workspace and project; the endpoint is mounted under
``api/public/`` and serves anonymous traffic on published boards.
"""

# Django imports
from django.db.models import Q

# Third Party imports
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

# Module imports
from .base import BaseAPIView
from plane.db.models import DeployBoard, State


class ProjectStatesEndpoint(BaseAPIView):
    """Public read-only endpoint listing non-triage ``State`` rows bound to a published board.

    HTTP methods and URL patterns
        (mounted under ``api/public/`` from
        ``apps/api/plane/urls.py``; route registered in
        ``apps/api/plane/space/urls/project.py``):

        * ``GET /api/public/anchor/<str:anchor>/states/``
          (URL name ``project-states``).

    Request body:
        None -- read-only endpoint; ``anchor`` is supplied as a URL
        path parameter.

    Response shape:
        * ``200 OK`` -- JSON array of
          ``{"name": str, "group": str, "color": str, "id": UUID,
          "sequence": float}`` objects, one per non-triage
          :class:`plane.db.models.State` row in the project bound to
          the given anchor. ``group`` is one of
          :class:`plane.db.models.state.StateGroup` (``backlog``,
          ``unstarted``, ``started``, ``completed``, ``cancelled``);
          ``triage`` is excluded by the queryset filter described
          below.
        * ``404 Not Found`` -- ``{"error": "Invalid anchor"}`` when
          the anchor does not resolve to any
          :class:`plane.db.models.DeployBoard` row.

    Permissions:
        ``permission_classes = [AllowAny]`` -- anonymous public read
        surface on the published-board API; overrides the default
        ``[IsAuthenticated]`` declared on
        :class:`plane.space.views.base.BaseAPIView`.

    Queryset filter:
        Resolves ``anchor`` to a :class:`plane.db.models.DeployBoard`
        row (returning ``404`` if none matches), then returns
        ``State.objects.filter(~Q(name="Triage"),
        workspace__slug=<deploy_board.workspace.slug>,
        project_id=<deploy_board.project_id>).values(
        "name", "group", "color", "id", "sequence")``. The
        ``~Q(name="Triage")`` exclusion is deliberate: triage states
        are intake-pipeline implementation details (see
        :mod:`plane.space.views.intake`) and MUST NOT surface to
        anonymous viewers of the published board. ``sequence`` is
        retained in the projection so the consuming UI can sort
        states in canonical workflow order rather than alphabetically
        by name.
    """

    permission_classes = [AllowAny]

    def get(self, request, anchor):
        """Return the compact non-triage state list for the published board behind ``anchor``.

        Resolves ``anchor`` to a :class:`plane.db.models.DeployBoard`,
        then returns the ``(name, group, color, id, sequence)``
        projection of :class:`plane.db.models.State` rows (excluding
        ``name == "Triage"``) under that board's workspace and
        project. Responds with HTTP ``404`` and an
        ``{"error": "Invalid anchor"}`` body when the anchor does not
        resolve to any deploy board.
        """
        deploy_board = DeployBoard.objects.filter(anchor=anchor).first()
        if not deploy_board:
            return Response({"error": "Invalid anchor"}, status=status.HTTP_404_NOT_FOUND)

        states = State.objects.filter(
            ~Q(name="Triage"),
            workspace__slug=deploy_board.workspace.slug,
            project_id=deploy_board.project_id,
        ).values("name", "group", "color", "id", "sequence")

        return Response(states, status=status.HTTP_200_OK)
