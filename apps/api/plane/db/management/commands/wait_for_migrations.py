# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django management command that gates startup on Django migration completion."""

# wait_for_migrations.py
import time
from django.core.management.base import BaseCommand
from django.db.migrations.executor import MigrationExecutor
from django.db import connections, DEFAULT_DB_ALIAS


class Command(BaseCommand):
    """Block execution until ``MigrationExecutor`` reports an empty migration plan.

    CLI signature:
        ``python manage.py wait_for_migrations``

    Side effects:
        Polls the default DB's migration plan every 10 seconds. The plan is computed
        via ``MigrationExecutor(connection).migration_plan(leaf_targets)``; the loop
        exits once the plan is empty.

    Idempotency:
        Idempotent -- invocation has no persistent effect; it merely blocks.

    Trigger context:
        Container-orchestration startup gate that implements the architectural
        contract recorded in the project AAP §0.2.2: the ``migrator`` container
        runs ``python manage.py migrate`` before any API / worker / beat container
        is permitted to start. Worker and beat containers run this script in their
        entrypoint so they always see a fully migrated schema before serving traffic
        or consuming tasks.
    """

    help = "Wait for database migrations to complete before starting Celery worker/beat"

    def handle(self, *args, **kwargs):
        """Poll ``_pending_migrations`` every 10 seconds until the plan is empty."""
        while self._pending_migrations():
            self.stdout.write("Waiting for database migrations to complete...")
            time.sleep(10)  # wait for 10 seconds before checking again

        self.stdout.write(self.style.SUCCESS("No migrations Pending. Starting processes ..."))

    def _pending_migrations(self):
        connection = connections[DEFAULT_DB_ALIAS]
        executor = MigrationExecutor(connection)
        targets = executor.loader.graph.leaf_nodes()
        return bool(executor.migration_plan(targets))
