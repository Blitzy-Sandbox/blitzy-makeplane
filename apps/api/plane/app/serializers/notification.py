# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for in-app notifications and per-user notification preferences.

Notifications are produced by Celery tasks (consumed via RabbitMQ) in
``apps/api/plane/bgtasks/notification_task.py``; the serializers in this
module render the rows those tasks persist for the in-app notification feed.
"""

# Module imports
from .base import BaseSerializer
from .user import UserLiteSerializer
from plane.db.models import Notification, UserNotificationPreference

# Third Party imports
from rest_framework import serializers


class NotificationSerializer(BaseSerializer):
    """Read serializer for ``Notification`` rows.

    Nests the triggering user via ``triggered_by_details`` and exposes three
    read-only classification booleans (``is_inbox_issue``,
    ``is_intake_issue``, and ``is_mentioned_notification``) that the
    ViewSet queryset annotates upstream; they are absent from the response
    when the queryset does not annotate them because they are not stored
    columns on the ``Notification`` model.
    """

    triggered_by_details = UserLiteSerializer(read_only=True, source="triggered_by")
    is_inbox_issue = serializers.BooleanField(read_only=True)
    is_intake_issue = serializers.BooleanField(read_only=True)
    is_mentioned_notification = serializers.BooleanField(read_only=True)

    class Meta:
        """Bind the serializer to the ``Notification`` model and expose all fields."""

        model = Notification
        fields = "__all__"


class UserNotificationPreferenceSerializer(BaseSerializer):
    """Serializer for ``UserNotificationPreference`` rows (per-user notification opt-in/opt-out preferences)."""

    class Meta:
        """Bind the serializer to the ``UserNotificationPreference`` model and expose all fields."""

        model = UserNotificationPreference
        fields = "__all__"
