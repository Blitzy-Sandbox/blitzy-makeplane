# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Custom Django session middleware for the Plane authentication subsystem.

Defines :class:`SessionMiddleware`, a request/response middleware that
selects between two cookie axes based on ``request.path``: a standard user
session cookie (``settings.SESSION_COOKIE_NAME``) and an admin-scoped
cookie (``settings.ADMIN_SESSION_COOKIE_NAME``) used for requests targeting
the admin ``instances`` surface. The session backend is loaded dynamically
from ``settings.SESSION_ENGINE`` at middleware initialization so the
storage layer is settings-driven rather than hard-coded; in this deployment
the configured engine is ``plane.db.models.session`` (a PostgreSQL-backed
``django.contrib.sessions.backends.db`` subclass).

Middleware chain position: registered in ``settings.MIDDLEWARE`` BEFORE
``django.middleware.common.CommonMiddleware``,
``django.middleware.csrf.CsrfViewMiddleware``, and
``django.contrib.auth.middleware.AuthenticationMiddleware`` so downstream
middleware and views can read ``request.session`` reliably (Django's
``AuthenticationMiddleware`` in particular depends on the session attribute
this middleware installs).

Async infrastructure note (per AAP §0.2.2): Celery task queueing flows
through RabbitMQ via AMQP, while Redis serves cache duties only. The
session-store backend is independent of either layer and is determined
solely by ``settings.SESSION_ENGINE``.
"""

import time
from importlib import import_module

from django.conf import settings
from django.contrib.sessions.backends.base import UpdateError
from django.contrib.sessions.exceptions import SessionInterrupted
from django.utils.cache import patch_vary_headers
from django.utils.deprecation import MiddlewareMixin
from django.utils.http import http_date


class SessionMiddleware(MiddlewareMixin):
    """Two-axis Django session middleware (standard user vs. admin).

    Subclasses :class:`MiddlewareMixin` so it participates in Django's
    classic middleware lifecycle via :meth:`process_request` (load) and
    :meth:`process_response` (persist). The configured session backend is
    loaded dynamically from ``settings.SESSION_ENGINE`` at middleware
    initialization, making the storage layer settings-driven rather than
    hard-coded.

    Cookie selection rule (the "two axes"):
        * Paths whose ``request.path`` contains the substring
          ``"instances"`` (the admin instance surface) use
          ``settings.ADMIN_SESSION_COOKIE_NAME`` with expiry drawn from
          ``settings.ADMIN_SESSION_COOKIE_AGE`` (default 3600 seconds /
          one hour).
        * All other paths use ``settings.SESSION_COOKIE_NAME`` with expiry
          drawn from :meth:`request.session.get_expiry_age` (default
          ``settings.SESSION_COOKIE_AGE`` of 604800 seconds / one week).

    The dual-cookie pattern exists so admin sessions can run alongside a
    standard user session in the same browser without one logging the
    other out, and so admin sessions can enforce a shorter expiry
    independent of the user session's age policy for tighter admin
    security.

    Request-time behavior (:meth:`process_request`):
        Assigns ``request.session = SessionStore(session_key)`` using the
        cookie selected by the path rule; downstream middleware and views
        read session state through this attribute.

    Response-time behavior (:meth:`process_response`):
        * Adds ``Cookie`` to the ``Vary`` response header whenever session
          state was accessed so shared caches do not return a
          session-bearing response to the wrong user (cache-correctness
          coordination).
        * Deletes the session cookie when the session is empty.
        * Persists session changes when the session was modified (or
          ``settings.SESSION_SAVE_EVERY_REQUEST`` is set) AND the response
          status is below 500 — 5xx responses skip persistence so a
          partially completed session is not baked into storage.
        * Re-issues the cookie with ``path``, ``domain``, ``secure``,
          ``httponly``, and ``samesite`` attributes drawn from settings.

    Exception conversion:
        If :meth:`session.save` raises :class:`UpdateError` (the session
        row was deleted concurrently — for example, a parallel sign-out
        request removed it), it is re-raised as
        :class:`SessionInterrupted` to signal that the session ended
        before the response could complete.
    """

    def __init__(self, get_response):
        """Resolve the configured session backend and cache its store class.

        Dynamically imports ``settings.SESSION_ENGINE`` so the storage
        layer is settings-driven, then caches ``engine.SessionStore`` on
        the instance for reuse by :meth:`process_request` and
        :meth:`process_response`.
        """
        super().__init__(get_response)
        engine = import_module(settings.SESSION_ENGINE)
        self.SessionStore = engine.SessionStore

    def process_request(self, request):
        """Attach a session to ``request`` using the path-selected cookie.

        Reads the admin cookie (``settings.ADMIN_SESSION_COOKIE_NAME``)
        when ``request.path`` contains ``"instances"``, otherwise the
        standard cookie (``settings.SESSION_COOKIE_NAME``), and assigns
        ``request.session = SessionStore(session_key)`` so downstream
        middleware and views can read and write session state through it.
        """
        if "instances" in request.path:
            session_key = request.COOKIES.get(settings.ADMIN_SESSION_COOKIE_NAME)
        else:
            session_key = request.COOKIES.get(settings.SESSION_COOKIE_NAME)
        request.session = self.SessionStore(session_key)

    def process_response(self, request, response):
        """Persist or clear the session cookie based on request-cycle state.

        Saves modified sessions, deletes the cookie when the session is
        empty, patches ``Vary: Cookie`` when session access could affect
        cacheability, skips persistence on 5xx responses, and converts an
        :class:`UpdateError` from a concurrent session deletion into
        :class:`SessionInterrupted`.
        """
        try:
            accessed = request.session.accessed
            modified = request.session.modified
            empty = request.session.is_empty()
        except AttributeError:
            return response
        # First check if we need to delete this cookie.
        # The session should be deleted only if the session is entirely empty.
        is_admin_path = "instances" in request.path
        cookie_name = settings.ADMIN_SESSION_COOKIE_NAME if is_admin_path else settings.SESSION_COOKIE_NAME

        if cookie_name in request.COOKIES and empty:
            response.delete_cookie(
                cookie_name,
                path=settings.SESSION_COOKIE_PATH,
                domain=settings.SESSION_COOKIE_DOMAIN,
                samesite=settings.SESSION_COOKIE_SAMESITE,
            )
            patch_vary_headers(response, ("Cookie",))
        else:
            if accessed:
                patch_vary_headers(response, ("Cookie",))
            if (modified or settings.SESSION_SAVE_EVERY_REQUEST) and not empty:
                if request.session.get_expire_at_browser_close():
                    max_age = None
                    expires = None
                else:
                    # Use different max_age based on whether it's an admin cookie
                    if is_admin_path:
                        max_age = settings.ADMIN_SESSION_COOKIE_AGE
                    else:
                        max_age = request.session.get_expiry_age()

                    expires_time = time.time() + max_age
                    expires = http_date(expires_time)

                # Save the session data and refresh the client cookie.
                if response.status_code < 500:
                    try:
                        request.session.save()
                    except UpdateError:
                        raise SessionInterrupted(
                            "The request's session was deleted before the "
                            "request completed. The user may have logged "
                            "out in a concurrent request, for example."
                        )
                    response.set_cookie(
                        cookie_name,
                        request.session.session_key,
                        max_age=max_age,
                        expires=expires,
                        domain=settings.SESSION_COOKIE_DOMAIN,
                        path=settings.SESSION_COOKIE_PATH,
                        secure=settings.SESSION_COOKIE_SECURE or None,
                        httponly=settings.SESSION_COOKIE_HTTPONLY or None,
                        samesite=settings.SESSION_COOKIE_SAMESITE,
                    )
        return response
