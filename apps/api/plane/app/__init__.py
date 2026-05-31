# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Core DRF API application package for the Plane Django backend.

Serves as the integration boundary for Django app registration (``apps.py``),
HTTP presentation (``views/``), request authentication (``middleware/``),
authorization (``permissions/``), routing (``urls/``), and serialization
(``serializers/``). The package itself contains no executable code or
imports, so importing ``plane.app`` has no runtime side effects.
"""
