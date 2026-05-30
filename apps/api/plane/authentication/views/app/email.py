# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Email + password credential endpoints for the Plane app authentication flow.

This module exposes the classic email/password authentication endpoints
for the app surface:

  * :class:`SignInAuthEndpoint` -- ``POST /auth/sign-in/`` (existing user).
  * :class:`SignUpAuthEndpoint` -- ``POST /auth/sign-up/`` (new user).

Both endpoints normalize and validate the supplied email, enforce that
both ``email`` and ``password`` are present, gate on
:class:`Instance` deployment-readiness (``instance.is_setup_done``), and
delegate the credential check to
:class:`plane.authentication.provider.credentials.email.EmailProvider`.
:func:`plane.authentication.utils.user_auth_workflow.post_user_auth_workflow`
is passed as the post-auth callback so workspace / profile bootstrap
runs after a successful sign-up and per-login bookkeeping runs after a
successful sign-in. On success the user is logged in via
:func:`plane.authentication.utils.login.user_login` with ``is_app=True``
and the browser is 302-redirected to the supplied ``next_path`` (when
provided and validated) or to
:func:`plane.authentication.utils.redirection_path.get_redirection_path`
-- the deployment-default post-login page.

Error envelope contract
-----------------------

Every error path -- including the deployment-not-ready short-circuit,
missing or malformed credentials, the existing-user / non-existing-user
pre-condition violations, and any
:class:`plane.authentication.adapter.error.AuthenticationException`
raised by :meth:`EmailProvider.authenticate` -- returns an HTTP 302
redirect to ``base_host(request=request, is_app=True)`` with a query
string built from :meth:`AuthenticationException.get_error_dict`. The
redirect URL is assembled by
:func:`plane.utils.path_validator.get_safe_redirect_url` so the
caller-supplied ``next_path`` is sanitized via
:func:`plane.utils.path_validator.validate_next_path` -- this is the
open-redirect defense; do NOT bypass it by hand-constructing URLs
elsewhere. The set of
:data:`plane.authentication.adapter.error.AUTHENTICATION_ERROR_CODES`
keys that may be raised from this module:

  * ``INSTANCE_NOT_CONFIGURED`` -- deployment is not finished
    (``Instance.is_setup_done`` is falsy or no row exists).
  * ``REQUIRED_EMAIL_PASSWORD_SIGN_IN`` / ``REQUIRED_EMAIL_PASSWORD_SIGN_UP``
    -- either form field is missing or empty.
  * ``INVALID_EMAIL_SIGN_IN`` / ``INVALID_EMAIL_SIGN_UP`` -- email fails
    :func:`django.core.validators.validate_email`.
  * ``USER_DOES_NOT_EXIST`` -- sign-in only (no :class:`User` row).
  * ``USER_ALREADY_EXIST`` -- sign-up only (a :class:`User` row already
    exists for the submitted email).
  * Any code raised inside :meth:`EmailProvider.authenticate` -- e.g.
    ``AUTHENTICATION_FAILED_SIGN_IN``, ``AUTHENTICATION_FAILED_SIGN_UP``,
    ``EMAIL_PASSWORD_AUTHENTICATION_DISABLED``.

Architectural notes
-------------------

  * Session refresh writes to **Redis-backed Django session storage**.
    Redis = caching + session only in this project; Plane does NOT use
    Redis as a task broker -- Celery jobs route through **RabbitMQ**.
  * The migrator container has already run schema migrations by the time
    this module is imported, so :class:`User` and :class:`Instance`
    queries are safe to assume the target revision.
  * **No Celery enqueue from this module** -- credentials are verified
    synchronously inside :meth:`EmailProvider.authenticate`. Email-based
    handoffs to RabbitMQ (e.g. magic-link delivery, password-reset email)
    happen in ``magic.py`` / ``password_management.py``, not here.
"""

# Django imports
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.http import HttpResponseRedirect
from django.views import View

# Module imports
from plane.authentication.provider.credentials.email import EmailProvider
from plane.authentication.utils.login import user_login
from plane.license.models import Instance
from plane.authentication.utils.host import base_host
from plane.authentication.utils.redirection_path import get_redirection_path
from plane.authentication.utils.user_auth_workflow import post_user_auth_workflow
from plane.db.models import User
from plane.authentication.adapter.error import (
    AuthenticationException,
    AUTHENTICATION_ERROR_CODES,
)
from plane.utils.path_validator import get_safe_redirect_url


class SignInAuthEndpoint(View):
    """Verify an existing user's email + password and refresh the app session.

    HTTP method / URL:
        ``POST /auth/sign-in/`` (registered in
        ``apps/api/plane/authentication/urls.py``; mounted under the
        ``auth/`` prefix declared in ``apps/api/plane/urls.py``).

    Inheritance:
        :class:`django.views.View` -- this is a vanilla Django view, NOT
        a DRF :class:`rest_framework.views.APIView`. No
        ``permission_classes`` is declared on the class (DRF permission
        machinery does not apply to ``django.views.View``); effectively
        anonymous-accessible because a pre-login client must be able to
        POST credentials. Throttling is also not applied here -- the
        DRF-based throttle classes are only honored on DRF endpoints
        such as :class:`EmailCheckEndpoint`.

    Request body (form-encoded ``application/x-www-form-urlencoded``):
        * ``email`` (str, required) -- read via
          ``request.POST.get("email", False)``; the sentinel ``False``
          (not ``None``) is intentional so that an empty submission
          maps to a falsy value that triggers the
          ``REQUIRED_EMAIL_PASSWORD_SIGN_IN`` branch. The value is
          normalized via ``.strip().lower()`` before validation.
        * ``password`` (str, required) -- read via
          ``request.POST.get("password", False)``; same falsy-sentinel
          rationale as ``email``.
        * ``next_path`` (str, optional) -- read via
          ``request.POST.get("next_path")``; when present, used as the
          post-login redirect target after sanitization by
          :func:`plane.utils.path_validator.get_safe_redirect_url`
          (which in turn calls
          :func:`plane.utils.path_validator.validate_next_path` to
          defeat open-redirect attacks).

    Pre-condition:
        A :class:`plane.db.models.User` with the submitted ``email`` MUST
        already exist. If not, the response is a 302 redirect carrying
        the ``USER_DOES_NOT_EXIST`` error code -- the caller is expected
        to route the user to :class:`SignUpAuthEndpoint` instead.

    Response:
        * HTTP 302 redirect on success -- target is the supplied
          ``next_path`` (sanitized) or
          :func:`plane.authentication.utils.redirection_path.get_redirection_path`
          when ``next_path`` is absent; query params are empty.
        * HTTP 302 redirect on every error path -- redirect target is
          ``base_host(request=request, is_app=True)`` and the query
          string carries
          :meth:`AuthenticationException.get_error_dict` so the SPA
          can surface the corresponding error message.

    Side effects:
        * Reads :class:`plane.license.models.Instance.objects.first` to
          enforce the deployment-readiness gate (migrator must have run).
        * Reads
          ``plane.db.models.User.objects.filter(email=email).first()`` to
          confirm the user exists.
        * Calls
          :meth:`plane.authentication.provider.credentials.email.EmailProvider.authenticate`
          (instantiated with ``is_signup=False``, ``callback=
          post_user_auth_workflow``) -- the password is verified via
          Django's :func:`django.contrib.auth.hashers.check_password`
          inside the provider. On verification failure the provider
          raises :class:`AuthenticationException` with
          ``AUTHENTICATION_FAILED_SIGN_IN``.
        * On successful authentication, calls
          :func:`plane.authentication.utils.login.user_login`
          (``is_app=True``) -- establishes the Django session, rotates
          the session key, and writes
          ``request.session["device_info"]``. Sessions are persisted to
          **Redis** (Redis = caching + session only; Celery uses RabbitMQ).
        * Returns :class:`django.http.HttpResponseRedirect` -- this view
          never returns JSON. All client UX (success and error) is
          driven by reading the redirect URL's query string.

    Error envelope:
        Every 4xx case returns a 302 redirect to
        ``base_host(is_app=True)`` with a query string built from
        :meth:`AuthenticationException.get_error_dict`. Possible error
        codes are enumerated in the module docstring above. The redirect
        URL is constructed by
        :func:`plane.utils.path_validator.get_safe_redirect_url` so
        ``next_path`` is open-redirect-safe even on the error path.
    """

    def post(self, request):
        """Verify email/password, refresh the app session, and redirect to ``next_path``."""
        next_path = request.POST.get("next_path")
        # Check instance configuration
        instance = Instance.objects.first()
        if instance is None or not instance.is_setup_done:
            # Redirection params
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INSTANCE_NOT_CONFIGURED"],
                error_message="INSTANCE_NOT_CONFIGURED",
            )
            params = exc.get_error_dict()
            # Base URL join
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)

        # set the referer as session to redirect after login
        email = request.POST.get("email", False)
        password = request.POST.get("password", False)

        ## Raise exception if any of the above are missing
        if not email or not password:
            # Redirection params
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["REQUIRED_EMAIL_PASSWORD_SIGN_IN"],
                error_message="REQUIRED_EMAIL_PASSWORD_SIGN_IN",
                payload={"email": str(email)},
            )
            params = exc.get_error_dict()
            # Next path
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)

        # Validate email
        email = email.strip().lower()
        try:
            validate_email(email)
        except ValidationError:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INVALID_EMAIL_SIGN_IN"],
                error_message="INVALID_EMAIL_SIGN_IN",
                payload={"email": str(email)},
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)

        existing_user = User.objects.filter(email=email).first()

        if not existing_user:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["USER_DOES_NOT_EXIST"],
                error_message="USER_DOES_NOT_EXIST",
                payload={"email": str(email)},
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)

        try:
            provider = EmailProvider(
                request=request,
                key=email,
                code=password,
                is_signup=False,
                callback=post_user_auth_workflow,
            )
            user = provider.authenticate()
            # Login the user and record his device info
            user_login(request=request, user=user, is_app=True)
            # Get the redirection path
            if next_path:
                path = next_path
            else:
                path = get_redirection_path(user=user)

            # Get the safe redirect URL
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=path,
                params={},
            )
            return HttpResponseRedirect(url)
        except AuthenticationException as e:
            params = e.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)


class SignUpAuthEndpoint(View):
    """Create a new account from email + password and refresh the app session.

    HTTP method / URL:
        ``POST /auth/sign-up/`` (registered in
        ``apps/api/plane/authentication/urls.py``; mounted under the
        ``auth/`` prefix declared in ``apps/api/plane/urls.py``).

    Inheritance:
        :class:`django.views.View` -- this is a vanilla Django view, NOT
        a DRF :class:`rest_framework.views.APIView`. No
        ``permission_classes`` is declared on the class (DRF permission
        machinery does not apply to ``django.views.View``); effectively
        anonymous-accessible because a pre-signup client must be able to
        POST. DRF throttle classes likewise do not apply.

    Request body (form-encoded ``application/x-www-form-urlencoded``):
        * ``email`` (str, required) -- read via
          ``request.POST.get("email", False)``; same falsy-sentinel
          handling as the sign-in endpoint. Normalized via
          ``.strip().lower()`` before validation.
        * ``password`` (str, required) -- read via
          ``request.POST.get("password", False)``. Password strength
          enforcement (e.g. ``zxcvbn``) is the responsibility of the
          provider layer if/when enabled; this view itself only checks
          presence -- it does NOT score password strength inline.
        * ``next_path`` (str, optional) -- post-auth redirect target;
          sanitized by :func:`get_safe_redirect_url` /
          :func:`plane.utils.path_validator.validate_next_path`.

    Pre-condition:
        A :class:`plane.db.models.User` with the submitted ``email``
        MUST NOT already exist. If one does, the response is a 302
        redirect carrying ``USER_ALREADY_EXIST`` -- the provider does
        NOT silently fall through to a sign-in. The API contract is that
        sign-up is for new users only; existing users belong on
        :class:`SignInAuthEndpoint`.

    Response:
        * HTTP 302 redirect on success -- target is the supplied
          ``next_path`` (sanitized) or
          :func:`plane.authentication.utils.redirection_path.get_redirection_path`
          when ``next_path`` is absent; query params are empty.
        * HTTP 302 redirect on every error path -- redirect target is
          ``base_host(request=request, is_app=True)`` and the query
          string carries :meth:`AuthenticationException.get_error_dict`.

    Side effects:
        * Reads :class:`plane.license.models.Instance.objects.first`
          (deployment-readiness gate; migrator must have run).
        * Reads
          ``plane.db.models.User.objects.filter(email=email).first()``
          and EXPECTS the result to be ``None``.
        * Calls
          :meth:`plane.authentication.provider.credentials.email.EmailProvider.authenticate`
          instantiated with ``is_signup=True`` and ``callback=
          post_user_auth_workflow``. The provider creates the
          :class:`User` row, hashes the password with Django's
          configured hasher, and -- via the
          :func:`plane.authentication.utils.user_auth_workflow.post_user_auth_workflow`
          callback -- seeds the new user's profile, default workspace,
          and any other post-account bootstrap state.
        * On successful authentication, calls
          :func:`plane.authentication.utils.login.user_login`
          (``is_app=True``) to establish the Redis-backed Django
          session.
        * Returns :class:`django.http.HttpResponseRedirect` -- this view
          never returns JSON.

    Error envelope:
        Same shape as :class:`SignInAuthEndpoint` (302 redirect with
        :meth:`AuthenticationException.get_error_dict` query params),
        but with sign-up-specific codes:
        ``REQUIRED_EMAIL_PASSWORD_SIGN_UP``, ``INVALID_EMAIL_SIGN_UP``,
        ``USER_ALREADY_EXIST``, plus
        ``AUTHENTICATION_FAILED_SIGN_UP`` /
        ``EMAIL_PASSWORD_AUTHENTICATION_DISABLED`` propagated from
        :meth:`EmailProvider.authenticate`.
    """

    def post(self, request):
        """Create a new account, refresh the app session, and redirect to ``next_path``."""
        next_path = request.POST.get("next_path")
        # Check instance configuration
        instance = Instance.objects.first()
        if instance is None or not instance.is_setup_done:
            # Redirection params
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INSTANCE_NOT_CONFIGURED"],
                error_message="INSTANCE_NOT_CONFIGURED",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)

        email = request.POST.get("email", False)
        password = request.POST.get("password", False)
        ## Raise exception if any of the above are missing
        if not email or not password:
            # Redirection params
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["REQUIRED_EMAIL_PASSWORD_SIGN_UP"],
                error_message="REQUIRED_EMAIL_PASSWORD_SIGN_UP",
                payload={"email": str(email)},
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)
        # Validate the email
        email = email.strip().lower()
        try:
            validate_email(email)
        except ValidationError:
            # Redirection params
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INVALID_EMAIL_SIGN_UP"],
                error_message="INVALID_EMAIL_SIGN_UP",
                payload={"email": str(email)},
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)

        # Existing user
        existing_user = User.objects.filter(email=email).first()

        if existing_user:
            # Existing User
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["USER_ALREADY_EXIST"],
                error_message="USER_ALREADY_EXIST",
                payload={"email": str(email)},
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)

        try:
            provider = EmailProvider(
                request=request,
                key=email,
                code=password,
                is_signup=True,
                callback=post_user_auth_workflow,
            )
            user = provider.authenticate()
            # Login the user and record his device info
            user_login(request=request, user=user, is_app=True)
            # Get the redirection path
            if next_path:
                path = next_path
            else:
                path = get_redirection_path(user=user)

            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=path,
                params={},
            )
            return HttpResponseRedirect(url)
        except AuthenticationException as e:
            params = e.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)
