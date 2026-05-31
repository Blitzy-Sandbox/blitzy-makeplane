# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL routes for the external ``/api/v1/`` project surface.

Binds workspace-scoped project collection, detail, archive/unarchive, and
summary endpoints to the view classes in ``plane.api.views``
(``ProjectListCreateAPIEndpoint``, ``ProjectDetailAPIEndpoint``,
``ProjectArchiveUnarchiveAPIEndpoint``, ``ProjectSummaryAPIEndpoint``);
all routes inherit ``X-Api-Key`` authentication and ``ApiKeyRateThrottle``
throttling from ``BaseAPIView``.
"""

from django.urls import path

from plane.api.views import (
    ProjectListCreateAPIEndpoint,
    ProjectDetailAPIEndpoint,
    ProjectArchiveUnarchiveAPIEndpoint,
    ProjectSummaryAPIEndpoint,
)

urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/",
        ProjectListCreateAPIEndpoint.as_view(http_method_names=["get", "post"]),
        name="project",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:pk>/",
        ProjectDetailAPIEndpoint.as_view(http_method_names=["get", "patch", "delete"]),
        name="project",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/archive/",
        ProjectArchiveUnarchiveAPIEndpoint.as_view(http_method_names=["post", "delete"]),
        name="project-archive-unarchive",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/summary/",
        ProjectSummaryAPIEndpoint.as_view(http_method_names=["get"]),
        name="project-summary",
    ),
]
