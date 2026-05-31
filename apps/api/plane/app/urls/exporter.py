# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL routing for issue export endpoints.

Maps the ``ExportIssuesEndpoint`` from ``plane.app.views`` to the
workspace-scoped issue export initiation and export history routes
scoped under ``workspaces/<slug>/export-issues/``.
"""

from django.urls import path

from plane.app.views import ExportIssuesEndpoint


urlpatterns = [
    path(
        "workspaces/<str:slug>/export-issues/",
        ExportIssuesEndpoint.as_view(),
        name="export-issues",
    ),
]
