# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Production overlay applied via DJANGO_SETTINGS_MODULE=plane.settings.production.

This is the default overlay: ``manage.py``, ``wsgi.py``, ``asgi.py``, and
``celery.py`` each ``os.environ.setdefault`` ``DJANGO_SETTINGS_MODULE`` to
``plane.settings.production`` so production semantics apply unless an
operator explicitly opts in to ``local`` or ``test``.

Imports the shared baseline from :mod:`plane.settings.common` and applies
production hardening:
    - ``DEBUG`` defaults to off and is only enabled when the ``DEBUG`` env
      var is exactly ``"1"`` (numeric coercion).
    - ``SECURE_PROXY_SSL_HEADER`` trusts the ``X-Forwarded-Proto`` header
      so ``request.is_secure()`` reports correctly behind a TLS-terminating
      reverse proxy.
    - ``scout_apm.django`` is appended to ``INSTALLED_APPS`` for Scout APM
      instrumentation. APM activation is controlled by ``SCOUT_MONITOR``
      and ``SCOUT_KEY`` env vars; ``SCOUT_NAME`` is fixed to ``"Plane"``.

Logging policy: JSON-formatted records are emitted to stdout for ingest by
log-aggregation pipelines, and ``plane.exception`` records additionally
roll to a size-rotated file at ``logs/plane-error.log`` (or
``logs/plane-debug.log`` when ``DEBUG=1``) via
:class:`plane.utils.logging.SizedTimedRotatingFileHandler`.

Module-level side effect: ``os.makedirs(LOG_DIR)`` is invoked at import
time when ``logs/`` does not yet exist so the rotating file handler can
resolve its filename. Production deployments typically mount this
directory on a persistent volume.

Async infrastructure (inherited from common per AAP §0.2.2): Celery
workers consume tasks from RabbitMQ via AMQP. Redis is the Django cache
backend only (django_redis against ``REDIS_URL``); sessions are
PostgreSQL-backed via the ``plane.db.models.session`` engine.

Migrator startup contract: this module is evaluated before the
``migrator`` container runs Django migrations, so nothing here may
import models or query the database at import time.
"""

import os

from .common import *  # noqa

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = int(os.environ.get("DEBUG", 0)) == 1

# Honor the 'X-Forwarded-Proto' header for request.is_secure()
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

INSTALLED_APPS += ("scout_apm.django",)  # noqa


# Scout Settings
SCOUT_MONITOR = os.environ.get("SCOUT_MONITOR", False)
SCOUT_KEY = os.environ.get("SCOUT_KEY", "")
SCOUT_NAME = "Plane"

LOG_DIR = os.path.join(BASE_DIR, "logs")  # noqa

if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR)

# Logging configuration
LOGGING = {
    "version": 1,
    "disable_existing_loggers": True,
    "formatters": {
        "verbose": {"format": "%(asctime)s [%(process)d] %(levelname)s %(name)s: %(message)s"},
        "json": {
            "()": "pythonjsonlogger.jsonlogger.JsonFormatter",
            "fmt": "%(levelname)s %(asctime)s %(module)s %(name)s %(message)s",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "json",
            "level": "INFO",
        },
        "file": {
            "class": "plane.utils.logging.SizedTimedRotatingFileHandler",
            "filename": (
                os.path.join(BASE_DIR, "logs", "plane-debug.log")  # noqa
                if DEBUG
                else os.path.join(BASE_DIR, "logs", "plane-error.log")  # noqa
            ),
            "when": "s",
            "maxBytes": 1024 * 1024 * 1,
            "interval": 1,
            "backupCount": 5,
            "formatter": "json",
            "level": "DEBUG" if DEBUG else "ERROR",
        },
    },
    "loggers": {
        "plane.api.request": {
            "level": "DEBUG" if DEBUG else "INFO",
            "handlers": ["console"],
            "propagate": False,
        },
        "plane.api": {
            "level": "DEBUG" if DEBUG else "INFO",
            "handlers": ["console"],
            "propagate": False,
        },
        "plane.worker": {
            "level": "DEBUG" if DEBUG else "INFO",
            "handlers": ["console"],
            "propagate": False,
        },
        "plane.exception": {
            "level": "DEBUG" if DEBUG else "ERROR",
            "handlers": ["console", "file"],
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
            "level": "DEBUG" if DEBUG else "INFO",
            "handlers": ["console"],
            "propagate": False,
        },
        "plane.migrations": {
            "level": "DEBUG" if DEBUG else "INFO",
            "handlers": ["console"],
            "propagate": False,
        },
    },
}
