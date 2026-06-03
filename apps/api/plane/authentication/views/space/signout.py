# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Space-scoped sign-out endpoint for the Plane public-space surface.

Exposes :class:`SignOutAuthSpaceEndpoint` (``POST /auth/spaces/sign-out/``)
which terminates the Django session, records logout audit metadata on the
:class:`User` row, and redirects back to the tenant host. This module is the
``is_space=True`` mirror of
:mod:`apps.api.plane.authentication.views.app.signout`; the view-class shape
is identical and only the host-resolution flag differs.

Side effects:
  * Writes ``User.last_logout_ip`` (from the request's client IP via
    :func:`user_ip`) and ``User.last_logout_time`` (UTC ``timezone.now()``).
  * Calls Django :func:`django.contrib.auth.logout`, which flushes the
    current session row through Plane's custom DB-backed session backend
    (:mod:`plane.db.models.session`). Sessions are persisted in PostgreSQL,
    not Redis; Redis serves only as the Django cache and Celery task
    queueing routes through RabbitMQ elsewhere.
  * Returns an HTTP 302 redirect to a safe ``next_path`` resolved against
    :func:`base_host` (``is_space=True``).

Failure handling: any exception during session/user write is intentionally
swallowed and a safe redirect is returned anyway, so sign-out is best-effort
and never strands a user on a failed-logout page.
"""

# Django imports
from django.views import View
from django.contrib.auth import logout
from django.http import HttpResponseRedirect
from django.utils import timezone

# Module imports
from plane.authentication.utils.host import base_host, user_ip
from plane.db.models import User
from plane.utils.path_validator import get_safe_redirect_url


class SignOutAuthSpaceEndpoint(View):
    """Sign the current user out of the space-tenant surface.

    HTTP method / URL:
        ``POST /auth/spaces/sign-out/``

    Permission:
        Django :class:`~django.views.View` subclass (not DRF), so no
        ``permission_classes`` declaration applies. An anonymous request is
        a no-op (nothing to log out) and still receives a safe redirect.

    Request body (form):
        * ``next_path`` (str, optional) -- destination path to redirect to
          after sign-out; sanitized by :func:`get_safe_redirect_url`.

    Response:
        HTTP 302 redirect to
        ``get_safe_redirect_url(base_host(is_space=True), next_path)``.
        On any internal failure the redirect is still issued (best-effort
        sign-out -- never strand the user on an error page).

    Side effects:
        * Sets ``User.last_logout_ip`` to the request's client IP via
          :func:`user_ip` (audit trail).
        * Sets ``User.last_logout_time`` to ``timezone.now()`` (audit trail).
        * Persists the user row via ``user.save()``.
        * Clears the current Django session via
          :func:`django.contrib.auth.logout`; the session row lives in
          PostgreSQL through the custom
          :mod:`plane.db.models.session` backend (not Redis).

    Space-scoped semantic:
        ``base_host(request, is_space=True)`` routes the redirect to the
        tenant host, distinguishing this view from
        :class:`SignOutAuthEndpoint` (the app-scoped counterpart).
    """

    def post(self, request):
        """Terminate the Django session, record logout audit fields, and redirect."""
        next_path = request.POST.get("next_path")

        # Get user
        try:
            user = User.objects.get(pk=request.user.id)
            user.last_logout_ip = user_ip(request=request)
            user.last_logout_time = timezone.now()
            user.save()
            # Log the user out
            logout(request)
            url = get_safe_redirect_url(base_url=base_host(request=request, is_space=True), next_path=next_path)
            return HttpResponseRedirect(url)
        except Exception:
            url = get_safe_redirect_url(base_url=base_host(request=request, is_space=True), next_path=next_path)
            return HttpResponseRedirect(url)
