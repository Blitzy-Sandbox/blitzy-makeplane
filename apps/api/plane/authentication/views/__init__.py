# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Plane authentication view layer — canonical import surface.

Aggregates the shared and app-scoped + space-scoped authentication endpoints
into a single namespace (``plane.authentication.views``) consumed primarily
by the auth URLconf at ``apps/api/plane/authentication/urls.py``. This module
does NOT define ``__all__``; consumers import named symbols directly.

Re-export surface
-----------------

Shared (cross-context) endpoints from :mod:`.common`:

  * ``CSRFTokenEndpoint``       — ``GET /auth/get-csrf-token/``
  * ``ChangePasswordEndpoint``  — ``POST /auth/change-password/``
  * ``SetUserPasswordEndpoint`` — ``POST /auth/set-password/``

App-scoped endpoints from :mod:`.app.*` (default host resolution, ``is_app``
login semantics):

  * Email preflight: ``EmailCheckEndpoint``
  * Credentials:    ``SignInAuthEndpoint``, ``SignUpAuthEndpoint``
  * OAuth:          ``GitHubCallbackEndpoint`` / ``GitHubOauthInitiateEndpoint``,
                    ``GitLabCallbackEndpoint`` / ``GitLabOauthInitiateEndpoint``,
                    ``GiteaCallbackEndpoint``  / ``GiteaOauthInitiateEndpoint``,
                    ``GoogleCallbackEndpoint`` / ``GoogleOauthInitiateEndpoint``
  * Magic link:     ``MagicGenerateEndpoint``, ``MagicSignInEndpoint``,
                    ``MagicSignUpEndpoint``
  * Sign-out:       ``SignOutAuthEndpoint``
  * Password:       ``ForgotPasswordEndpoint``, ``ResetPasswordEndpoint``

Space-scoped endpoints from :mod:`.space.*` (``is_space=True`` login
semantics; otherwise functionally mirror the app surface above):

  * Email preflight: ``EmailCheckSpaceEndpoint``
  * Credentials:     ``SignInAuthSpaceEndpoint``, ``SignUpAuthSpaceEndpoint``
  * OAuth:           ``GitHubCallbackSpaceEndpoint`` /
                     ``GitHubOauthInitiateSpaceEndpoint``,
                     ``GitLabCallbackSpaceEndpoint`` /
                     ``GitLabOauthInitiateSpaceEndpoint``,
                     ``GiteaCallbackSpaceEndpoint`` /
                     ``GiteaOauthInitiateSpaceEndpoint``,
                     ``GoogleCallbackSpaceEndpoint`` /
                     ``GoogleOauthInitiateSpaceEndpoint``
  * Magic link:      ``MagicGenerateSpaceEndpoint``,
                     ``MagicSignInSpaceEndpoint``, ``MagicSignUpSpaceEndpoint``
  * Sign-out:        ``SignOutAuthSpaceEndpoint``
  * Password:        ``ForgotPasswordSpaceEndpoint``,
                     ``ResetPasswordSpaceEndpoint``

Async note (per AAP §0.2.2 architectural rule): magic-link generation and
forgot-password endpoints enqueue email-sending tasks through **Celery via
RabbitMQ**. Redis is used only for caching and session storage — not for task
queueing. See ``apps/api/plane/bgtasks/magic_link_code_task.py`` and
``apps/api/plane/bgtasks/forgot_password_task.py``.
"""

from .common import ChangePasswordEndpoint, CSRFTokenEndpoint, SetUserPasswordEndpoint

from .app.check import EmailCheckEndpoint

from .app.email import SignInAuthEndpoint, SignUpAuthEndpoint
from .app.github import GitHubCallbackEndpoint, GitHubOauthInitiateEndpoint
from .app.gitlab import GitLabCallbackEndpoint, GitLabOauthInitiateEndpoint
from .app.gitea import GiteaCallbackEndpoint, GiteaOauthInitiateEndpoint
from .app.google import GoogleCallbackEndpoint, GoogleOauthInitiateEndpoint
from .app.magic import MagicGenerateEndpoint, MagicSignInEndpoint, MagicSignUpEndpoint

from .app.signout import SignOutAuthEndpoint


from .space.email import SignInAuthSpaceEndpoint, SignUpAuthSpaceEndpoint

from .space.github import GitHubCallbackSpaceEndpoint, GitHubOauthInitiateSpaceEndpoint

from .space.gitlab import GitLabCallbackSpaceEndpoint, GitLabOauthInitiateSpaceEndpoint

from .space.gitea import GiteaCallbackSpaceEndpoint, GiteaOauthInitiateSpaceEndpoint

from .space.google import GoogleCallbackSpaceEndpoint, GoogleOauthInitiateSpaceEndpoint

from .space.magic import (
    MagicGenerateSpaceEndpoint,
    MagicSignInSpaceEndpoint,
    MagicSignUpSpaceEndpoint,
)

from .space.signout import SignOutAuthSpaceEndpoint

from .space.check import EmailCheckSpaceEndpoint

from .space.password_management import (
    ForgotPasswordSpaceEndpoint,
    ResetPasswordSpaceEndpoint,
)
from .app.password_management import ForgotPasswordEndpoint, ResetPasswordEndpoint
