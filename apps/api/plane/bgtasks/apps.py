# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django ``AppConfig`` registration for the ``plane.bgtasks`` package.

Declared so the bgtasks package can be added to ``INSTALLED_APPS`` (settings)
and so Celery's autodiscovery (``plane.celery.app.autodiscover_tasks()``) can
walk the installed-apps list and import every ``@shared_task`` module in this
package at worker startup. The ``name`` attribute of :class:`BgtasksConfig`
(``"plane.bgtasks"``) is the dotted Python path used by Django's app registry
and is also the ``app_label`` used for migrations and content-types.
"""

from django.apps import AppConfig


class BgtasksConfig(AppConfig):
    """``AppConfig`` for the ``plane.bgtasks`` Celery task package.

    The ``name`` attribute matches the dotted Python module name and is the
    Django app-registry key; Celery autodiscovery (``autodiscover_tasks()``
    in :mod:`plane.celery`) walks each installed app and imports any
    ``@shared_task``-decorated modules from this package so their
    registrations are visible to the worker.

    Async infrastructure (per repo-wide architectural rule): Celery workers
    consume tasks from **RabbitMQ**; Redis is used for caching and session
    storage only, NOT for task queueing.
    """

    name = "plane.bgtasks"
