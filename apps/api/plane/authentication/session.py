# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""DRF session authentication for the Plane API.

Exposes a :class:`SessionAuthentication` subclass that enforces DRF's
built-in CSRF protection on every session-authenticated REST API request.
Browser clients obtain the CSRF token via the dedicated CSRF-token endpoint
(see ``CSRFTokenEndpoint`` in
``apps/api/plane/authentication/views/common.py``) and must echo it back in
the ``X-CSRFToken`` header on every unsafe HTTP method (POST/PUT/PATCH/DELETE).
"""

from rest_framework.authentication import SessionAuthentication


class BaseSessionAuthentication(SessionAuthentication):
    """DRF session authentication with the built-in CSRF check enabled.

    Subclasses DRF's :class:`SessionAuthentication` without overriding
    :meth:`enforce_csrf`, so session-authenticated REST API endpoints honor
    the standard CSRF enforcement contract: unsafe HTTP methods
    (POST/PUT/PATCH/DELETE) MUST include a valid CSRF token in the
    ``X-CSRFToken`` header (or any of the alternative locations Django's
    :class:`~django.middleware.csrf.CsrfViewMiddleware` accepts). The token is
    issued by the dedicated CSRF-token endpoint (see ``CSRFTokenEndpoint`` in
    ``apps/api/plane/authentication/views/common.py``).

    This is the project's canonical session authentication class, consumed
    via ``authentication_classes = [BaseSessionAuthentication]`` on DRF view
    base classes (e.g. ``plane.app.views.base.BaseViewSet``,
    ``plane.space.views.base.BaseViewSet``,
    ``plane.license.api.views.base.BaseAPIView``); the ``Base*`` naming
    anticipates subclassing for future authentication variants.

    Security context:
        Earlier revisions overrode :meth:`enforce_csrf` to a no-op, which
        disabled DRF's CSRF check on every session-authenticated endpoint
        (OWASP A01:2021 Broken Access Control / Cross-Site Request Forgery).
        Do NOT re-introduce that override -- removing CSRF enforcement
        chains with the workspace permission gating to allow cross-origin
        state changes when an attacker can drive a victim browser.
    """
