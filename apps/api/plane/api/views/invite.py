# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workspace invitation endpoints for the external ``/api/v1/`` API.

Exposes a DRF ``ViewSet`` mounted at
``/api/v1/workspaces/<slug>/invitations/`` for workspace owners to invite,
list, update, and revoke pending invitations.

Authentication is via the ``X-Api-Key`` header (see
``plane.api.middleware.api_authentication.APIKeyAuthentication``).
"""

# Third party imports
from rest_framework.response import Response
from rest_framework import status
from drf_spectacular.utils import (
    extend_schema,
    OpenApiResponse,
    OpenApiRequest,
    OpenApiParameter,
    OpenApiTypes,
)

# Module imports
from plane.api.views.base import BaseViewSet
from plane.db.models import WorkspaceMemberInvite, Workspace
from plane.api.serializers import WorkspaceInviteSerializer
from plane.utils.permissions import WorkspaceOwnerPermission
from plane.utils.openapi.parameters import WORKSPACE_SLUG_PARAMETER


class WorkspaceInvitationsViewset(BaseViewSet):
    """Endpoint for creating, listing, updating, and revoking workspace invites.

    HTTP methods + URL patterns (DRF router):
        GET     /api/v1/workspaces/<slug>/invitations/
        POST    /api/v1/workspaces/<slug>/invitations/
        GET     /api/v1/workspaces/<slug>/invitations/<uuid:pk>/
        PATCH   /api/v1/workspaces/<slug>/invitations/<uuid:pk>/
        PUT     /api/v1/workspaces/<slug>/invitations/<uuid:pk>/
        DELETE  /api/v1/workspaces/<slug>/invitations/<uuid:pk>/

    Request body (POST) — see ``WorkspaceInviteSerializer``:
        email   (str, required)  – Invitee email address.
        role    (int, required)  – Workspace ``ROLE`` enum value
            (``GUEST=5``, ``MEMBER=15``, ``ADMIN=20``).

    Request body (PATCH / PUT) — partial ``WorkspaceInviteSerializer`` payload:
        role    (int, optional)  – Updated role. The ``email`` field is
            IMMUTABLE on existing invites; sending it in the payload
            returns ``400 Bad Request``.

    Response shape:
        - List/Retrieve: ``WorkspaceInviteSerializer`` payload(s).
        - Create: created invite via ``WorkspaceInviteSerializer``.
        - Update: updated invite via ``WorkspaceInviteSerializer``.
        - Destroy: HTTP 204 with empty body.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseViewSet``).
    Permissions:
        ``WorkspaceOwnerPermission`` — only the workspace OWNER role
        (``ADMIN`` with workspace ownership) can call any of these
        endpoints.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Constraints:
        - PATCH/PUT returns ``400 Bad Request`` if the payload attempts to
          modify ``email``; emails on existing invites are immutable.
        - DELETE returns ``400 Bad Request`` if the invite already has
          ``responded_at`` set (the invitee has accepted or declined);
          responded invites cannot be revoked.

    Side effects on POST:
        - Writes a new ``WorkspaceMemberInvite`` row.
        - Enqueues ``workspace_invitation`` task via Celery (transport:
          RabbitMQ) which sends the invitation email; the API response
          does not wait for the email to be delivered.
    """

    serializer_class = WorkspaceInviteSerializer
    model = WorkspaceMemberInvite

    permission_classes = [
        WorkspaceOwnerPermission,
    ]

    def get_queryset(self):
        """Filter invites to the URL's workspace (``slug``)."""
        return self.filter_queryset(super().get_queryset().filter(workspace__slug=self.kwargs.get("slug")))

    def get_object(self):
        """Return the workspace invite scoped by URL ``slug`` and ``pk``."""
        return self.get_queryset().get(pk=self.kwargs.get("pk"))

    @extend_schema(
        summary="List workspace invites",
        description="List all workspace invites for a workspace",
        responses={
            200: OpenApiResponse(
                description="Workspace invites",
                response=WorkspaceInviteSerializer(many=True),
            )
        },
        parameters=[
            WORKSPACE_SLUG_PARAMETER,
        ],
    )
    def list(self, request, slug):
        """Return every pending invite for the workspace identified by ``slug``."""
        workspace_member_invites = self.get_queryset()
        serializer = WorkspaceInviteSerializer(workspace_member_invites, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Get workspace invite",
        description="Get a workspace invite by ID",
        responses={200: OpenApiResponse(description="Workspace invite", response=WorkspaceInviteSerializer)},
        parameters=[
            WORKSPACE_SLUG_PARAMETER,
            OpenApiParameter(
                name="pk",
                description="Workspace invite ID",
                required=True,
                type=OpenApiTypes.UUID,
                location=OpenApiParameter.PATH,
            ),
        ],
    )
    def retrieve(self, request, slug, pk):
        """Return a single workspace invite identified by ``pk``."""
        workspace_member_invite = self.get_object()
        serializer = WorkspaceInviteSerializer(workspace_member_invite)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Create workspace invite",
        description="Create a workspace invite",
        responses={201: OpenApiResponse(description="Workspace invite", response=WorkspaceInviteSerializer)},
        request=OpenApiRequest(request=WorkspaceInviteSerializer),
        parameters=[
            WORKSPACE_SLUG_PARAMETER,
        ],
    )
    def create(self, request, slug):
        """Create a new workspace invite and enqueue the invitation email.

        The invite row is committed inline; the email send is enqueued via
        Celery+RabbitMQ (``workspace_invitation`` task) and runs out of
        band.
        """
        workspace = Workspace.objects.get(slug=slug)
        serializer = WorkspaceInviteSerializer(data=request.data, context={"slug": slug})
        serializer.is_valid(raise_exception=True)
        serializer.save(workspace=workspace, created_by=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Update workspace invite",
        description="Update a workspace invite",
        responses={200: OpenApiResponse(description="Workspace invite", response=WorkspaceInviteSerializer)},
        request=OpenApiRequest(request=WorkspaceInviteSerializer),
        parameters=[
            WORKSPACE_SLUG_PARAMETER,
            OpenApiParameter(
                name="pk",
                description="Workspace invite ID",
                required=True,
                type=OpenApiTypes.UUID,
                location=OpenApiParameter.PATH,
            ),
        ],
    )
    def partial_update(self, request, slug, pk):
        """Update a workspace invite partially (e.g. change the role).

        The ``email`` field is immutable; including it in the payload
        returns ``400 Bad Request``.
        """
        workspace_member_invite = self.get_object()
        if request.data.get("email"):
            return Response(
                status=status.HTTP_400_BAD_REQUEST,
                data={"error": "Email cannot be updated after invite is created.", "code": "EMAIL_CANNOT_BE_UPDATED"},
            )
        serializer = WorkspaceInviteSerializer(
            workspace_member_invite, data=request.data, partial=True, context={"slug": slug}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)

    @extend_schema(
        summary="Delete workspace invite",
        description="Delete a workspace invite",
        responses={204: OpenApiResponse(description="Workspace invite deleted")},
        parameters=[
            WORKSPACE_SLUG_PARAMETER,
            OpenApiParameter(
                name="pk",
                description="Workspace invite ID",
                required=True,
                type=OpenApiTypes.UUID,
                location=OpenApiParameter.PATH,
            ),
        ],
    )
    def destroy(self, request, slug, pk):
        """Revoke a pending workspace invite.

        Returns ``400 Bad Request`` if the invite has already been
        responded to (``responded_at IS NOT NULL``); responded invites
        cannot be revoked.
        """
        workspace_member_invite = self.get_object()
        if workspace_member_invite.accepted:
            return Response(
                status=status.HTTP_400_BAD_REQUEST,
                data={"error": "Invite already accepted", "code": "INVITE_ALREADY_ACCEPTED"},
            )
        if workspace_member_invite.responded_at:
            return Response(
                status=status.HTTP_400_BAD_REQUEST,
                data={"error": "Invite already responded", "code": "INVITE_ALREADY_RESPONDED"},
            )
        workspace_member_invite.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
