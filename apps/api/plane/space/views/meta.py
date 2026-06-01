# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Anchor-resolved public ``Project`` metadata endpoint for the ``plane.space`` API.

Defines :class:`ProjectMetaDataEndpoint`, the entry point that resolves a
deploy-board ``anchor`` (URL token) to the underlying :class:`Project` and
serializes the project header (identifier, name, cover image, icon, emoji,
description) via :class:`plane.space.serializer.project.ProjectLiteSerializer`.
Used by the published-board UI to render the board header before any
issue/cycle/module data is requested.

Mounted under ``api/public/`` and serves anonymous traffic; the
``ProjectLiteSerializer`` field selection is deliberately narrow to avoid
leaking workspace internals (member counts, settings, integration tokens)
to unauthenticated viewers.
"""

# third party
from rest_framework.permissions import AllowAny
from rest_framework import status
from rest_framework.response import Response

from plane.db.models import DeployBoard, Project

from .base import BaseAPIView
from plane.space.serializer.project import ProjectLiteSerializer


class ProjectMetaDataEndpoint(BaseAPIView):
    """Public endpoint returning the ``Project`` header behind a deploy-board ``anchor``.

    HTTP methods and URL patterns:
        GET /api/public/anchor/<str:anchor>/meta/   (name: ``project-meta``)

    Request body:
        None (read-only endpoint).

    Response shape:
        200 OK: :class:`plane.space.serializer.project.ProjectLiteSerializer`
        payload -- ``{"id": UUID, "identifier": str, "name": str,
        "cover_image": str, "icon_prop": dict, "emoji": str,
        "description": str}`` (all read-only).

        404 Not Found: ``{"error": "Project is not published"}`` when either
        the anchor does not resolve to a
        :class:`plane.db.models.DeployBoard` with ``entity_name="project"``
        OR the resolved ``entity_identifier`` does not point to an existing
        :class:`plane.db.models.Project`.

    Permissions:
        ``permission_classes = [AllowAny]`` -- anonymous public read surface
        mounted under ``api/public/``.

    Resolution chain:
        Anchors are namespaced by ``entity_name``; this endpoint filters on
        ``entity_name="project"`` so only project-level boards (not issue
        boards) resolve through it. ``entity_identifier`` is a polymorphic
        UUID foreign key that, for project anchors, points at a
        :class:`Project` row. Both lookup failures collapse to the same
        404 response so callers cannot distinguish a missing anchor from a
        missing project (a deliberate enumeration-attack mitigation).
    """

    permission_classes = [AllowAny]

    def get(self, request, anchor):
        """Return the ``ProjectLiteSerializer`` payload for the project behind ``anchor``.

        Resolves the anchor to a :class:`DeployBoard` row with
        ``entity_name="project"``, then fetches the referenced
        :class:`Project` and serializes it via
        :class:`ProjectLiteSerializer`. Either lookup failure produces a
        404 response with ``{"error": "Project is not published"}``.
        """
        try:
            deploy_board = DeployBoard.objects.get(anchor=anchor, entity_name="project")
        except DeployBoard.DoesNotExist:
            return Response({"error": "Project is not published"}, status=status.HTTP_404_NOT_FOUND)

        try:
            project_id = deploy_board.entity_identifier
            project = Project.objects.get(id=project_id)
        except Project.DoesNotExist:
            return Response({"error": "Project is not published"}, status=status.HTTP_404_NOT_FOUND)

        serializer = ProjectLiteSerializer(project)
        return Response(serializer.data, status=status.HTTP_200_OK)
