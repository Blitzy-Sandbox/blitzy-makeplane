# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL routing for the cached timezone enumeration endpoint.

Maps the ``TimezoneEndpoint`` from ``plane.app.views`` to the
top-level ``timezones/`` route consumed by the web client for
timezone selection.
"""

from django.urls import path

from plane.app.views import TimezoneEndpoint

urlpatterns = [
    # timezone endpoint
    path("timezones/", TimezoneEndpoint.as_view(), name="timezone-list")
]
