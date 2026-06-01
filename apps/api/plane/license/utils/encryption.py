# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Deterministic Fernet symmetric encryption derived from Django's ``SECRET_KEY``.

This module is the **security contract** for :class:`InstanceConfiguration` rows
where ``is_encrypted=True``. The Fernet key is derived deterministically from
``settings.SECRET_KEY`` via PBKDF2-HMAC-SHA256 with a hard-coded salt
(``b"salt"``) and 100,000 iterations -- therefore **rotating ``SECRET_KEY`` will
make every existing encrypted value undecryptable**, because no historical key
material is retained.

The helpers are **fail-soft**: any exception during key derivation, encryption,
or decryption is forwarded to :func:`plane.utils.exception_logger.log_exception`
and the function returns the empty string instead of raising. This preserves
backend liveness at the cost of silent data loss on corrupt input -- callers
that need a hard error must check for empty return explicitly.

Consumed by :func:`plane.license.utils.instance_value.get_configuration_value`
on the read path and by the ``configure_instance`` management command on the
write path.
"""

import base64
import hashlib
from django.conf import settings
from cryptography.fernet import Fernet

from plane.utils.exception_logger import log_exception


def derive_key(secret_key):
    """Derive a Fernet-compatible URL-safe Base64 key from an arbitrary secret string.

    Uses PBKDF2-HMAC-SHA256 with a hard-coded salt (``b"salt"``) and 100,000
    iterations. The salt is intentionally fixed -- rotating it would invalidate
    every previously encrypted value, which the surrounding system does not
    support.

    Args:
        secret_key: Arbitrary string, typically ``settings.SECRET_KEY``.

    Returns:
        bytes: URL-safe Base64-encoded 32-byte derived key, suitable for the
        :class:`cryptography.fernet.Fernet` constructor.
    """
    dk = hashlib.pbkdf2_hmac("sha256", secret_key.encode(), b"salt", 100000)
    return base64.urlsafe_b64encode(dk)


def encrypt_data(data):
    """Encrypt a plaintext string into a Fernet token for storage.

    Used as the write half of the :class:`InstanceConfiguration`
    ``is_encrypted=True`` contract. Empty input fast-paths to an empty return.
    On any internal failure (typically a missing or malformed
    ``settings.SECRET_KEY``), the exception is logged via
    :func:`log_exception` and an empty string is returned -- the caller is
    expected to handle the empty-string sentinel.

    Args:
        data: Plaintext string to encrypt.

    Returns:
        str: Fernet token (URL-safe Base64) on success, or ``""`` on empty
        input or internal failure.
    """
    try:
        if data:
            cipher_suite = Fernet(derive_key(settings.SECRET_KEY))
            encrypted_data = cipher_suite.encrypt(data.encode())
            return encrypted_data.decode()  # Convert bytes to string
        else:
            return ""
    except Exception as e:
        log_exception(e)
        return ""


def decrypt_data(encrypted_data):
    """Decrypt a Fernet ciphertext back to plaintext.

    Used as the read half of the :class:`InstanceConfiguration`
    ``is_encrypted=True`` contract. Empty input fast-paths to an empty return.
    On any internal failure (corrupt token, key mismatch after ``SECRET_KEY``
    rotation, etc.), the exception is logged via :func:`log_exception` and an
    empty string is returned -- the caller is expected to handle the
    empty-string sentinel.

    Args:
        encrypted_data: Fernet token string previously produced by
            :func:`encrypt_data` (or by ``configure_instance`` management
            command).

    Returns:
        str: Decrypted plaintext on success, or ``""`` on empty input or
        internal failure.
    """
    try:
        if encrypted_data:
            cipher_suite = Fernet(derive_key(settings.SECRET_KEY))
            decrypted_data = cipher_suite.decrypt(encrypted_data.encode())  # Convert string back to bytes
            return decrypted_data.decode()
        else:
            return ""
    except Exception as e:
        log_exception(e)
        return ""
