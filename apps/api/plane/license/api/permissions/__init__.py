# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Re-export facade for the license API authorization permission classes.

Exposes `InstanceAdminPermission` so callers can write
``from plane.license.api.permissions import InstanceAdminPermission`` without
referencing the implementation module directly. The exported class is the
default permission gate consumed by `BaseAPIView.permission_classes` in
`plane.license.api.views.base`, so almost every license API endpoint
delegates to it.
"""

from .instance import InstanceAdminPermission
