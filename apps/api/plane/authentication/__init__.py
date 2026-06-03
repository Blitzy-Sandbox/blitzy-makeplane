# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Package marker for the Plane authentication subsystem.

Houses the Django app config, DRF session authentication, throttling, URL
routing, view layer, provider/adapter abstractions, custom middleware, and
helper utilities that together implement Plane's authentication flows
(credentials, magic-link, OAuth via Google/GitHub/GitLab/Gitea, password
recovery, sign-out).

First-order layout:

  * :mod:`.apps`        — Django ``AuthConfig`` registering ``plane.authentication``
  * :mod:`.session`     — :class:`BaseSessionAuthentication` (DRF CSRF opt-out)
  * :mod:`.rate_limit`  — ``AuthenticationThrottle`` / ``EmailVerificationThrottle``
  * :mod:`.urls`        — URLconf for the ``auth/`` mount
  * :mod:`.adapter`     — base/credential/OAuth adapters + error / exception types
  * :mod:`.provider`    — concrete OAuth and credential providers
  * :mod:`.views`       — DRF view layer (app-scoped + space-scoped)
  * :mod:`.middleware`  — custom session middleware
  * :mod:`.utils`       — auth-flow helpers (login, host, redirect path,
                          invitation processing)

This module deliberately re-exports nothing; consumers import directly from
the submodule that owns each symbol.
"""
