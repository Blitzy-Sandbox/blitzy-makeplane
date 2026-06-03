# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django AppConfig module for the Plane authentication subsystem.

Declares :class:`AuthConfig`, the Django :class:`~django.apps.AppConfig`
binding for the ``plane.authentication`` app. The app is registered in
``INSTALLED_APPS`` and provides the auth surface (login, signup, OAuth,
magic-link, password recovery, session handling) mounted at ``auth/`` by
the project root URLconf.

Startup contract (per architectural rule): the ``migrator`` container runs
Django migrations before any API service starts, so any code that reads
schema state at import time can assume the database is at the target
revision. This AppConfig does not currently override :meth:`ready`, so it
adds no signal-handler wiring at startup.
"""

from django.apps import AppConfig


class AuthConfig(AppConfig):
    """Django AppConfig for the ``plane.authentication`` app.

    Registers the authentication subsystem with Django's app registry under
    the canonical label ``"plane.authentication"``. This config currently
    does not override :meth:`ready`, so no signal handlers are wired at
    app-startup; authentication behavior is composed declaratively via the
    URLconf (``apps/api/plane/authentication/urls.py``), middleware, and
    view-layer classes rather than via signal-based hooks.
    """

    name = "plane.authentication"
