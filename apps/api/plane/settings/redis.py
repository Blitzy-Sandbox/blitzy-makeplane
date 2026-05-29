# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Helper for constructing direct Redis client instances.

Redis is used in Plane for **caching only** (the ``django_redis`` cache
backend configured in :mod:`plane.settings.common` reads ``REDIS_URL``)
and for adjacent coordination needs (rate-limit counters, magic-link
verification keys, and the apps/live force-close pub/sub channel). The
**Celery task broker is RabbitMQ via AMQP**, NOT Redis (see
``CELERY_BROKER_URL`` in :mod:`plane.settings.common`).

Sessions are stored in PostgreSQL via the custom
``plane.db.models.session`` backend; Redis is not used for session
persistence in this repository despite the general "cache + session"
phrasing in the AAP architectural context — sessions are DB-backed here.

Callers reach for :func:`redis_instance` when they need a raw
``redis-py`` client (pipelines, blocking commands, pub/sub) rather than
the higher-level Django cache abstraction. Documented consumers:
:mod:`plane.celery`, :mod:`plane.bgtasks.email_notification_task`,
:mod:`plane.bgtasks.issue_activities_task`, and
:mod:`plane.authentication.provider.credentials.magic_code`.
"""

import redis
from django.conf import settings
from urllib.parse import urlparse


def redis_instance():
    """Return a configured ``redis.Redis`` client for the active deployment.

    When ``settings.REDIS_SSL`` is truthy (set by
    :mod:`plane.settings.common` when ``REDIS_URL`` uses the ``rediss://``
    scheme), connection parameters are parsed out of the URL and a
    TLS-enabled client is constructed with ``ssl_cert_reqs=None`` so
    managed-Redis services that present self-signed or intermediate-issued
    certificates are accepted without bundling a CA file.

    Otherwise a non-TLS client is built via ``Redis.from_url`` and pinned
    to logical database 0 (matching the ``django_redis`` cache backend).

    Callers should NOT use this function as a Celery broker — see the
    module docstring; the Celery broker is RabbitMQ via AMQP.

    :returns: A connected ``redis.Redis`` client. The function does not
        verify connectivity; callers that require a liveness check must
        call ``.ping()`` themselves.
    """
    # connect to redis
    if settings.REDIS_SSL:
        url = urlparse(settings.REDIS_URL)
        ri = redis.Redis(
            host=url.hostname,
            port=url.port,
            password=url.password,
            ssl=True,
            ssl_cert_reqs=None,
        )
    else:
        ri = redis.Redis.from_url(settings.REDIS_URL, db=0)

    return ri
