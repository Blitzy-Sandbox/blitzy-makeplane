# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Package marker for the Plane license Django management commands.

Django discovers management commands via the ``<app>/management/commands/<name>.py``
convention, so this directory exists solely to mark
``plane.license.management`` as a Python package; the executable commands
live in the ``commands/`` subpackage.

Available commands (see ``commands/``):
    - ``register_instance`` — registers or refreshes the singleton ``Instance``
      row and enqueues the ``instance_traces`` Celery task.
    - ``configure_instance`` — seeds ``InstanceConfiguration`` rows from
      environment variables (Fernet-encrypted at rest where ``is_encrypted=True``).

Startup contract (per AAP §0.2.2): both commands depend on the ``instances``
and ``instance_configurations`` tables, so they MUST run after the
``migrator`` container has applied this app's migrations.
"""
