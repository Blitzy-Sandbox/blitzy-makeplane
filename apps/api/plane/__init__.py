# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Root package for the Plane Django backend.

Re-exports the configured Celery app instance as ``celery_app`` so external
entry points (the Celery worker, the Beat scheduler) can import it via
``from plane import celery_app``.

Async infrastructure (per AAP §0.2.2 architectural rule): the re-exported
Celery app routes task messages through **RabbitMQ**; Redis is used by the
backend for caching and session storage only, NOT for task queueing.

``__all__`` is restricted to ``"celery_app"`` to keep the package import
surface minimal and explicit.
"""

from .celery import app as celery_app

__all__ = ("celery_app",)
