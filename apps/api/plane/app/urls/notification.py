# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL routing for notification endpoints.

Maps the notification ViewSets from ``plane.app.views`` (list/detail,
read/unread, archive/unarchive, unread polling, bulk mark-all-read,
user notification preferences) to URL paths scoped under
``workspaces/<slug>/users/notifications/``.
"""

from django.urls import path


from plane.app.views import (
    NotificationViewSet,
    UnreadNotificationEndpoint,
    MarkAllReadNotificationViewSet,
    UserNotificationPreferenceEndpoint,
)


urlpatterns = [
    path(
        "workspaces/<str:slug>/users/notifications/",
        NotificationViewSet.as_view({"get": "list"}),
        name="notifications",
    ),
    path(
        "workspaces/<str:slug>/users/notifications/<uuid:pk>/",
        NotificationViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
        name="notifications",
    ),
    path(
        "workspaces/<str:slug>/users/notifications/<uuid:pk>/read/",
        NotificationViewSet.as_view({"post": "mark_read", "delete": "mark_unread"}),
        name="notifications",
    ),
    path(
        "workspaces/<str:slug>/users/notifications/<uuid:pk>/archive/",
        NotificationViewSet.as_view({"post": "archive", "delete": "unarchive"}),
        name="notifications",
    ),
    path(
        "workspaces/<str:slug>/users/notifications/unread/",
        UnreadNotificationEndpoint.as_view(),
        name="unread-notifications",
    ),
    path(
        "workspaces/<str:slug>/users/notifications/mark-all-read/",
        MarkAllReadNotificationViewSet.as_view({"post": "create"}),
        name="mark-all-read-notifications",
    ),
    path(
        "users/me/notification-preferences/",
        UserNotificationPreferenceEndpoint.as_view(),
        name="user-notification-preferences",
    ),
]
