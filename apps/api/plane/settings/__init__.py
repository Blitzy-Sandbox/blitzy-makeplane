# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django settings package for the Plane API service.

Selects the active overlay via the ``DJANGO_SETTINGS_MODULE`` environment
variable. ``manage.py``, ``wsgi.py``, ``asgi.py``, and ``celery.py`` each
default this to ``plane.settings.production`` (see those modules for the
``os.environ.setdefault`` calls); the ``local`` and ``test`` overlays are
opted into explicitly by the developer or CI runner.

Each overlay imports the shared baseline from
:mod:`plane.settings.common` and applies environment-specific overrides
on top. Infrastructure helpers — :mod:`plane.settings.redis`,
:mod:`plane.settings.mongo`, :mod:`plane.settings.storage`,
:mod:`plane.settings.openapi` — live alongside the overlays and are
imported on demand by application code (Celery tasks, asset views,
schema generation) rather than at package-import time.

Migrator startup contract (AAP §0.2.2): settings overlays are evaluated
BEFORE the ``migrator`` container runs Django migrations, so no module
in this package may import models or query the database at module-import
time.
"""
