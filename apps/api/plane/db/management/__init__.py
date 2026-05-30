# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django management-command package for the ``plane.db`` app.

Marks ``plane.db.management`` as a Python package so Django's command
discovery mechanism can locate the individual operator-facing commands in
the sibling ``commands/`` directory. This module deliberately contains no
runtime logic, imports, or exports.
"""
