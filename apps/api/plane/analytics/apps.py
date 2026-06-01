# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django ``AppConfig`` declaration for the ``plane.analytics`` package.

Loaded by Django's app registry at startup because ``plane.analytics`` is
listed in ``INSTALLED_APPS`` (see ``plane.settings.common``). This module
contributes no models, signals, or ``ready()`` hooks; the analytics HTTP
surface itself is implemented under ``plane.app.views.analytic`` and wired
into URL routing via ``plane.app.urls.analytic``.
"""

from django.apps import AppConfig


class AnalyticsConfig(AppConfig):
    """Register ``plane.analytics`` with Django's app registry.

    The ``name`` attribute is the dotted Python path Django uses to associate
    this config with the analytics package; it must match the corresponding
    ``INSTALLED_APPS`` entry in ``plane.settings.common``.
    """

    name = "plane.analytics"
