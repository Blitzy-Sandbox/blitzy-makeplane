# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL routing for the ``plane.web`` Django app.

This URLconf is included at the project root (``""``) by
``apps/api/plane/urls.py``, so its routes are mounted at the top of the host:
``/`` resolves to ``health_check`` (liveness probe used by load balancers and
container orchestrators) and ``/robots.txt`` resolves to ``robots_txt`` (search
engine crawler policy). ``urlpatterns`` is evaluated at import time; the
routing surface is static and contains no dynamic dispatch.
"""

from django.urls import path
from plane.web.views import robots_txt, health_check

urlpatterns = [path("robots.txt", robots_txt), path("", health_check)]
