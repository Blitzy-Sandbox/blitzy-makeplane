# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django ``AppConfig`` for the ``plane.api`` external REST surface.

This module is loaded by Django during startup once the project's
``INSTALLED_APPS`` list is initialized; ``ApiConfig.ready()`` then
registers drf-spectacular authentication extensions when available.
The Django app it configures exposes the external API-key authenticated
``/api/v1/`` surface mounted from ``plane.urls`` (see ``apps/api/plane/urls.py``).
"""

from django.apps import AppConfig


class ApiConfig(AppConfig):
    """``AppConfig`` for the ``plane.api`` package.

    The ``name`` attribute (``plane.api``) is the dotted module path Django
    uses to associate models, signals, and migrations with this app and to
    locate it inside ``INSTALLED_APPS``. ``default_auto_field`` is left at
    the project-wide default declared in Django settings.

    The dedicated ``migrator`` container applies all Django migrations
    before any API service starts, so ``ApiConfig.ready()`` can safely
    assume the database schema is in place by the time it executes.
    """

    name = "plane.api"

    def ready(self):
        """Register drf-spectacular auth extensions at app startup.

        Django invokes this hook exactly once per worker process after all
        installed apps and their models have been imported. Importing
        ``plane.utils.openapi.auth`` triggers registration of the
        ``AuthenticationExtension`` subclasses that describe the
        ``X-Api-Key`` scheme to drf-spectacular's OpenAPI generator
        (relevant only when ``settings.ENABLE_DRF_SPECTACULAR`` is true and
        the ``/api/schema/`` endpoints are mounted in ``plane.urls``).

        ``ImportError`` is intentionally swallowed so the API can boot in
        deployments where the optional drf-spectacular integration is not
        installed; the runtime API surface itself does not depend on the
        schema-auth module.
        """
        # Import authentication extensions to register them with drf-spectacular
        try:
            import plane.utils.openapi.auth  # noqa
        except ImportError:
            pass
