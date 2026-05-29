# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""UUID validation and 64-bit-int conversion.

Two utilities:

  - :func:`is_valid_uuid`           — strict UUIDv4 syntactic check; rejects
    v1/v3/v5 even if syntactically valid.
  - :func:`convert_uuid_to_integer` — deterministic SHA-256-based mapping of
    a UUID to a 64-bit signed integer for downstream consumers that need a
    stable bigint key (PostgreSQL advisory locks, external integrations).

Note: :func:`convert_uuid_to_integer` is NOT cryptographically secure —
collisions are statistically improbable but not impossible; do not use as a
primary key or security token.
"""

# Python imports
import uuid
import hashlib


def is_valid_uuid(uuid_str):
    """Return True if ``uuid_str`` is a syntactically valid UUIDv4 string.

    Rejects v1/v3/v5 UUIDs even if they are syntactically valid, so callers
    that require Plane's canonical UUIDv4 PK format have a strict predicate.
    """
    try:
        uuid_obj = uuid.UUID(uuid_str)
        return uuid_obj.version == 4
    except ValueError:
        return False


def convert_uuid_to_integer(uuid_val: uuid.UUID) -> int:
    """Deterministically map a UUID string to a 64-bit signed integer.

    Used for PostgreSQL advisory locks and external integrations that need a
    stable bigint key derived from a UUID PK. Implementation: SHA-256 of the
    UUID string, first 8 bytes interpreted as a signed bigint.

    NOT cryptographically secure — collisions are statistically improbable
    but not impossible.
    """
    # Ensure UUID is a string
    uuid_value: str = str(uuid_val)
    # Hash to 64-bit signed int
    h: bytes = hashlib.sha256(uuid_value.encode()).digest()
    bigint: int = int.from_bytes(h[:8], byteorder="big", signed=True)
    return bigint
