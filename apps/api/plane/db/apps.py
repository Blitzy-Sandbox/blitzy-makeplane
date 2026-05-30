# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django ``AppConfig`` registration for the ``plane.db`` app.

Marks the package containing Plane's ORM models, mixins, management commands,
and migrations as a Django application so it participates in app discovery,
migration loading, and management command registration during startup.
"""

from django.apps import AppConfig


class DbConfig(AppConfig):
    """AppConfig for the ``plane.db`` Django application.

    Registers the package with Django's app registry under the dotted name
    ``plane.db``; no custom ``ready()`` hook is wired here because signal
    connections live in the model modules that own them.
    """

    name = "plane.db"
