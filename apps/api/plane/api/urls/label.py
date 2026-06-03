# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL routes for the external ``/api/v1/`` project label surface.

Binds project-scoped label list/create and detail endpoints to the view
classes in ``plane.api.views`` (``LabelListCreateAPIEndpoint``,
``LabelDetailAPIEndpoint``); all routes inherit ``X-Api-Key`` authentication
and ``ApiKeyRateThrottle`` throttling from ``BaseAPIView``.
"""

from django.urls import path

from plane.api.views import LabelListCreateAPIEndpoint, LabelDetailAPIEndpoint


urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/labels/",
        LabelListCreateAPIEndpoint.as_view(http_method_names=["get", "post"]),
        name="label",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/labels/<uuid:pk>/",
        LabelDetailAPIEndpoint.as_view(http_method_names=["get", "patch", "delete"]),
        name="label",
    ),
]
