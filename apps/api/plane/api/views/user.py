# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Current-user endpoint for the external ``/api/v1/`` API surface.

Exposes ``GET /api/v1/users/me/`` returning the profile of the user that
authenticated the request via the ``X-Api-Key`` header.
"""

# Third party imports
from rest_framework import status
from rest_framework.response import Response
from drf_spectacular.utils import OpenApiResponse

# Module imports
from plane.api.serializers import UserLiteSerializer
from plane.api.views.base import BaseAPIView
from plane.db.models import User
from plane.utils.openapi.decorators import user_docs
from plane.utils.openapi import USER_EXAMPLE


class UserEndpoint(BaseAPIView):
    """Return the authenticated user's profile.

    HTTP method + URL pattern:
        GET /api/v1/users/me/

    Request body:
        None.

    Response shape — see ``UserLiteSerializer``:
        ``id``, ``first_name``, ``last_name``, ``email``, ``avatar_url``,
        ``display_name``, ``is_bot``.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``IsAuthenticated`` (inherited from ``BaseAPIView``).
    Throttle:
        ``ApiKeyRateThrottle`` (default 60/minute) or
        ``ServiceTokenRateThrottle`` (300/minute) when the API token has
        ``is_service=True`` — resolved per-request by
        ``BaseAPIView.get_throttles``.
    """

    serializer_class = UserLiteSerializer
    model = User

    @user_docs(
        operation_id="get_current_user",
        summary="Get current user",
        description="Retrieve the authenticated user's profile information including basic details.",
        responses={
            200: OpenApiResponse(
                description="Current user profile",
                response=UserLiteSerializer,
                examples=[USER_EXAMPLE],
            ),
        },
    )
    def get(self, request):
        """Get current user.

        Retrieve the authenticated user's profile information including basic details.
        Returns user data based on the current authentication context.
        """
        serializer = UserLiteSerializer(request.user)
        return Response(serializer.data, status=status.HTTP_200_OK)
