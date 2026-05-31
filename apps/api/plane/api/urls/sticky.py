# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL routes for the external ``/api/v1/`` workspace sticky-note surface.

Registers ``StickyViewSet`` from ``plane.api.views`` on a DRF
``DefaultRouter`` under the ``workspaces/<slug>/stickies/`` namespace;
routes inherit ``X-Api-Key`` authentication and ``ApiKeyRateThrottle``
throttling from ``BaseAPIView``.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from plane.api.views import StickyViewSet


router = DefaultRouter()
router.register(r"stickies", StickyViewSet, basename="workspace-stickies")

urlpatterns = [
    path("workspaces/<str:slug>/", include(router.urls)),
]
