# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Package marker for the Plane license / instance-management subsystem.

This Django app owns identity and operational state for self-hosted Plane
deployments: the singleton ``Instance`` record, instance administrators,
Fernet-encrypted ``InstanceConfiguration`` rows, and the ``ChangeLog`` release
history. Its routes are mounted under ``api/instances/`` by the root URLconf.

Layout:
    - ``apps.py``       — Django ``AppConfig`` (``plane.license``)
    - ``urls.py``       — URL routes for ``api/instances/``
    - ``api/``          — DRF permissions, views, and serializers
    - ``models/``       — Django ORM models (``Instance``, ``InstanceAdmin``,
                          ``InstanceConfiguration``, ``ChangeLog``)
    - ``utils/``        — Fernet-based encryption + configuration resolution
    - ``bgtasks/``      — Celery telemetry tasks (e.g. ``instance_traces``)
    - ``management/``   — Django management commands for bootstrap/configure
    - ``migrations/``   — Django schema evolution

Startup contract (per AAP §0.2.2): the ``migrator`` container applies this
app's migrations before any web or worker service starts, so consumers can
assume the license tables exist at import time.
"""
