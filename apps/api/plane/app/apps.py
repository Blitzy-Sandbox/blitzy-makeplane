# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django AppConfig for the Plane DRF web-client API package.

Registers ``plane.app`` with the Django app registry so the package's DRF
views, serializers, permission classes, URL routers, and API-key
authentication middleware become discoverable at startup. Django loads this
config automatically when ``"plane.app"`` is listed in ``INSTALLED_APPS``.
"""

from django.apps import AppConfig


class AppApiConfig(AppConfig):
    """Registers the ``plane.app`` package as the core DRF API Django app.

    The ``name = "plane.app"`` attribute is the dotted Python path Django
    uses to locate the package and associate its models, migrations, and
    management commands.
    """

    name = "plane.app"
