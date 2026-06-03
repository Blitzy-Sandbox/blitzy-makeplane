# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Public serializer surface for the license API.

Re-exports the license-related serializer classes from sibling modules
so that callers can import them from ``plane.license.api.serializers``
without needing to know each class's source module.

Re-exported classes:
    - ``InstanceSerializer`` (from :mod:`.instance`)
    - ``InstanceConfigurationSerializer`` (from :mod:`.configuration`)
    - ``InstanceAdminSerializer``, ``InstanceAdminMeSerializer`` (from :mod:`.admin`)
    - ``WorkspaceSerializer`` (from :mod:`.workspace`)

Consumed by view modules under :mod:`plane.license.api.views`.
"""

from .instance import InstanceSerializer

from .configuration import InstanceConfigurationSerializer
from .admin import InstanceAdminSerializer, InstanceAdminMeSerializer
from .workspace import WorkspaceSerializer
