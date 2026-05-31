# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL routing for search endpoints.

Maps the search endpoints from ``plane.app.views`` to the global
workspace search, project-scoped issue search, and entity-search
(mention/autocomplete) routes scoped under ``workspaces/<slug>/``.
"""

from django.urls import path


from plane.app.views import GlobalSearchEndpoint, IssueSearchEndpoint, SearchEndpoint


urlpatterns = [
    path(
        "workspaces/<str:slug>/search/",
        GlobalSearchEndpoint.as_view(),
        name="global-search",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/search-issues/",
        IssueSearchEndpoint.as_view(),
        name="project-issue-search",
    ),
    path(
        "workspaces/<str:slug>/entity-search/",
        SearchEndpoint.as_view(),
        name="entity-search",
    ),
]
