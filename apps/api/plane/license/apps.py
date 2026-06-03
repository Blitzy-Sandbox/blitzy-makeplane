# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django AppConfig declaration for the Plane license / instance subsystem.

Registers ``plane.license`` with Django's application registry so its models
(``Instance``, ``InstanceAdmin``, ``InstanceConfiguration``, ``ChangeLog``),
migrations, and management commands are discovered at startup.

Startup contract: the ``migrator`` container runs Django migrations for this
app before any web/worker service starts (per AAP §0.2.2), so consumers can
assume the ``instances``/``instance_admins``/``instance_configurations``/
``changelogs`` tables exist when this AppConfig becomes ``ready``.
"""

from django.apps import AppConfig


class LicenseConfig(AppConfig):
    """Django ``AppConfig`` for the license/instance management subsystem.

    Identified by ``name = "plane.license"``; backs the routes mounted under
    ``api/instances/`` in the root URLconf.
    """

    name = "plane.license"
