# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Package marker for license-subsystem Celery background tasks.

Hosts ``instance_traces`` in ``plane.license.bgtasks.tracer``, the
OpenTelemetry-emitting task picked up by ``app.autodiscover_tasks()`` in
``plane/celery.py`` and scheduled every six hours by Celery Beat under
the ``run-every-6-hours-for-instance-trace`` entry. Celery tasks queue
through RabbitMQ (Redis is reserved for caching and session storage).
"""
