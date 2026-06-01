# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django AppConfig for the ``plane.web`` sub-application.

The ``plane.web`` package owns the project-root health check and
``robots.txt`` endpoints (see ``plane.web.urls``). ``WebConfig`` is the
single ``AppConfig`` subclass in this module; Django auto-discovers it because
``"plane.web"`` is listed in ``INSTALLED_APPS`` (see
``apps/api/plane/settings/common.py``).
"""

from django.apps import AppConfig


class WebConfig(AppConfig):
    """Registers the ``plane.web`` Django app for health and crawler endpoints."""

    name = "plane.web"
