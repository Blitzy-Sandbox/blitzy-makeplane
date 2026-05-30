# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Post-authentication session bootstrap for Plane.

Provides :func:`user_login`, the helper invoked by the authentication views
once a user has been resolved by a credential, OAuth, magic-link, or
sign-up flow. The helper completes authentication by calling
:func:`django.contrib.auth.login`, optionally shortens the admin session
lifetime, and persists device/context metadata into the session for audit
and UI consumers.

Upstream symbol dependencies:

  * :func:`django.contrib.auth.login` — server-side session creation and
    session-key rotation.
  * :data:`django.conf.settings.ADMIN_SESSION_COOKIE_AGE` — admin session
    lifetime overlay applied when ``is_admin`` is truthy.
  * :func:`plane.utils.host.base_host` — surface-aware origin resolution
    written into ``device_info["domain"]`` (note: this is the project-wide
    helper at ``plane.utils.host``, not the same-named module that lives
    alongside this file under ``plane.authentication.utils``).
  * :func:`plane.utils.ip_address.get_client_ip` — client IP capture
    written into ``device_info["ip_address"]``.

Session storage note (per architectural rule): Django sessions are
persisted to **Redis** through the configured session backend; Redis is
used for caching and session storage **only** in this project. Celery
task queueing uses RabbitMQ, not Redis — do not conflate the two when
reading code that touches ``request.session`` here vs. code that calls
``.delay()`` elsewhere in the codebase.
"""

# Django imports
from django.contrib.auth import login
from django.conf import settings

# Module imports
from plane.utils.host import base_host
from plane.utils.ip_address import get_client_ip


def user_login(request, user, is_app=False, is_admin=False, is_space=False):
    """Complete authentication by logging the user in and capturing device metadata.

    Calls :func:`django.contrib.auth.login` to establish the Django session,
    optionally shortens the admin session lifetime, and records device
    fingerprint data (user agent, IP, resolved origin) into
    ``request.session["device_info"]`` for downstream audit/analytics
    consumers (e.g. session listing, suspicious-login detection).

    The session payload is persisted by the configured Django session
    backend, which is Redis-backed in this project (Redis = caching and
    session storage only — Celery task queueing uses RabbitMQ, not Redis).
    The explicit :meth:`request.session.save` ensures durability before the
    request finishes; without it the session would only be flushed at the
    end of the response cycle.

    Side effects (in order):

      1. ``django.contrib.auth.login(request, user)`` — establishes the
         server-side session and rotates the session key.
      2. If ``is_admin`` is truthy:
         ``request.session.set_expiry(settings.ADMIN_SESSION_COOKIE_AGE)``
         — shortens the session lifetime to the admin-specific window
         configured in settings, so admin sessions expire sooner than
         standard user sessions.
      3. ``request.session["device_info"] = {...}`` — records the user
         agent (from ``request.META["HTTP_USER_AGENT"]``), the resolved
         client IP (via :func:`plane.utils.ip_address.get_client_ip`),
         and the surface-aware origin domain (via
         :func:`plane.utils.host.base_host`) for the current auth context.
      4. ``request.session.save()`` — flushes the session to the backend
         immediately so subsequent requests in the same flow can read
         ``device_info``.

    Args:
        request: The Django/DRF request that initiated the auth flow.
        user: The authenticated :class:`plane.db.models.User` instance to
            attach to the session.
        is_app (bool): Truthy when this login originates from the main
            app surface. Forwarded to :func:`base_host` for domain
            resolution.
        is_admin (bool): Truthy when this login originates from the admin
            (``god-mode``) surface. When set, the admin session expiry
            override is applied AND :func:`base_host` returns the admin
            origin.
        is_space (bool): Truthy when this login originates from the public
            space surface. Forwarded to :func:`base_host` for domain
            resolution.

    Returns:
        None. Authentication state is persisted via the request session.
    """
    login(request=request, user=user)

    # If is admin cookie set the custom age
    if is_admin:
        request.session.set_expiry(settings.ADMIN_SESSION_COOKIE_AGE)

    device_info = {
        "user_agent": request.META.get("HTTP_USER_AGENT", ""),
        "ip_address": get_client_ip(request=request),
        "domain": base_host(request=request, is_app=is_app, is_admin=is_admin, is_space=is_space),
    }
    request.session["device_info"] = device_info
    request.session.save()
    return
