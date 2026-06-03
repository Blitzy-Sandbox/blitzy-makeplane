# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Middleware namespace for the Plane authentication subsystem.

Houses the custom request/response middleware that participates in Django's
middleware chain on behalf of the authentication app. The single substantive
module is :mod:`.session`, which defines a custom :class:`SessionMiddleware`
supporting two cookie axes (standard user session vs. admin instance
session) via :meth:`process_request` and :meth:`process_response`.

This package deliberately re-exports nothing; consumers import directly from
the submodule (the project's ``MIDDLEWARE`` setting references
``plane.authentication.middleware.session.SessionMiddleware`` by its full
dotted path — see ``apps/api/plane/settings/common.py:107``).
"""
