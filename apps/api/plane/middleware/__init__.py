# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Project-level Django middleware for the Plane API.

Houses the cross-cutting request-pipeline classes registered in
``apps/api/plane/settings/common.py`` MIDDLEWARE: read-replica routing
(``db_routing.ReadReplicaRoutingMiddleware``), request and external
API-key logging (``logger.RequestLoggerMiddleware``,
``logger.APITokenLogMiddleware``), and oversized-body protection
(``request_body_size.RequestBodySizeLimitMiddleware``). The
``apps.Middleware`` ``AppConfig`` registers this directory as a
Django app under the dotted label ``plane.middleware``.
"""
