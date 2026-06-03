# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL configuration for the Plane authentication subsystem.

Mounted at ``auth/`` by the project root URLconf (``plane/urls.py``). Exposes
two parallel route axes derived from the same view layer:

  - **App-scoped** routes (no ``spaces/`` prefix) for the main Plane web app
  - **Space-scoped** routes (prefixed ``spaces/``) for the public-space /
    space-tenant authentication flow

Functional groups:

  * Credentials: ``sign-in/``, ``sign-up/`` (+ ``spaces/`` variants)
  * Sign-out:    ``sign-out/`` (+ ``spaces/`` variant)
  * CSRF:        ``get-csrf-token/``
  * Magic link:  ``magic-generate/``, ``magic-sign-in/``, ``magic-sign-up/``
                  (+ ``spaces/`` variants). ``magic-generate`` enqueues
                  ``magic_link_code_task.magic_link`` for code email delivery.
  * OAuth:       ``google/{,callback/}``, ``github/{,callback/}``,
                  ``gitlab/{,callback/}``, ``gitea/{,callback/}``
                  (each with a ``spaces/`` mirror)
  * Email check: ``email-check/`` (+ ``spaces/`` variant)
  * Password:    ``forgot-password/`` (enqueues
                  ``forgot_password_task.forgot_password`` for the reset
                  email), ``reset-password/<uidb64>/<token>/``,
                  ``change-password/``, ``set-password/``
                  (forgot/reset have ``spaces/`` mirrors)

The two route axes resolve to two parallel view sub-packages:
``plane.authentication.views.app.*`` for the App-scoped endpoints and
``plane.authentication.views.space.*`` for the Space-scoped endpoints. The
Space variants pass ``is_space=True`` to helpers such as ``base_host`` and
``user_login`` so the redirect host and cookie/session namespace are scoped
to the public-space tenant.

Async note (architectural rule): the magic-link and forgot-password flows
enqueue email-sending tasks through **Celery via RabbitMQ**. Redis is used
only for caching and session storage — not for task queueing. See
``apps/api/plane/bgtasks/magic_link_code_task.py`` and
``apps/api/plane/bgtasks/forgot_password_task.py``.
"""

from django.urls import path

from .views import (
    CSRFTokenEndpoint,
    ForgotPasswordEndpoint,
    SetUserPasswordEndpoint,
    ResetPasswordEndpoint,
    ChangePasswordEndpoint,
    # App
    EmailCheckEndpoint,
    GitLabCallbackEndpoint,
    GitLabOauthInitiateEndpoint,
    GitHubCallbackEndpoint,
    GitHubOauthInitiateEndpoint,
    GoogleCallbackEndpoint,
    GoogleOauthInitiateEndpoint,
    MagicGenerateEndpoint,
    MagicSignInEndpoint,
    MagicSignUpEndpoint,
    SignInAuthEndpoint,
    SignOutAuthEndpoint,
    SignUpAuthEndpoint,
    ForgotPasswordSpaceEndpoint,
    ResetPasswordSpaceEndpoint,
    # Space
    EmailCheckSpaceEndpoint,
    GitLabCallbackSpaceEndpoint,
    GitLabOauthInitiateSpaceEndpoint,
    GitHubCallbackSpaceEndpoint,
    GitHubOauthInitiateSpaceEndpoint,
    GoogleCallbackSpaceEndpoint,
    GoogleOauthInitiateSpaceEndpoint,
    MagicGenerateSpaceEndpoint,
    MagicSignInSpaceEndpoint,
    MagicSignUpSpaceEndpoint,
    SignInAuthSpaceEndpoint,
    SignUpAuthSpaceEndpoint,
    SignOutAuthSpaceEndpoint,
    GiteaCallbackEndpoint,
    GiteaOauthInitiateEndpoint,
    GiteaCallbackSpaceEndpoint,
    GiteaOauthInitiateSpaceEndpoint,
)

urlpatterns = [
    # credentials
    path("sign-in/", SignInAuthEndpoint.as_view(), name="sign-in"),
    path("sign-up/", SignUpAuthEndpoint.as_view(), name="sign-up"),
    path("spaces/sign-in/", SignInAuthSpaceEndpoint.as_view(), name="space-sign-in"),
    path("spaces/sign-up/", SignUpAuthSpaceEndpoint.as_view(), name="space-sign-up"),
    # signout
    path("sign-out/", SignOutAuthEndpoint.as_view(), name="sign-out"),
    path("spaces/sign-out/", SignOutAuthSpaceEndpoint.as_view(), name="space-sign-out"),
    # csrf token
    path("get-csrf-token/", CSRFTokenEndpoint.as_view(), name="get_csrf_token"),
    # Magic sign in
    path("magic-generate/", MagicGenerateEndpoint.as_view(), name="magic-generate"),
    path("magic-sign-in/", MagicSignInEndpoint.as_view(), name="magic-sign-in"),
    path("magic-sign-up/", MagicSignUpEndpoint.as_view(), name="magic-sign-up"),
    path(
        "spaces/magic-generate/",
        MagicGenerateSpaceEndpoint.as_view(),
        name="space-magic-generate",
    ),
    path(
        "spaces/magic-sign-in/",
        MagicSignInSpaceEndpoint.as_view(),
        name="space-magic-sign-in",
    ),
    path(
        "spaces/magic-sign-up/",
        MagicSignUpSpaceEndpoint.as_view(),
        name="space-magic-sign-up",
    ),
    ## Google Oauth
    path("google/", GoogleOauthInitiateEndpoint.as_view(), name="google-initiate"),
    path("google/callback/", GoogleCallbackEndpoint.as_view(), name="google-callback"),
    path(
        "spaces/google/",
        GoogleOauthInitiateSpaceEndpoint.as_view(),
        name="space-google-initiate",
    ),
    path(
        "spaces/google/callback/",
        GoogleCallbackSpaceEndpoint.as_view(),
        name="space-google-callback",
    ),
    ## Github Oauth
    path("github/", GitHubOauthInitiateEndpoint.as_view(), name="github-initiate"),
    path("github/callback/", GitHubCallbackEndpoint.as_view(), name="github-callback"),
    path(
        "spaces/github/",
        GitHubOauthInitiateSpaceEndpoint.as_view(),
        name="space-github-initiate",
    ),
    path(
        "spaces/github/callback/",
        GitHubCallbackSpaceEndpoint.as_view(),
        name="space-github-callback",
    ),
    ## Gitlab Oauth
    path("gitlab/", GitLabOauthInitiateEndpoint.as_view(), name="gitlab-initiate"),
    path("gitlab/callback/", GitLabCallbackEndpoint.as_view(), name="gitlab-callback"),
    path(
        "spaces/gitlab/",
        GitLabOauthInitiateSpaceEndpoint.as_view(),
        name="space-gitlab-initiate",
    ),
    path(
        "spaces/gitlab/callback/",
        GitLabCallbackSpaceEndpoint.as_view(),
        name="space-gitlab-callback",
    ),
    # Email Check
    path("email-check/", EmailCheckEndpoint.as_view(), name="email-check"),
    path("spaces/email-check/", EmailCheckSpaceEndpoint.as_view(), name="email-check"),
    # Password
    path("forgot-password/", ForgotPasswordEndpoint.as_view(), name="forgot-password"),
    path(
        "reset-password/<uidb64>/<token>/",
        ResetPasswordEndpoint.as_view(),
        name="forgot-password",
    ),
    path(
        "spaces/forgot-password/",
        ForgotPasswordSpaceEndpoint.as_view(),
        name="space-forgot-password",
    ),
    path(
        "spaces/reset-password/<uidb64>/<token>/",
        ResetPasswordSpaceEndpoint.as_view(),
        name="space-forgot-password",
    ),
    path("change-password/", ChangePasswordEndpoint.as_view(), name="forgot-password"),
    path("set-password/", SetUserPasswordEndpoint.as_view(), name="set-password"),
    ## Gitea Oauth
    path("gitea/", GiteaOauthInitiateEndpoint.as_view(), name="gitea-initiate"),
    path("gitea/callback/", GiteaCallbackEndpoint.as_view(), name="gitea-callback"),
    path(
        "spaces/gitea/",
        GiteaOauthInitiateSpaceEndpoint.as_view(),
        name="space-gitea-initiate",
    ),
    path(
        "spaces/gitea/callback/",
        GiteaCallbackSpaceEndpoint.as_view(),
        name="space-gitea-callback",
    ),
]
