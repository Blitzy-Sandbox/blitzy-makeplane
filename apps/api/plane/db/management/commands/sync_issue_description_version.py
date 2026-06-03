# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django management command to enqueue a Celery backfill of ``IssueDescriptionVersion`` rows."""

# Django imports
from django.core.management.base import BaseCommand

# Module imports
from plane.bgtasks.issue_description_version_sync import (
    schedule_issue_description_version,
)


class Command(BaseCommand):
    """Prompt for batch parameters and enqueue an asynchronous backfill of ``IssueDescriptionVersion`` rows.

    CLI signature:
        ``python manage.py sync_issue_description_version``
        (Prompts interactively for ``batch_size`` and ``batch_countdown``.)

    Side effects:
        Enqueues a single Celery task via
        ``plane.bgtasks.issue_description_version_sync.schedule_issue_description_version.delay``.
        Celery is brokered by RabbitMQ in this deployment; Redis is used only for
        caching and sessions, never as a task broker.

    Idempotency:
        The command itself is idempotent (only enqueues one task per run); the
        downstream task's idempotency is documented in
        ``plane.bgtasks.issue_description_version_sync``.

    Trigger context:
        Operator-invoked manual backfill, typically used once after a schema
        migration that introduced the ``IssueDescriptionVersion`` table.
    """

    help = "Creates IssueDescriptionVersion records for existing Issues in batches"

    def handle(self, *args, **options):
        """Collect batch parameters from the console and dispatch the Celery scheduling task."""
        batch_size = input("Enter the batch size: ")
        batch_countdown = input("Enter the batch countdown: ")

        schedule_issue_description_version.delay(batch_size=batch_size, countdown=int(batch_countdown))

        self.stdout.write(self.style.SUCCESS("Successfully created issue description version task"))
