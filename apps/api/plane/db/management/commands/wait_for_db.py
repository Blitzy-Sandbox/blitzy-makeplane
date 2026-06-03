# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django management command that gates startup on database connectivity."""

import time
from django.db import connections
from django.db.utils import OperationalError
from django.core.management import BaseCommand


class Command(BaseCommand):
    """Block execution until ``connections['default']`` returns without raising ``OperationalError``.

    CLI signature:
        ``python manage.py wait_for_db``

    Side effects:
        Polls the default database connection in a one-second sleep loop, writing
        progress messages to stdout, until the connection handle is obtained.

    Idempotency:
        Idempotent — invocation has no persistent effect; it merely blocks.

    Trigger context:
        Container-orchestration startup gate. Sister scripts (entrypoints,
        ``docker-compose`` healthchecks) wait on this command before launching
        gunicorn, uvicorn, Celery worker, or Celery beat processes so that those
        processes never race the database container's readiness.
    """

    def handle(self, *args, **options):
        """Poll the default DB connection in a 1-second loop until it succeeds."""
        self.stdout.write("Waiting for database...")
        db_conn = None
        while not db_conn:
            try:
                db_conn = connections["default"]
            except OperationalError:
                self.stdout.write("Database unavailable, waititng 1 second...")
                time.sleep(1)

        self.stdout.write(self.style.SUCCESS("Database available!"))
