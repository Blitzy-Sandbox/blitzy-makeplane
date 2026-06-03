# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Public web-facing endpoints for the ``plane.web`` Django sub-application.

Implements two anonymous, stateless, database-free endpoints mounted at the
project root by ``plane.web.urls``:

  - ``health_check`` (``/``)         — liveness probe for load balancers and
    container orchestrators (Kubernetes, Docker Compose, ECS, etc.)
  - ``robots_txt`` (``/robots.txt``) — crawler policy returning a global
    disallow rule

Both views are plain Django function views (NOT DRF), so they inherit no
authentication or permission classes — effectively ``AllowAny``. Neither view
performs any ORM, cache, or I/O work, which is intentional for ``health_check``
so it can serve liveness probes even before the ``migrator`` container
completes Django migrations (per architectural rule in AAP §0.2.2).
"""

from django.http import HttpResponse, JsonResponse


def health_check(request):
    """Return a static ``{"status": "OK"}`` JSON response for liveness probes.

    HTTP method:
        GET (no method restriction is applied; any verb returns the same body).

    URL pattern:
        ``/`` — mounted by ``plane.web.urls`` and included at the project
        root by ``apps/api/plane/urls.py``.

    Response:
        ``200 OK`` with ``Content-Type: application/json`` and body
        ``{"status": "OK"}``.

    Permission:
        ``AllowAny`` (anonymous; no authentication or permission classes).

    Consumers:
        Load balancers, container orchestrators (Kubernetes, Docker Compose),
        and uptime monitors.

    Migrator-bypass contract (per AAP §0.2.2): this view performs NO database
    access — it intentionally returns a static payload so it can answer
    liveness probes even before the ``migrator`` container finishes running
    Django migrations.
    """
    return JsonResponse({"status": "OK"})


def robots_txt(request):
    r"""Return a global crawler-disallow ``robots.txt`` body.

    HTTP method:
        GET (no method restriction is applied).

    URL pattern:
        ``/robots.txt`` — mounted by ``plane.web.urls`` and included at the
        project root by ``apps/api/plane/urls.py``.

    Response:
        ``200 OK`` with ``Content-Type: text/plain`` and body
        ``"User-agent: *\nDisallow: /"`` (every crawler is disallowed from
        every path on this host).

    Permission:
        ``AllowAny`` (anonymous; no authentication or permission classes).

    Consumers:
        Search engine crawlers (Googlebot, Bingbot, and other ``User-agent``
        identifiers).
    """
    return HttpResponse("User-agent: *\nDisallow: /", content_type="text/plain")
