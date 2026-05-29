# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Canonical numeric error codes for structured API error responses.

Clients branch on these integers rather than free-text error messages.
Codes are append-only — never reused after retirement and never renumbered;
UI clients (``apps/web``, ``apps/space``) depend on the integer values.

Range conventions:
  - ``4000-4099`` — issue field validation errors.
  - ``4100-4199`` — issue date / cycle validation errors.
  - ``4700-4799`` — page state errors.

Current codes (see :data:`ERROR_CODES` below for the authoritative mapping):
  - ``INVALID_ARCHIVE_STATE_GROUP``  = 4091
  - ``INVALID_ISSUE_DATES``          = 4100
  - ``INVALID_ISSUE_START_DATE``     = 4101
  - ``INVALID_ISSUE_TARGET_DATE``    = 4102
  - ``PAGE_LOCKED``                  = 4701
  - ``PAGE_ARCHIVED``                = 4702

Consumers: ``plane.app.views.issue.*`` and ``plane.app.views.page.*``
emit these codes in their structured error responses.
"""

ERROR_CODES = {
    # issues
    "INVALID_ARCHIVE_STATE_GROUP": 4091,
    "INVALID_ISSUE_DATES": 4100,
    "INVALID_ISSUE_START_DATE": 4101,
    "INVALID_ISSUE_TARGET_DATE": 4102,
    # pages
    "PAGE_LOCKED": 4701,
    "PAGE_ARCHIVED": 4702,
}
