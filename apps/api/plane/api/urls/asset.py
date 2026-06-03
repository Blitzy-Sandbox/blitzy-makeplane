# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL routes for the external ``/api/v1/`` asset upload and download surface.

Binds workspace-scoped and user-scoped asset endpoints to the view classes in
``plane.api.views`` (``UserAssetEndpoint``, ``UserServerAssetEndpoint``,
``GenericAssetEndpoint``); all routes inherit ``X-Api-Key`` authentication
and ``ApiKeyRateThrottle`` throttling from ``BaseAPIView``.
"""

from django.urls import path

from plane.api.views import (
    UserAssetEndpoint,
    UserServerAssetEndpoint,
    GenericAssetEndpoint,
)

urlpatterns = [
    path(
        "assets/user-assets/",
        UserAssetEndpoint.as_view(http_method_names=["post"]),
        name="user-assets",
    ),
    path(
        "assets/user-assets/<uuid:asset_id>/",
        UserAssetEndpoint.as_view(http_method_names=["patch", "delete"]),
        name="user-assets-detail",
    ),
    path(
        "assets/user-assets/server/",
        UserServerAssetEndpoint.as_view(http_method_names=["post"]),
        name="user-server-assets",
    ),
    path(
        "assets/user-assets/<uuid:asset_id>/server/",
        UserServerAssetEndpoint.as_view(http_method_names=["patch", "delete"]),
        name="user-server-assets-detail",
    ),
    path(
        "workspaces/<str:slug>/assets/",
        GenericAssetEndpoint.as_view(http_method_names=["post"]),
        name="generic-asset",
    ),
    path(
        "workspaces/<str:slug>/assets/<uuid:asset_id>/",
        GenericAssetEndpoint.as_view(http_method_names=["get", "patch"]),
        name="generic-asset-detail",
    ),
]
