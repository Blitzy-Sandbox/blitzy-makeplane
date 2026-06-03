# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""API-key authentication middleware package for the Plane DRF web-client API.

Hosts the custom DRF authentication backend that resolves ``X-Api-Key``
headers to authenticated ``(user, token)`` tuples.
"""
