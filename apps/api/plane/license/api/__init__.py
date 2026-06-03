# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Package marker for the Plane license DRF API surface (permissions, views, serializers).

Subpackages:
    - ``permissions/`` — DRF ``BasePermission`` subclasses gating instance-admin access
      (see ``permissions.InstanceAdminPermission``).
    - ``views/`` — DRF ``APIView`` subclasses backing the routes registered in
      ``apps/api/plane/license/urls.py`` (instance bootstrap, admin sign-in/up/out,
      configuration management, workspace listing/creation).
    - ``serializers/`` — DRF ``ModelSerializer`` subclasses for ``Instance``,
      ``InstanceAdmin``, ``InstanceConfiguration``, and ``Workspace`` payloads,
      including transparent Fernet decryption for encrypted configuration values.

Startup contract (per AAP §0.2.2): every view in this package assumes the
``Instance``, ``InstanceAdmin``, and ``InstanceConfiguration`` tables exist
because the ``migrator`` container applies this app's Django migrations before
the API service starts.
"""
