# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django management command that registers (or refreshes) the singleton Plane ``Instance`` record.

Invocation:
    ``python manage.py register_instance <machine_signature>``

Bootstrap flow:
    1. Read the positional ``machine_signature`` argument supplied by
       deployment tooling.
    2. Derive ``current_version`` from the ``APP_VERSION`` env var, falling
       back to the ``version`` key in ``package.json``, then to the
       hard-coded ``"v0.1.0"``.
    3. Fetch ``latest_version`` from
       ``https://api.github.com/repos/makeplane/plane/releases/latest``
       (10-second timeout; falls back to ``current_version`` on any error).
    4. Generate an ``instance_id`` via ``secrets.token_hex(12)``
       (24-character hex identifier) on first bootstrap only.
    5. Create-or-update the singleton ``Instance`` row.
    6. Enqueue the ``instance_traces`` Celery task via ``.delay()``.

Idempotency:
    Re-running this command on a deployment with an existing ``Instance``
    row UPDATES the existing row's ``last_checked_at``, ``current_version``,
    ``latest_version``, ``is_test``, and ``edition`` fields - it does NOT
    create a duplicate row. Safe to invoke repeatedly.

Async infrastructure (per architectural context):
    ``instance_traces.delay()`` enqueues a task through Celery, which
    consumes from RabbitMQ. Redis in Plane is used for caching and session
    storage only, NOT for task queueing.

Startup contract (per architectural context):
    The ``migrator`` container MUST have applied the license app's
    migrations before this command runs, because it reads from and writes
    to the ``instances`` table.
"""

# Python imports
import json
import secrets
import os
import requests

# Django imports
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone


# Module imports
from plane.license.models import Instance, InstanceEdition
from plane.license.bgtasks.tracer import instance_traces


class Command(BaseCommand):
    """Bootstrap or refresh the singleton Plane ``Instance`` row.

    Invocation:
        ``python manage.py register_instance <machine_signature>``

    Required positional argument:
        ``machine_signature`` (str): Deployment-tooling-supplied identifier
        that binds the running machine to the singleton ``Instance`` row.
        Raises ``CommandError`` if missing on a fresh install (no existing
        ``Instance`` row).

    Side effects (DB):
        - First invocation (no ``Instance`` row): creates the singleton row
          with ``instance_name="Plane Community Edition"``, hex-token
          ``instance_id`` (via ``secrets.token_hex(12)``), current/latest
          version metadata, ``last_checked_at=now``,
          ``is_test=(IS_TEST env == "1")``,
          ``edition=InstanceEdition.PLANE_COMMUNITY.value``.
        - Subsequent invocations (Instance exists): updates
          ``last_checked_at``, ``current_version``, ``latest_version``,
          ``is_test``, ``edition`` on the existing row.

    Side effects (queue):
        Unconditionally enqueues ``instance_traces.delay()`` (Celery via
        RabbitMQ) at the end of either branch. The ``instance_traces`` task
        emits OpenTelemetry instance/workspace counts when telemetry is
        enabled.

    External calls:
        ``GET https://api.github.com/repos/makeplane/plane/releases/latest``
        with a 10-second timeout; on failure logs a warning to stdout and
        falls back to ``current_version``.

    Environment variables read:
        - ``APP_VERSION`` (optional) - overrides the version derived from
          ``package.json``.
        - ``IS_TEST`` (optional) - set to ``"1"`` to mark this installation
          as a test instance.
    """

    help = "Check if instance in registered else register"

    def add_arguments(self, parser):
        """Register the positional ``machine_signature`` CLI argument.

        The ``machine_signature`` (str, required) is supplied by deployment
        tooling and is used to bind this physical/virtual machine to the
        singleton ``Instance`` row on first bootstrap.
        """
        # Positional argument
        parser.add_argument("machine_signature", type=str, help="Machine signature")

    def check_for_current_version(self):
        """Resolve the current Plane version from environment or ``package.json``.

        Precedence:
            1. ``APP_VERSION`` env var if set.
            2. ``version`` key in ``package.json`` in the current working
               directory.
            3. Hard-coded ``"v0.1.0"`` fallback.

        Failure handling:
            Catches all exceptions when reading ``package.json`` and returns
            ``"v0.1.0"`` with a stdout warning. Does NOT raise - this
            preserves bootstrap robustness even when ``package.json`` is
            absent (e.g., in container images that ship only the API code).
        """
        if os.environ.get("APP_VERSION", False):
            return os.environ.get("APP_VERSION")

        try:
            with open("package.json", "r") as file:
                data = json.load(file)
                return data.get("version", "v0.1.0")
        except Exception:
            self.stdout.write("Error checking for current version")
            return "v0.1.0"

    def check_for_latest_version(self, fallback_version):
        """Query the GitHub Releases API for the latest Plane tag.

        Makes a 10-second-timeout ``GET`` to
        ``https://api.github.com/repos/makeplane/plane/releases/latest`` and
        returns the ``tag_name`` field on success.

        Failure handling:
            Catches all exceptions (network failure, HTTP error, JSON parse
            error) and returns ``fallback_version`` with a stdout warning.
            Does NOT raise - the GitHub API is treated as a best-effort
            metadata source, never a hard dependency.

        Args:
            fallback_version: Value to return when the API call fails.

        Returns:
            The latest Plane release tag from GitHub, or
            ``fallback_version`` on any error.
        """
        try:
            response = requests.get(
                "https://api.github.com/repos/makeplane/plane/releases/latest",
                timeout=10,
            )
            response.raise_for_status()
            data = response.json()
            return data.get("tag_name", fallback_version)
        except Exception:
            self.stdout.write("Error checking for latest version")
            return fallback_version

    def handle(self, *args, **options):
        """Bootstrap or refresh the singleton ``Instance`` row and enqueue ``instance_traces``.

        Branch 1 - no existing ``Instance``:
            Requires non-empty ``machine_signature``; raises ``CommandError``
            if absent. Creates the singleton ``Instance`` row with
            ``instance_name="Plane Community Edition"``, ``instance_id``
            generated via ``secrets.token_hex(12)`` (a 24-character hex
            identifier persisted for the lifetime of the deployment),
            ``current_version``, ``latest_version``, ``last_checked_at=now``,
            ``is_test``, and ``edition``.

        Branch 2 - existing ``Instance``:
            Updates ``last_checked_at``, ``current_version``,
            ``latest_version``, ``is_test``, and ``edition`` on the existing
            row in place; does NOT create a duplicate.

        Idempotency:
            Safe to re-run. Subsequent invocations refresh metadata on the
            same singleton row.

        Side effect (always):
            Calls ``instance_traces.delay()`` at the end regardless of which
            branch executed. The Celery task is queued via RabbitMQ
            (Plane's task broker); Redis is used for caching/session only.
        """
        # Check if the instance is registered
        instance = Instance.objects.first()

        current_version = self.check_for_current_version()
        latest_version = self.check_for_latest_version(current_version)

        # If instance is None then register this instance
        if instance is None:
            machine_signature = options.get("machine_signature", "machine-signature")

            if not machine_signature:
                raise CommandError("Machine signature is required")

            instance = Instance.objects.create(
                instance_name="Plane Community Edition",
                instance_id=secrets.token_hex(12),
                current_version=current_version,
                latest_version=latest_version,
                last_checked_at=timezone.now(),
                is_test=os.environ.get("IS_TEST", "0") == "1",
                edition=InstanceEdition.PLANE_COMMUNITY.value,
            )

            self.stdout.write(self.style.SUCCESS("Instance registered"))
        else:
            self.stdout.write(self.style.SUCCESS("Instance already registered"))

            # Update the instance details
            instance.last_checked_at = timezone.now()
            instance.current_version = current_version
            instance.latest_version = latest_version
            instance.is_test = os.environ.get("IS_TEST", "0") == "1"
            instance.edition = InstanceEdition.PLANE_COMMUNITY.value
            instance.save()

        # Call the instance traces task
        instance_traces.delay()

        return
