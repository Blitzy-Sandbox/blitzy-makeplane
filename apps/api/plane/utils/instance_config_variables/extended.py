# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Extended instance-configuration variable metadata.

Provides ``extended_config_variables`` — a stable, mutable module-level
registry for optional or deployment-specific configuration entries
(third-party connectors, premium integrations, plugin-supplied settings)
that supplement the core catalog declared in :mod:`.core`.

The list is intentionally EMPTY in the open-source distribution and acts
as a registration hook: downstream builds, plugins, or in-process
registration routines may append dict entries (same four-key schema as
:mod:`.core` — ``key``/``value``/``category``/``is_encrypted``) before
:data:`plane.utils.instance_config_variables.instance_config_variables`
is consumed by the ``configure_instance`` management command.

Merge order: the package ``__init__`` concatenates
``core_config_variables`` followed by ``extended_config_variables``, so
any extended entry appears AFTER all core entries in
``instance_config_variables``.

Encryption semantics mirror :mod:`.core`: entries with
``is_encrypted=True`` are Fernet-encrypted (key derived from Django's
``SECRET_KEY``, see :mod:`plane.license.utils.encryption`) before
persistence in :class:`plane.license.models.InstanceConfiguration`.

Migrator startup contract (per AAP §0.2.2): the
``instance_configurations`` table is created by the migrator container
before API services start, so seed routines that iterate this list at
boot can assume the schema exists.
"""

extended_config_variables = []
