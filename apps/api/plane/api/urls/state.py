# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL routes for the external ``/api/v1/`` workflow state surface.

Binds project-scoped state list/create and detail endpoints to the view
classes in ``plane.api.views`` (``StateListCreateAPIEndpoint``,
``StateDetailAPIEndpoint``); all routes inherit ``X-Api-Key`` authentication
and ``ApiKeyRateThrottle`` throttling from ``BaseAPIView``.
"""

from django.urls import path

from plane.api.views import (
    StateListCreateAPIEndpoint,
    StateDetailAPIEndpoint,
)

urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/states/",
        StateListCreateAPIEndpoint.as_view(http_method_names=["get", "post"]),
        name="states",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/states/<uuid:state_id>/",
        StateDetailAPIEndpoint.as_view(http_method_names=["get", "patch", "delete"]),
        name="states",
    ),
]
