# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""``InstanceConfiguration`` serializer with at-read Fernet decryption.

Defines ``InstanceConfigurationSerializer``, the boundary between
encrypted-at-rest ``InstanceConfiguration.value`` storage and plaintext
output for authorized admin consumers. Decryption is performed in
:meth:`InstanceConfigurationSerializer.to_representation` using
:func:`plane.license.utils.encryption.decrypt_data`.

Security contract: encrypted configuration values are intentionally
returned as plaintext from this serializer because the consuming
endpoints under :mod:`plane.license.api.views` are gated by
``InstanceAdminPermission``; ciphertext is never useful to API callers.
This serializer must NOT be wired into any non-admin surface.
"""

from .base import BaseSerializer
from plane.license.models import InstanceConfiguration
from plane.license.utils.encryption import decrypt_data


class InstanceConfigurationSerializer(BaseSerializer):
    """``InstanceConfiguration`` serializer that decrypts values on read.

    Bound model: :class:`plane.license.models.InstanceConfiguration`
    (key/value rows holding deployment-level configuration).

    Fields: ``"__all__"`` — every column is serialized verbatim, except
    ``value`` is transformed on read when ``is_encrypted`` is true (see
    :meth:`to_representation`).

    This class is the SINGLE point at which Fernet-encrypted values
    become plaintext for API consumers — encryption at rest is the
    storage contract; plaintext on read is the admin-API contract.
    """

    class Meta:
        """DRF serializer configuration binding ``InstanceConfiguration`` with every field exposed."""

        model = InstanceConfiguration
        fields = "__all__"

    def to_representation(self, instance):
        """Return the serialized row, decrypting ``value`` if encrypted.

        When ``instance.is_encrypted`` is true and ``instance.value`` is
        non-empty, the serialized ``value`` is replaced with the plaintext
        returned by :func:`plane.license.utils.encryption.decrypt_data`.
        Rows that are not marked encrypted, or whose stored value is
        ``None``, pass through unchanged.
        """
        data = super().to_representation(instance)
        # Decrypt secrets value
        if instance.is_encrypted and instance.value is not None:
            data["value"] = decrypt_data(instance.value)

        return data
