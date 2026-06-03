# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL routes for the external ``/api/v1/`` workspace and project member surface.

Binds project-scoped member endpoints (with a legacy ``/project-members/``
alias) and a workspace-level member listing endpoint to view classes in
``plane.api.views`` (``ProjectMemberListCreateAPIEndpoint``,
``ProjectMemberDetailAPIEndpoint``, ``WorkspaceMemberAPIEndpoint``); routes
inherit ``X-Api-Key`` authentication and ``ApiKeyRateThrottle`` throttling
from ``BaseAPIView``.
"""

from django.urls import path

from plane.api.views import (
    ProjectMemberListCreateAPIEndpoint,
    ProjectMemberDetailAPIEndpoint,
    WorkspaceMemberAPIEndpoint,
)

urlpatterns = [
    # Project members
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/members/",
        ProjectMemberListCreateAPIEndpoint.as_view(http_method_names=["get", "post"]),
        name="project-members",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/members/<uuid:pk>/",
        ProjectMemberDetailAPIEndpoint.as_view(http_method_names=["patch", "delete", "get"]),
        name="project-member",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/project-members/",
        ProjectMemberListCreateAPIEndpoint.as_view(http_method_names=["get", "post"]),
        name="project-members",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/project-members/<uuid:pk>/",
        ProjectMemberDetailAPIEndpoint.as_view(http_method_names=["patch", "delete", "get"]),
        name="project-member",
    ),
    path(
        "workspaces/<str:slug>/members/",
        WorkspaceMemberAPIEndpoint.as_view(http_method_names=["get"]),
        name="workspace-members",
    ),
]
