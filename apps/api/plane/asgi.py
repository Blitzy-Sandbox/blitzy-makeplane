# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""ASGI entrypoint for the Plane Django backend.

Exposes the module-level callable ``application`` as a Channels
``ProtocolTypeRouter`` so the same process can serve HTTP (Django views) and
future WebSocket protocols. ``get_asgi_application()`` is called eagerly so the
Django app registry is fully populated before any module that may import ORM
models is loaded; ``DJANGO_SETTINGS_MODULE`` defaults to
``plane.settings.production`` unless overridden externally.

Startup contract: the ``migrator`` container runs Django migrations before any
ASGI service starts, so this module assumes the database schema is at the
expected revision at import time.
"""

import os

from channels.routing import ProtocolTypeRouter
from django.core.asgi import get_asgi_application

django_asgi_app = get_asgi_application()


os.environ.setdefault("DJANGO_SETTINGS_MODULE", "plane.settings.production")
# Initialize Django ASGI application early to ensure the AppRegistry
# is populated before importing code that may import ORM models.


application = ProtocolTypeRouter({"http": get_asgi_application()})
