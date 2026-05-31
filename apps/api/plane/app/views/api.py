# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""HTTP endpoint for managing the authenticated user's personal API tokens.

Defines :class:`ApiTokenEndpoint`, the DRF ``APIView`` subclass mounted at
``/api/users/api-tokens/`` and ``/api/users/api-tokens/<uuid:pk>/``. Tokens
are persisted in :class:`plane.db.models.APIToken`; the raw token string is
returned only once at create time -- all subsequent reads omit it. Service
tokens (``is_service=True``) are intentionally excluded from list and
delete operations.
"""

# Python import
from uuid import uuid4
from typing import Optional

# Third party
from rest_framework.response import Response
from rest_framework.request import Request
from rest_framework import status

# Module import
from .base import BaseAPIView
from plane.db.models import APIToken
from plane.app.serializers import APITokenSerializer, APITokenReadSerializer


class ApiTokenEndpoint(BaseAPIView):
    """Personal API token CRUD endpoint for the authenticated user.

    HTTP methods + URL patterns:
        POST   /api/users/api-tokens/
        GET    /api/users/api-tokens/
        GET    /api/users/api-tokens/<uuid:pk>/
        PATCH  /api/users/api-tokens/<uuid:pk>/
        DELETE /api/users/api-tokens/<uuid:pk>/

    Request body (POST):
        label (str, optional): Token label; defaults to a fresh ``uuid4().hex``.
        description (str, optional): Free-form description; defaults to ``""``.
        expired_at (datetime, optional): ISO-8601 expiry; ``None`` means no expiry.

    Request body (PATCH):
        Any subset of ``label``, ``description``, ``expired_at`` is accepted
        and forwarded to :class:`plane.app.serializers.APITokenSerializer`
        with ``partial=True``; the immutable ``token``, ``user``,
        ``user_type``, ``last_used`` fields are read-only.

    Response shape (POST):
        :class:`plane.app.serializers.APITokenSerializer` -- INCLUDES the
        secret ``token`` value. This is the only response in which the raw
        token is exposed.

    Response shape (GET list / detail / PATCH):
        :class:`plane.app.serializers.APITokenReadSerializer` -- EXCLUDES
        ``token``; exposes the computed ``is_active`` flag derived from
        ``expired_at``.

    Response shape (DELETE):
        HTTP 204 with empty body.

    Permissions:
        permission_classes = [IsAuthenticated]
            (inherited from :class:`plane.app.views.base.BaseAPIView`; no
            workspace/project scoping -- tokens are user-owned only).

    Queryset filter logic:
        All operations filter by ``user=request.user``. The list and delete
        endpoints additionally filter ``is_service=False`` to hide and
        protect service tokens (which are minted by the workspace's
        service-token issuer and must not be deleted by end users). The
        detail GET and PATCH endpoints omit the ``is_service`` filter so a
        user inspecting or renaming their own service token by ID is still
        permitted.
    """

    def post(self, request: Request) -> Response:
        """Create a new APIToken for the requesting user.

        The created token is returned with its secret ``token`` field
        populated; this is the only response in which the raw token is
        ever exposed.
        """
        label = request.data.get("label", str(uuid4().hex))
        description = request.data.get("description", "")
        expired_at = request.data.get("expired_at", None)

        # Check the user type
        user_type = 1 if request.user.is_bot else 0

        api_token = APIToken.objects.create(
            label=label,
            description=description,
            user=request.user,
            user_type=user_type,
            expired_at=expired_at,
        )

        serializer = APITokenSerializer(api_token)
        # Token will be only visible while creating
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def get(self, request: Request, pk: Optional[str] = None) -> Response:
        """List the user's non-service APITokens, or fetch one by ``pk``.

        The secret token value is never returned by this endpoint;
        :class:`APITokenReadSerializer` strips the ``token`` field and
        exposes the computed ``is_active`` flag instead.
        """
        if pk is None:
            api_tokens = APIToken.objects.filter(user=request.user, is_service=False)
            serializer = APITokenReadSerializer(api_tokens, many=True)
            return Response(serializer.data, status=status.HTTP_200_OK)
        else:
            api_tokens = APIToken.objects.get(user=request.user, pk=pk)
            serializer = APITokenReadSerializer(api_tokens)
            return Response(serializer.data, status=status.HTTP_200_OK)

    def delete(self, request: Request, pk: str) -> Response:
        """Delete the user's APIToken identified by ``pk``.

        Service tokens (``is_service=True``) are intentionally excluded
        from this endpoint and cannot be removed by end users.
        """
        api_token = APIToken.objects.get(user=request.user, pk=pk, is_service=False)
        api_token.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def patch(self, request: Request, pk: str) -> Response:
        """Partial update of the APIToken's mutable fields.

        Only ``label``, ``description`` and ``expired_at`` may be modified;
        the secret ``token`` value cannot be changed once issued.
        """
        api_token = APIToken.objects.get(user=request.user, pk=pk)
        serializer = APITokenSerializer(api_token, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
