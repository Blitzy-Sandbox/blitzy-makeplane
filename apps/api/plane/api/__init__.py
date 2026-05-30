# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""External ``/api/v1/`` REST surface for Plane.

This package exposes the API-key-authenticated REST endpoints mounted at
``/api/v1/`` from ``plane.urls`` and is distinct from :mod:`plane.app`,
which serves the session-authenticated web client over the same workspace
and project entities. Sub-packages provide the views (:mod:`plane.api.views`),
serializers (:mod:`plane.api.serializers`), URL routes (:mod:`plane.api.urls`),
throttling rules (:mod:`plane.api.rate_limit`), and ``X-Api-Key`` authentication
middleware (see :class:`plane.api.middleware.api_authentication.APIKeyAuthentication`)
that together form the public programmatic API.
"""
