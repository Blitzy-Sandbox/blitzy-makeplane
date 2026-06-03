# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Database models for registered user devices and active device sessions.

This module exposes :class:`Device` (a per-platform push-notification routing
record) and :class:`DeviceSession` (a join between a device and the Plane DB-
backed :class:`Session`, used to track which device drove a given login).
"""

# models.py
from django.db import models
from django.conf import settings
from .base import BaseModel


class Device(BaseModel):
    """Registered end-user device with its push-notification routing token.

    One row per ``(user, device_id)`` combination; ``is_active`` distinguishes
    currently usable push targets from revoked or rotated tokens.
    """

    class DeviceType(models.TextChoices):
        """Closed set of supported device platforms for push-notification routing."""

        ANDROID = "ANDROID", "Android"
        IOS = "IOS", "iOS"
        WEB = "WEB", "Web"
        DESKTOP = "DESKTOP", "Desktop"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="devices")
    device_id = models.CharField(max_length=255, blank=True, null=True)
    # Valid: one of DeviceType — "ANDROID" | "IOS" | "WEB" | "DESKTOP".
    device_type = models.CharField(max_length=255, choices=DeviceType.choices)
    push_token = models.CharField(max_length=255, blank=True, null=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        """Database table layout and human-readable names for :class:`Device`."""

        db_table = "devices"
        verbose_name = "Device"
        verbose_name_plural = "Devices"


class DeviceSession(BaseModel):
    """Joins a :class:`Device` to a backend :class:`Session` for audit and device-aware logout.

    Rows are created at login and closed (``end_time`` populated, ``is_active``
    set to ``False``) at logout; the session-end audit fields support
    forced-logout and security-audit flows.
    """

    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name="sessions")
    session = models.ForeignKey("db.Session", on_delete=models.CASCADE, related_name="device_sessions")
    is_active = models.BooleanField(default=True)
    user_agent = models.CharField(max_length=255, null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    start_time = models.DateTimeField(auto_now_add=True)
    end_time = models.DateTimeField(null=True, blank=True)

    class Meta:
        """Database table layout and human-readable names for :class:`DeviceSession`."""

        db_table = "device_sessions"
        verbose_name = "Device Session"
        verbose_name_plural = "Device Sessions"
