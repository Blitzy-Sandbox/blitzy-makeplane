# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Local development overlay applied via DJANGO_SETTINGS_MODULE=plane.settings.local.

Imports the shared baseline from :mod:`plane.settings.common` and applies
development-only overrides: forces ``DEBUG=True``, wires Django Debug
Toolbar into ``INSTALLED_APPS`` and ``MIDDLEWARE``, routes outbound email
to the console backend (overridable via the ``EMAIL_BACKEND`` env var),
points ``MEDIA_ROOT`` at a local ``uploads/`` directory, and configures a
verbose JSON-formatted developer logging policy that emits to stdout.

Cache backend remains the standard ``django_redis`` against ``REDIS_URL``
inherited from common. Sessions remain DB-backed via the
``plane.db.models.session`` engine inherited from common; Redis is the
cache backend ONLY (Celery uses RabbitMQ via AMQP — see AAP §0.2.2).

Module-level side effects:
    - ``os.makedirs(LOG_DIR)`` is invoked at import time when ``logs/``
      does not yet exist so the file-less developer LOGGING configuration
      below can resolve handler paths consistently.

Migrator startup contract: like every settings overlay, this module is
evaluated before the ``migrator`` container runs Django migrations, so
nothing here may import models or query the database at import time.
"""

import os

from .common import *  # noqa

DEBUG = True

# Debug Toolbar settings
INSTALLED_APPS += ("debug_toolbar",)  # noqa
MIDDLEWARE += ("debug_toolbar.middleware.DebugToolbarMiddleware",)  # noqa

DEBUG_TOOLBAR_PATCH_SETTINGS = False

# Only show emails in console don't send it to smtp
EMAIL_BACKEND = os.environ.get("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")

CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": REDIS_URL,  # noqa
        "OPTIONS": {"CLIENT_CLASS": "django_redis.client.DefaultClient"},
    }
}

INTERNAL_IPS = ("127.0.0.1",)

MEDIA_URL = "/uploads/"
MEDIA_ROOT = os.path.join(BASE_DIR, "uploads")  # noqa

LOG_DIR = os.path.join(BASE_DIR, "logs")  # noqa

if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR)

LOGGING = {
    "version": 1,
    "disable_existing_loggers": True,
    "formatters": {
        "verbose": {
            "format": "{levelname} {asctime} {module} {process:d} {thread:d} {message}",
            "style": "{",
        },
        "json": {
            "()": "pythonjsonlogger.jsonlogger.JsonFormatter",
            "fmt": "%(levelname)s %(asctime)s %(module)s %(name)s %(message)s",
        },
    },
    "handlers": {
        "console": {
            "level": "DEBUG",
            "class": "logging.StreamHandler",
            "formatter": "json",
        }
    },
    "loggers": {
        "plane.api.request": {
            "level": "INFO",
            "handlers": ["console"],
            "propagate": False,
        },
        "plane.api": {"level": "INFO", "handlers": ["console"], "propagate": False},
        "plane.worker": {"level": "INFO", "handlers": ["console"], "propagate": False},
        "plane.exception": {
            "level": "ERROR",
            "handlers": ["console"],
            "propagate": False,
        },
        "plane.external": {
            "level": "INFO",
            "handlers": ["console"],
            "propagate": False,
        },
        "plane.mongo": {
            "level": "INFO",
            "handlers": ["console"],
            "propagate": False,
        },
        "plane.authentication": {
            "level": "INFO",
            "handlers": ["console"],
            "propagate": False,
        },
        "plane.migrations": {
            "level": "INFO",
            "handlers": ["console"],
            "propagate": False,
        },
    },
}
