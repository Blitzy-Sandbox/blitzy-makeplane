# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Instance-configuration metadata catalog (package aggregator).

Combines the metadata declared in :mod:`.core` and :mod:`.extended` into
``instance_config_variables`` — the unified package-level list consumed by
the ``configure_instance`` management command
(:mod:`plane.license.management.commands.configure_instance`), the admin-UI
configuration endpoints, and downstream seed/validation routines. The merge
runs at import time and preserves declaration order so every core entry
precedes every extended entry.

Persistence layer (per AAP §0.13.2): entries flagged ``is_encrypted=True``
are Fernet-encrypted (key derived from Django's ``SECRET_KEY`` via
PBKDF2-HMAC-SHA256, see :mod:`plane.license.utils.encryption`) before being
stored in :class:`plane.license.models.InstanceConfiguration` (table
``instance_configurations``). Non-encrypted entries are stored as plaintext.

Migrator startup contract (per AAP §0.2.2): the migrator container runs
Django migrations before API services start, so the ``instance_configurations``
table is guaranteed to exist before any consumer of this catalog runs.
"""

from .core import core_config_variables
from .extended import extended_config_variables

instance_config_variables = [*core_config_variables, *extended_config_variables]
