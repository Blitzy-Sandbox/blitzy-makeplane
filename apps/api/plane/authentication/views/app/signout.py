# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Sign-out endpoint for the Plane app authentication flow.

This module exposes :class:`SignOutAuthEndpoint` -- the app-scoped logout
handler mounted at ``POST /auth/sign-out/``. The endpoint records audit
fields (``last_logout_ip``, ``last_logout_time``) on the :class:`User`
row, terminates the Django session via :func:`django.contrib.auth.logout`,
and redirects the browser to the app's base host (resolved through
:func:`base_host` with ``is_app=True``).

Failure handling: a bare ``except Exception`` swallows every error path so
the user is never trapped on the API response. The browser is always
redirected to the app host; partial audit failures are silent (the session
is still terminated by ``logout(request)`` before any audit write would
fail).

Architectural notes (per AAP 0.2.2):

  * The Django session is **PostgreSQL-backed** via the custom
    ``plane.db.models.session`` engine (see ``SESSION_ENGINE`` in
    ``apps/api/plane/settings/common.py``) -- ``logout(request)``
    deletes the session row from the PostgreSQL ``sessions`` table.
    Redis is used for caching and selected ephemeral auth data only;
    it is NOT the session backend, and it is NOT a Celery broker
    (Celery jobs route through RabbitMQ elsewhere).
  * No Celery / RabbitMQ involvement; no email / webhook fan-out.
  * ``User`` is loaded from PostgreSQL -- schema state assumes the migrator
    container has already run migrations.
"""

# Django imports
from django.views import View
from django.contrib.auth import logout
from django.http import HttpResponseRedirect
from django.utils import timezone

# Module imports
from plane.authentication.utils.host import user_ip, base_host
from plane.db.models import User


class SignOutAuthEndpoint(View):
    """Terminate the app session and record sign-out audit fields.

    HTTP method / URL:
        ``POST /auth/sign-out/``

    Inheritance:
        :class:`django.views.View` -- not a DRF ``APIView``. There is no
        ``permission_classes`` declaration; the endpoint relies on the
        request's session-bound user (``request.user.id``). If the request
        is anonymous, the ``User.objects.get(...)`` lookup raises
        :class:`User.DoesNotExist`, which is caught by the catch-all
        ``except Exception`` and the response still resolves to a redirect.

    Request body:
        None (POST with no required fields).

    Response:
        HTTP 302 redirect to ``base_host(request=request, is_app=True)`` on
        every code path -- success and error alike. The catch-all exception
        handler is intentional: a user attempting to sign out must NEVER be
        trapped on the API; partial audit failures are silent.

    Side effects:
        * Sets ``User.last_logout_ip`` (from :func:`user_ip`) and
          ``User.last_logout_time`` (from :func:`django.utils.timezone.now`)
          for security forensics.
        * Persists the user row (``user.save()``).
        * Calls :func:`django.contrib.auth.logout` to delete the
          PostgreSQL-backed Django session row via the
          ``plane.db.models.session`` engine.
        * Returns a 302 redirect to the app base host.
    """

    def post(self, request):
        """Record audit fields, log the user out, and redirect to the app host."""
        # Get user
        try:
            user = User.objects.get(pk=request.user.id)
            user.last_logout_ip = user_ip(request=request)
            user.last_logout_time = timezone.now()
            user.save()
            # Log the user out
            logout(request)
            return HttpResponseRedirect(base_host(request=request, is_app=True))
        except Exception:
            return HttpResponseRedirect(base_host(request=request, is_app=True))
