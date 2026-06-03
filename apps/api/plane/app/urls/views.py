# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL routing for saved-view (workspace and project) endpoints.

Maps the saved-view ViewSets from ``plane.app.views`` (project view
CRUD, workspace view CRUD, workspace view-issues, view favorites) to
URL paths scoped under ``workspaces/<slug>/`` and
``workspaces/<slug>/projects/<project_id>/views/``.

The filename ``views.py`` is the intentional URL-routing module for
the saved-view domain; it is unrelated to the sibling
``plane.app.views`` package and is not renamed.
"""

from django.urls import path


from plane.app.views import (
    IssueViewViewSet,
    WorkspaceViewViewSet,
    WorkspaceViewIssuesViewSet,
    IssueViewFavoriteViewSet,
)


urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/views/",
        IssueViewViewSet.as_view({"get": "list", "post": "create"}),
        name="project-view",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/views/<uuid:pk>/",
        IssueViewViewSet.as_view(
            {
                "get": "retrieve",
                "put": "update",
                "patch": "partial_update",
                "delete": "destroy",
            }
        ),
        name="project-view",
    ),
    path(
        "workspaces/<str:slug>/views/",
        WorkspaceViewViewSet.as_view({"get": "list", "post": "create"}),
        name="global-view",
    ),
    path(
        "workspaces/<str:slug>/views/<uuid:pk>/",
        WorkspaceViewViewSet.as_view(
            {
                "get": "retrieve",
                "put": "update",
                "patch": "partial_update",
                "delete": "destroy",
            }
        ),
        name="global-view",
    ),
    path(
        "workspaces/<str:slug>/issues/",
        WorkspaceViewIssuesViewSet.as_view({"get": "list"}),
        name="global-view-issues",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/user-favorite-views/",
        IssueViewFavoriteViewSet.as_view({"get": "list", "post": "create"}),
        name="user-favorite-view",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/user-favorite-views/<uuid:view_id>/",
        IssueViewFavoriteViewSet.as_view({"delete": "destroy"}),
        name="user-favorite-view",
    ),
]
