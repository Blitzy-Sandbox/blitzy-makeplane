# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""DRF session authentication for the Plane API.

Exposes a :class:`SessionAuthentication` subclass that opts out of DRF's
built-in CSRF enforcement layer for session-authenticated REST API requests.
CSRF for browser-session clients is enforced at the project layer via the
dedicated CSRF-token endpoint (see ``CSRFTokenEndpoint`` in
``apps/api/plane/authentication/views/common.py``); Django's standard CSRF
middleware is NOT disabled — this override only suppresses DRF's redundant
per-class re-check after the request has already passed CSRF inspection.
"""

from rest_framework.authentication import SessionAuthentication


class BaseSessionAuthentication(SessionAuthentication):
    """DRF session authentication with the built-in CSRF check disabled.

    Subclasses DRF's :class:`SessionAuthentication` and turns
    :meth:`enforce_csrf` into a no-op so that session-authenticated REST API
    endpoints do not redundantly re-run DRF's CSRF logic; CSRF for
    browser-session clients is managed at the project layer via the
    dedicated CSRF-token endpoint (see ``CSRFTokenEndpoint`` in
    ``apps/api/plane/authentication/views/common.py``).

    This is the project's canonical session authentication class, consumed
    via ``authentication_classes = [BaseSessionAuthentication]`` on DRF view
    base classes (e.g. ``plane.app.views.base.BaseViewSet``,
    ``plane.space.views.base.BaseViewSet``,
    ``plane.license.api.views.base.BaseAPIView``); the ``Base*`` naming
    anticipates subclassing for future authentication variants.
    """

    # Disable csrf for the rest apis
    def enforce_csrf(self, request):
        """Skip DRF's built-in CSRF enforcement for REST API requests."""
        return
