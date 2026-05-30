# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""Django management command to flush the Redis-backed Django cache."""

# Django imports
from django.core.cache import cache
from django.core.management import BaseCommand


class Command(BaseCommand):
    """Flush the entire Django cache or a single key from the Redis cache backend.

    CLI signature:
        ``python manage.py clear_cache [--key <cache_key>]``

    Side effects:
        Calls ``django.core.cache.cache.delete(key)`` when ``--key`` is provided;
        otherwise calls ``cache.clear()``. The cache backend in this project is Redis;
        Redis serves caching and sessions only — task queueing is handled by Celery
        via RabbitMQ in ``plane.bgtasks``.

    Idempotency:
        Idempotent — clearing an already-empty key or an already-empty cache is a no-op.
    """

    help = "Clear Cache before starting the server to remove stale values"

    def add_arguments(self, parser):
        """Register the optional ``--key`` argument that targets a single cache entry."""
        # Positional argument
        parser.add_argument("--key", type=str, nargs="?", help="Key to clear cache")

    def handle(self, *args, **options):
        """Delete a single cache entry when ``--key`` is provided; otherwise flush the whole cache."""
        try:
            if options["key"]:
                cache.delete(options["key"])
                self.stdout.write(self.style.SUCCESS(f"Cache Cleared for key: {options['key']}"))
                return

            cache.clear()
            self.stdout.write(self.style.SUCCESS("Cache Cleared"))
            return
        except Exception:
            # Another ClientError occurred
            self.stdout.write(self.style.ERROR("Failed to clear cache"))
            return
