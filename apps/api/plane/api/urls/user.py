# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL routes for the external ``/api/v1/`` current-user surface.

Binds the GET-only ``users/me/`` endpoint to ``UserEndpoint`` in
``plane.api.views``; the route inherits ``X-Api-Key`` authentication and
``ApiKeyRateThrottle`` throttling from ``BaseAPIView``.
"""

from django.urls import path

from plane.api.views import UserEndpoint

urlpatterns = [
    path(
        "users/me/",
        UserEndpoint.as_view(http_method_names=["get"]),
        name="users",
    ),
]
