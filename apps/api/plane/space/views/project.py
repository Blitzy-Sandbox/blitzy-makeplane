# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Public project & deploy-board endpoints for the ``plane.space`` API.

Defines four anchor-resolved or slug-resolved :class:`BaseAPIView` subclasses:

* :class:`ProjectDeployBoardPublicSettingsEndpoint` -- anchor -> deploy-board
  settings payload (rendered by the board UI as the configuration source of
  truth).
* :class:`WorkspaceProjectDeployBoardEndpoint` -- anchor -> list of workspace
  projects that are publicly exposed (used by the workspace-level board hub).
* :class:`WorkspaceProjectAnchorEndpoint` -- reverse lookup from
  ``(workspace slug, project_id)`` back to a deploy-board anchor (used by the
  admin UI when generating shareable links).
* :class:`ProjectMembersEndpoint` -- anchor -> active project members (used
  by the board UI to render assignee avatars and display names).

All four classes mount under ``api/public/`` and use ``permission_classes =
[AllowAny]`` to serve unauthenticated traffic. Compact ``.values()``
projections (rather than full ``ModelSerializer`` payloads) limit field
exposure to the minimum needed by the published-board UI -- this is a
security boundary, not just a performance optimization.
"""

# Django imports
from django.db.models import Exists, OuterRef

# Third Party imports
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny

# Module imports
from .base import BaseAPIView
from plane.app.serializers import DeployBoardSerializer
from plane.db.models import Project, DeployBoard, ProjectMember


class ProjectDeployBoardPublicSettingsEndpoint(BaseAPIView):
    """Anchor-resolved public read of a project's :class:`DeployBoard` configuration.

    HTTP methods and URL patterns:
        GET /api/public/anchor/<str:anchor>/settings/
            (URL name: ``project-deploy-board-settings``)

    Request body:
        None (read-only endpoint).

    Response shape:
        200 OK: :class:`plane.app.serializers.DeployBoardSerializer` payload
            -- includes ``anchor``, ``entity_name``, ``entity_identifier``,
            ``project``, ``workspace``, ``comments``, ``reactions``,
            ``votes``, ``view_props``, ``inbox``, ``is_active``,
            ``view_props.list``, etc. This is the *configuration source of
            truth* the board UI reads on every page load to know which
            features (comments / reactions / votes / intake) to render.

    Permissions:
        ``permission_classes = [AllowAny]``.

    Queryset filter:
        ``DeployBoard.objects.get(anchor=anchor, entity_name="project")``
        -- anchors are namespaced by entity type so the
        ``entity_name="project"`` filter is required to ensure only
        project-level boards resolve here. :class:`DeployBoard.DoesNotExist`
        propagates to the :class:`BaseAPIView.handle_exception` 404 handler.
    """

    permission_classes = [AllowAny]

    def get(self, request, anchor):
        """Return the :class:`DeployBoardSerializer` payload for ``anchor``."""
        project_deploy_board = DeployBoard.objects.get(anchor=anchor, entity_name="project")
        serializer = DeployBoardSerializer(project_deploy_board)
        return Response(serializer.data, status=status.HTTP_200_OK)


class WorkspaceProjectDeployBoardEndpoint(BaseAPIView):
    """List a workspace's projects that are publicly exposed via a deploy-board.

    HTTP methods and URL patterns:
        GET /api/public/workspaces/<str:slug>/project-boards/
            (URL name: ``workspace-project-boards``, registered in
            ``apps/api/plane/space/urls/intake.py``)

    Request body:
        None.

    Response shape:
        200 OK: array of compact project rows --
            ``[{"id": UUID, "identifier": str, "name": str,
            "description": str, "emoji": str, "icon_prop": dict,
            "cover_image": str}, ...]``.
        The compact ``.values(...)`` projection is a security boundary:
            it deliberately omits internal fields (members, created_at,
            updated_at, settings, integrations) so anonymous viewers
            cannot enumerate workspace internals.

    Permissions:
        ``permission_classes = [AllowAny]``.

    Queryset filter:
        Filters :class:`Project` by workspace then annotates each row with
        an ``is_public`` :class:`Exists` subquery against
        :class:`DeployBoard` (anchor + ``entity_name="project"``), then
        filters ``is_public=True`` so only published projects appear in the
        response.

    # INTENT UNCLEAR: line 56 reads
    #     ``deploy_board = DeployBoard.objects.filter(...).values_list``
    # (a *reference to* the ``values_list`` method, NOT a call), and then
    # ``deploy_board.workspace`` references the un-evaluated queryset
    # method. The endpoint nonetheless returns rows in production because
    # the ``Exists`` subquery in the annotation is what actually scopes
    # the result set; the unused name appears to be dead code or a latent
    # bug. Per system boundaries we document the observed behavior
    # without modifying logic.
    """

    permission_classes = [AllowAny]

    def get(self, request, anchor):
        """Return compact rows for all publicly-exposed projects in ``anchor``'s workspace."""
        deploy_board = DeployBoard.objects.filter(anchor=anchor, entity_name="project").values_list
        projects = (
            Project.objects.filter(workspace=deploy_board.workspace)
            .annotate(
                is_public=Exists(
                    DeployBoard.objects.filter(anchor=anchor, project_id=OuterRef("pk"), entity_name="project")
                )
            )
            .filter(is_public=True)
        ).values(
            "id",
            "identifier",
            "name",
            "description",
            "emoji",
            "icon_prop",
            "cover_image",
        )

        return Response(projects, status=status.HTTP_200_OK)


class WorkspaceProjectAnchorEndpoint(BaseAPIView):
    """Reverse-lookup endpoint mapping ``(workspace slug, project_id)`` to a deploy-board anchor.

    HTTP methods and URL patterns:
        GET /api/public/workspaces/<str:slug>/projects/<uuid:project_id>/anchor/
            (URL name: ``project-deploy-board``)

    Request body:
        None.

    Response shape:
        200 OK: :class:`plane.app.serializers.DeployBoardSerializer` payload
            for the matching :class:`DeployBoard` row (same shape as
            :class:`ProjectDeployBoardPublicSettingsEndpoint`'s 200
            response).
        :class:`DeployBoard.DoesNotExist` propagates to
            :class:`BaseAPIView.handle_exception` and is translated to a
            404.

    Permissions:
        ``permission_classes = [AllowAny]``.

    Queryset filter:
        ``DeployBoard.objects.get(workspace__slug=slug,
        project_id=project_id, entity_name="project")`` -- note this
        matches by ``project_id`` (NOT ``entity_identifier``), so the row
        must have a denormalized ``project_id`` populated (true for
        project-entity deploy boards).
    """

    permission_classes = [AllowAny]

    def get(self, request, slug, project_id):
        """Return the :class:`DeployBoard` payload for ``(slug, project_id)``."""
        project_deploy_board = DeployBoard.objects.get(
            workspace__slug=slug, project_id=project_id, entity_name="project"
        )
        serializer = DeployBoardSerializer(project_deploy_board)
        return Response(serializer.data, status=status.HTTP_200_OK)


class ProjectMembersEndpoint(BaseAPIView):
    """List active members for the project behind a deploy-board ``anchor``.

    HTTP methods and URL patterns:
        GET /api/public/anchor/<str:anchor>/members/
            (URL name: ``project-members``)

    Request body:
        None.

    Response shape:
        200 OK: array of compact member rows --
            ``[{"id": UUID, "member": UUID, "member__display_name": str,
            "member__avatar": str | None}, ...]``.
        404 Not Found: ``{"error": "Invalid anchor"}`` when the anchor
            does not resolve to any :class:`DeployBoard` row.
        The compact projection deliberately excludes ``member__email``,
            ``member__first_name``, ``member__last_name``, ``role``, and
            ``join_date`` -- anonymous viewers see only the public-facing
            display name + avatar to avoid leaking member PII.

    Permissions:
        ``permission_classes = [AllowAny]``.

    Queryset filter:
        First resolves :class:`DeployBoard` from the anchor without
        filtering on ``entity_name`` (uses
        ``.filter(anchor=anchor).first()``), then queries
        :class:`ProjectMember` scoped to that board's ``project`` and
        ``workspace``, restricted to ``is_active=True`` so
        inactive/removed members are not exposed on the public UI.
    """

    permission_classes = [AllowAny]

    def get(self, request, anchor):
        """Return the compact active-member list for the project behind ``anchor``."""
        deploy_board = DeployBoard.objects.filter(anchor=anchor).first()
        if not deploy_board:
            return Response(
                {"error": "Invalid anchor"},
                status=status.HTTP_404_NOT_FOUND,
            )

        members = ProjectMember.objects.filter(
            project=deploy_board.project,
            workspace=deploy_board.workspace,
            is_active=True,
        ).values(
            "id",
            "member",
            "member__display_name",
            "member__avatar",
        )
        return Response(members, status=status.HTTP_200_OK)
