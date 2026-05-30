# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Magic-link authentication endpoints for the Plane app authentication flow.

This module exposes the three magic-link endpoints on the app surface:

  * :class:`MagicGenerateEndpoint` -- ``POST /auth/magic-generate/``
      Validates the deployment and the supplied ``email``, issues a magic
      code via :meth:`MagicCodeProvider.initiate`, and asynchronously
      dispatches the magic-link email by calling
      ``magic_link.delay(email, key, token)``. The HTTP response is the
      JSON ``{"key": <str>}`` payload (an opaque handle the client passes
      back on the sign-in / sign-up POST).

  * :class:`MagicSignInEndpoint` -- ``POST /auth/magic-sign-in/``
      Verifies the submitted ``code`` against the Redis-stored entry for
      ``magic_<email>``, requires the :class:`User` to already exist,
      ensures the :class:`Profile` row exists
      (``Profile.objects.get_or_create``), refreshes the session via
      :func:`user_login` (``is_app=True``), and 302-redirects to the
      caller's ``next_path`` (or ``/`` when the user has both
      ``is_password_autoset == True`` and ``profile.is_onboarded == True``,
      or :func:`get_redirection_path` otherwise).

  * :class:`MagicSignUpEndpoint` -- ``POST /auth/magic-sign-up/``
      Verifies the submitted ``code``, requires the :class:`User` to NOT
      already exist, lets :class:`MagicCodeProvider` create the account,
      refreshes the session via :func:`user_login` (``is_app=True``), and
      302-redirects to the caller's ``next_path`` (or
      :func:`get_redirection_path` when absent).

Celery handoff -- Celery via RabbitMQ
-------------------------------------

``MagicGenerateEndpoint`` enqueues the email-send via
``magic_link.delay(email, key, token)``. This is a Celery
``@shared_task`` defined in
``apps/api/plane/bgtasks/magic_link_code_task.py`` that publishes to
**RabbitMQ** -- the Plane Celery broker. Workers consuming the queue
build the magic-link email with the deployment's SMTP configuration and
send it via Django's ``EmailMultiAlternatives``.

**Redis is NOT a task broker in Plane.** Redis is used elsewhere in this
module for:

  * Storing the issued magic code (with TTL) inside
    :class:`MagicCodeProvider` -- see
    ``apps/api/plane/authentication/provider/credentials/magic_code.py``.
    This is Redis-as-cache / Redis-as-key-value-store, not a queue.
  * Backing the Django session that :func:`user_login` refreshes on
    successful sign-in / sign-up.

Error envelope contracts
------------------------

* :class:`MagicGenerateEndpoint` returns JSON: success
  ``{"key": <str>}`` with HTTP 200, error
  :meth:`AuthenticationException.get_error_dict` with HTTP 400.
* :class:`MagicSignInEndpoint` and :class:`MagicSignUpEndpoint` return
  HTTP 302 redirects to ``base_host(is_app=True)`` constructed via
  :func:`get_safe_redirect_url` (which validates ``next_path`` to defeat
  open-redirect attacks). On error, the redirect query string carries
  :meth:`AuthenticationException.get_error_dict`.

:data:`AUTHENTICATION_ERROR_CODES` keys raised by this module:

  * ``INSTANCE_NOT_CONFIGURED``
  * ``MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED`` /
    ``MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED``
  * ``USER_DOES_NOT_EXIST`` (sign-in only)
  * ``USER_ALREADY_EXIST`` (sign-up only)
  * any code raised by :meth:`MagicCodeProvider.authenticate` (e.g.,
    ``INVALID_MAGIC_CODE_SIGN_IN`` / ``..._SIGN_UP``,
    ``EXPIRED_MAGIC_CODE_SIGN_IN`` / ``..._SIGN_UP``,
    ``INVALID_EMAIL_MAGIC_SIGN_IN`` / ``..._SIGN_UP``)

Architectural notes:

  * Magic-link email delivery: **Celery via RabbitMQ** (NOT Redis).
  * Magic-code storage and Django session storage: **Redis** (cache /
    session only, NOT queueing).
  * Migrator container has already run schema migrations by import time;
    ``User`` / ``Profile`` queries assume the target revision.
"""

# Django imports
from django.core.validators import validate_email
from django.http import HttpResponseRedirect
from django.views import View

# Third party imports
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

# Module imports
from plane.authentication.provider.credentials.magic_code import MagicCodeProvider
from plane.authentication.utils.login import user_login
from plane.authentication.utils.redirection_path import get_redirection_path
from plane.authentication.utils.user_auth_workflow import post_user_auth_workflow
from plane.bgtasks.magic_link_code_task import magic_link
from plane.license.models import Instance
from plane.authentication.utils.host import base_host
from plane.db.models import User, Profile
from plane.authentication.adapter.error import (
    AuthenticationException,
    AUTHENTICATION_ERROR_CODES,
)
from plane.authentication.rate_limit import AuthenticationThrottle
from plane.utils.path_validator import get_safe_redirect_url


class MagicGenerateEndpoint(APIView):
    """Issue a magic code and asynchronously email the magic link.

    HTTP method / URL:
        ``POST /auth/magic-generate/``

    Permission:
        ``permission_classes = [AllowAny]`` -- the caller is pre-login and
        not yet authenticated.

    Throttling:
        ``throttle_classes = [AuthenticationThrottle]`` -- rate-limited to
        bound magic-link spam and email-enumeration probing.

    Request body (JSON):
        * ``email`` (str, required) -- candidate email address.

    Response shapes:
        * HTTP 200 -- ``{"key": <str>}``. The opaque key is the handle the
          client re-submits on the sign-in / sign-up endpoint.
        * HTTP 400 -- :meth:`AuthenticationException.get_error_dict`
          envelope with error code ``INSTANCE_NOT_CONFIGURED`` or any
          ``AuthenticationException`` raised by
          :meth:`MagicCodeProvider.initiate` (e.g., ``INVALID_EMAIL``-style
          codes, ``MAGIC_LINK_LOGIN_DISABLED``).

    Side effects:
        * Reads :class:`Instance.objects.first` (deployment gate).
        * Calls :meth:`MagicCodeProvider.initiate` which writes the
          generated code into the **Redis** key-value store (TTL-bound;
          Redis here is cache/storage -- NOT a task broker).
        * **Enqueues the Celery task** ``magic_link.delay(email, key, token)``
          (defined in ``apps/api/plane/bgtasks/magic_link_code_task.py``).
          The task is published to the project's **RabbitMQ** broker and
          consumed by Celery workers that send the magic-link email via
          Django's SMTP configuration.
        * No database writes from this view; the account is not created
          here -- ``MagicCodeProvider.initiate`` only stages the code.
    """

    permission_classes = [AllowAny]

    throttle_classes = [AuthenticationThrottle]

    def post(self, request):
        """Stage a magic code in Redis and enqueue the magic-link email task via RabbitMQ."""
        # Check if instance is configured
        instance = Instance.objects.first()
        if instance is None or not instance.is_setup_done:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INSTANCE_NOT_CONFIGURED"],
                error_message="INSTANCE_NOT_CONFIGURED",
            )
            return Response(exc.get_error_dict(), status=status.HTTP_400_BAD_REQUEST)

        email = request.data.get("email", "").strip().lower()
        try:
            validate_email(email)
            adapter = MagicCodeProvider(request=request, key=email)
            key, token = adapter.initiate()
            # If the smtp is configured send through here
            magic_link.delay(email, key, token)
            return Response({"key": str(key)}, status=status.HTTP_200_OK)
        except AuthenticationException as e:
            params = e.get_error_dict()
            return Response(params, status=status.HTTP_400_BAD_REQUEST)


class MagicSignInEndpoint(View):
    """Verify a magic code for an existing user and refresh the app session.

    HTTP method / URL:
        ``POST /auth/magic-sign-in/``

    Inheritance:
        :class:`django.views.View` -- not a DRF ``APIView``. No
        ``permission_classes`` is declared; effectively anonymous-accessible
        because the caller has not yet authenticated.

    Request body (form-encoded POST):
        * ``code`` (str, required) -- the magic code received by email.
        * ``email`` (str, required) -- the email associated with the code.
        * ``next_path`` (str, optional) -- post-auth redirect target.

    Pre-condition:
        A :class:`User` with the given ``email`` MUST exist. If not, the
        response carries ``USER_DOES_NOT_EXIST`` (use the sign-up endpoint
        for new accounts).

    Response:
        * HTTP 302 redirect on success -- target is ``/`` when the user
          has ``is_password_autoset == True`` AND
          ``profile.is_onboarded == True``; otherwise the supplied
          ``next_path`` (or :func:`get_redirection_path` when absent).
        * HTTP 302 redirect with ``?<urlencoded params>`` on error,
          constructed via :func:`get_safe_redirect_url` so ``next_path``
          is open-redirect-safe.

    Side effects:
        * Reads :class:`User.objects.filter(email=email).first`.
        * Calls :meth:`MagicCodeProvider.authenticate` with
          ``key=f"magic_{email}"``, ``code=code``, and
          ``callback=post_user_auth_workflow`` -- consumes (and on
          success removes) the Redis-stored magic-code entry, loads the
          existing user.
        * Calls :meth:`Profile.objects.get_or_create(user=user)` to
          guarantee a :class:`Profile` row exists (defensive for legacy
          accounts that may have skipped profile creation).
        * Calls :func:`user_login` (``is_app=True``) -- refreshes the
          Redis-backed Django session.

    Error codes:
        ``MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED``, ``USER_DOES_NOT_EXIST``,
        plus any code raised by :meth:`MagicCodeProvider.authenticate`
        (e.g., ``INVALID_MAGIC_CODE_SIGN_IN``,
        ``EXPIRED_MAGIC_CODE_SIGN_IN``,
        ``INVALID_EMAIL_MAGIC_SIGN_IN``).
    """

    def post(self, request):
        """Validate the magic code, ensure profile, refresh session, and redirect."""
        # set the referer as session to redirect after login
        code = request.POST.get("code", "").strip()
        email = request.POST.get("email", "").strip().lower()
        next_path = request.POST.get("next_path")

        if code == "" or email == "":
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED"],
                error_message="MAGIC_SIGN_IN_EMAIL_CODE_REQUIRED",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)

        # Existing User
        existing_user = User.objects.filter(email=email).first()

        if not existing_user:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["USER_DOES_NOT_EXIST"],
                error_message="USER_DOES_NOT_EXIST",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)

        try:
            provider = MagicCodeProvider(
                request=request,
                key=f"magic_{email}",
                code=code,
                callback=post_user_auth_workflow,
            )
            user = provider.authenticate()
            profile, _ = Profile.objects.get_or_create(user=user)
            # Login the user and record his device info
            user_login(request=request, user=user, is_app=True)
            if user.is_password_autoset and profile.is_onboarded:
                # Redirect to the home page
                path = "/"
            else:
                # Get the redirection path
                path = str(next_path) if next_path else str(get_redirection_path(user=user))
            # redirect to referer path
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


class MagicSignUpEndpoint(View):
    """Verify a magic code for a new account and refresh the app session.

    HTTP method / URL:
        ``POST /auth/magic-sign-up/``

    Inheritance:
        :class:`django.views.View` -- not a DRF ``APIView``. No
        ``permission_classes`` is declared; effectively anonymous-accessible
        because the caller is creating an account.

    Request body (form-encoded POST):
        * ``code`` (str, required) -- the magic code received by email.
        * ``email`` (str, required) -- the email associated with the code.
        * ``next_path`` (str, optional) -- post-auth redirect target.

    Pre-condition:
        A :class:`User` with the given ``email`` MUST NOT already exist.
        If one does, the response carries ``USER_ALREADY_EXIST`` (use the
        sign-in endpoint for existing accounts).

    Response:
        * HTTP 302 redirect on success -- target is the supplied
          ``next_path`` (or :func:`get_redirection_path` when absent).
        * HTTP 302 redirect with ``?<urlencoded params>`` on error,
          constructed via :func:`get_safe_redirect_url`.

    Side effects:
        * Reads :class:`User.objects.filter(email=email).first`.
        * Calls :meth:`MagicCodeProvider.authenticate` with
          ``key=f"magic_{email}"``, ``code=code``, and
          ``callback=post_user_auth_workflow`` -- consumes the Redis-
          stored magic-code entry and **creates** the :class:`User` (the
          provider handles account creation for sign-up).
        * Calls :func:`user_login` (``is_app=True``) -- refreshes the
          Redis-backed Django session.

    Error codes:
        ``MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED``, ``USER_ALREADY_EXIST``,
        plus any code raised by :meth:`MagicCodeProvider.authenticate`
        (e.g., ``INVALID_MAGIC_CODE_SIGN_UP``,
        ``EXPIRED_MAGIC_CODE_SIGN_UP``,
        ``INVALID_EMAIL_MAGIC_SIGN_UP``).
    """

    def post(self, request):
        """Validate the magic code, create the account, refresh session, and redirect."""
        # set the referer as session to redirect after login
        code = request.POST.get("code", "").strip()
        email = request.POST.get("email", "").strip().lower()
        next_path = request.POST.get("next_path")

        if code == "" or email == "":
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED"],
                error_message="MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED",
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
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["USER_ALREADY_EXIST"],
                error_message="USER_ALREADY_EXIST",
            )
            params = exc.get_error_dict()
            url = get_safe_redirect_url(
                base_url=base_host(request=request, is_app=True),
                next_path=next_path,
                params=params,
            )
            return HttpResponseRedirect(url)

        try:
            provider = MagicCodeProvider(
                request=request,
                key=f"magic_{email}",
                code=code,
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
            # redirect to referer path
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
