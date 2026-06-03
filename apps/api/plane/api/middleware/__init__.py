# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Authentication middleware package for the ``/api/v1/`` external REST surface.

Houses :class:`plane.api.middleware.api_authentication.APIKeyAuthentication`,
the DRF authentication backend that validates the ``X-Api-Key`` header for
every request to ``plane.api.views``. This is the distinguishing feature of
the external API surface versus the session-cookie-authenticated
``plane.app`` surface.
"""
