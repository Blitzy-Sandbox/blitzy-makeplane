# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Package marker for the ``plane.license`` Django management command modules.

Django's management-command discovery requires this directory to be a Python
package (``<app>/management/commands/<name>.py`` convention). Each ``.py``
file alongside this marker becomes an invocable ``manage.py <name>`` command.

Concrete commands:
    - ``register_instance.py`` — register/refresh the singleton ``Instance``
      row and enqueue the ``instance_traces`` Celery task.
    - ``configure_instance.py`` — seed ``InstanceConfiguration`` rows from
      environment variables (Fernet-encrypted where ``is_encrypted=True``).
"""
