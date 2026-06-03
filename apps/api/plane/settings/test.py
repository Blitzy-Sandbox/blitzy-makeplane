# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Test overlay applied via DJANGO_SETTINGS_MODULE=plane.settings.test.

Imports the shared baseline from :mod:`plane.settings.common` and applies
test-only overrides: keeps ``DEBUG=True`` so failures surface stack
traces, switches the email backend to Django's in-memory ``locmem``
outbox so assertions in :mod:`plane.tests` can inspect captured messages
without contacting SMTP, and appends ``plane.tests`` to ``INSTALLED_APPS``
so test-only models, fixtures, and management commands are discovered by
the test runner.

Database, cache, queue, and storage settings inherit from common. Tests
that need to isolate from external services (Redis, RabbitMQ, S3) patch
those collaborators in their own fixtures (see
``apps/api/plane/tests/conftest_external.py``).

Module-level side effect: ``INSTALLED_APPS.append("plane.tests")`` mutates
the list imported from common; this is the canonical way to opt a test
package into Django app discovery without re-declaring the full list.

Migrator startup contract: like every settings overlay, this module is
evaluated before the ``migrator`` container runs Django migrations, so
nothing here may import models or query the database at import time.
"""

from .common import *  # noqa

DEBUG = True

# Send it in a dummy outbox
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

INSTALLED_APPS.append(  # noqa
    "plane.tests"
)
