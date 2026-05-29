# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""WSGI entrypoint for the Plane Django backend.

Exposes the module-level callable ``application`` required by WSGI servers
(gunicorn, uWSGI). ``DJANGO_SETTINGS_MODULE`` defaults to
``plane.settings.production`` when not overridden externally.

Startup contract: the ``migrator`` container runs Django migrations before any
WSGI service starts, so this module assumes the database schema is at the
expected revision at import time (per architectural rule in AAP §0.2.2).
"""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "plane.settings.production")

application = get_wsgi_application()
