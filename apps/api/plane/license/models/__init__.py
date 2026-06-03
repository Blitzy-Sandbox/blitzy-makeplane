# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Plane license models package; re-exports `Instance`, `InstanceAdmin`, `InstanceConfiguration`, `InstanceEdition`.

This module is the package marker for the Plane license ORM models. The
re-exports below stabilize the public import surface so downstream callers
can write ``from plane.license.models import Instance`` rather than reaching
into the implementation module at ``plane.license.models.instance``.

The four database tables backing these models (``instances``,
``instance_admins``, ``instance_configurations``, ``changelogs``) are created
by the migrations under ``plane/license/migrations/``. The ``migrator``
container applies those migrations before any service that imports this
package starts, so importing this module assumes the schema is already at the
current version.

Note: ``ChangeLog`` is defined in ``instance.py`` but is intentionally not
re-exported at the package level; consumers that need it must import it from
the implementation module directly.
"""

from .instance import Instance, InstanceAdmin, InstanceConfiguration, InstanceEdition
