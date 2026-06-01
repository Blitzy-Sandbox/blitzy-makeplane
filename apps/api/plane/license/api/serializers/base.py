# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Shared base serializer for the license API.

Provides ``BaseSerializer``, the parent class for license-API
``ModelSerializer`` subclasses that need a consistent read-only ``id``
field convention.
"""

from rest_framework import serializers


class BaseSerializer(serializers.ModelSerializer):
    """``ModelSerializer`` parent declaring a read-only primary key field.

    Subclasses inherit a read-only ``id`` rendered as a
    ``PrimaryKeyRelatedField`` so that clients can read identifiers in
    responses but cannot write them through input payloads — preserving
    the convention that database PKs are server-assigned.

    Subclassed locally by ``UserLiteSerializer``,
    ``InstanceConfigurationSerializer``, ``InstanceAdminMeSerializer``,
    ``InstanceAdminSerializer``, and ``WorkspaceSerializer``.
    ``InstanceSerializer`` instead extends the app-level
    :class:`plane.app.serializers.BaseSerializer`.
    """

    id = serializers.PrimaryKeyRelatedField(read_only=True)
