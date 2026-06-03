# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Instance-admin lifecycle endpoints (CRUD + sign-up/in/out + me/session).

Implements the bootstrap and ongoing-admin endpoints that the standalone
admin UI uses to manage the singleton ``Instance``. Endpoints fall into
two protocol families intentionally:

* DRF JSON endpoints (extend the local ``BaseAPIView``):
  ``InstanceAdminEndpoint``, ``InstanceAdminUserMeEndpoint``,
  ``InstanceAdminUserSessionEndpoint``.

* Browser-form Django ``View`` endpoints (``HttpResponseRedirect``-based
  flows for the admin login UI): ``InstanceAdminSignUpEndpoint``,
  ``InstanceAdminSignInEndpoint``, ``InstanceAdminSignOutEndpoint``.

Both families share the same auth substrate
(``plane.authentication.utils.login.user_login`` with ``is_admin=True``)
and invalidate ``/api/instances/`` on writes so the DRF JSON surface
stays consistent with the Django form-redirect surface. The migrator
container is responsible for creating the underlying ``Instance``,
``InstanceAdmin`` and ``User``/``Profile`` tables before any of these
endpoints become reachable.
"""

# Python imports
from urllib.parse import urlencode, urljoin
import uuid
from zxcvbn import zxcvbn

# Django imports
from django.http import HttpResponseRedirect
from django.views import View
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from django.utils import timezone
from django.contrib.auth.hashers import make_password
from django.contrib.auth import logout

# Third party imports
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny

# Module imports
from .base import BaseAPIView
from plane.license.api.permissions import InstanceAdminPermission
from plane.license.api.serializers import (
    InstanceAdminMeSerializer,
    InstanceAdminSerializer,
)
from plane.license.models import Instance, InstanceAdmin
from plane.db.models import User, Profile
from plane.utils.cache import cache_response, invalidate_cache
from plane.authentication.utils.login import user_login
from plane.authentication.utils.host import base_host, user_ip
from plane.authentication.adapter.error import (
    AUTHENTICATION_ERROR_CODES,
    AuthenticationException,
)
from plane.utils.ip_address import get_client_ip
from plane.utils.path_validator import get_safe_redirect_url


class InstanceAdminEndpoint(BaseAPIView):
    """CRUD on the singleton instance's ``InstanceAdmin`` roster.

    HTTP methods + URL patterns:
        GET    /api/instances/admins/
        POST   /api/instances/admins/
        DELETE /api/instances/admins/<uuid:pk>/

    Request body (POST):
        email (str, required): email of an existing ``User`` to promote.
        role  (int, optional, default 20): role code for the new admin.

    Response shape:
        GET 200: list of ``InstanceAdminSerializer`` payloads (each carries
            a nested ``user_detail`` from ``UserAdminLiteSerializer``).
        POST 201: serialized newly-created ``InstanceAdmin`` row.
        POST 400: ``{"error": "Email is required"}`` when ``email`` is
            missing.
        403: ``{"error": "Instance is not registered yet"}`` on GET or
            POST when no singleton ``Instance`` exists.
        DELETE 204: empty body on success (no-op if ``pk`` does not exist).

    Permissions:
        ``permission_classes = [InstanceAdminPermission]``.

    Caching:
        GET wraps a 2-hour server-side cache (``cache_response(60*60*2,
        user=False)``). POST and DELETE invalidate ``/api/instances/`` via
        ``@invalidate_cache``.

    Notes:
        Extends the local ``BaseAPIView`` (``views/base.py``); ``get_queryset``
        is not overridden — admins are read via
        ``InstanceAdmin.objects.filter(instance=Instance.objects.first())``.
        DELETE returns 204 even when ``pk`` matches nothing; POST surfaces
        ``User.DoesNotExist`` through the local ``BaseAPIView``'s shared
        ``handle_exception`` translation as a generic 404.
    """

    permission_classes = [InstanceAdminPermission]

    @invalidate_cache(path="/api/instances/", user=False)
    # Create an instance admin
    def post(self, request):
        """Promote an existing user (by email) to ``InstanceAdmin`` on the singleton instance."""
        email = request.data.get("email", False)
        role = request.data.get("role", 20)

        if not email:
            return Response({"error": "Email is required"}, status=status.HTTP_400_BAD_REQUEST)

        instance = Instance.objects.first()
        if instance is None:
            return Response(
                {"error": "Instance is not registered yet"},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Fetch the user
        user = User.objects.get(email=email)

        instance_admin = InstanceAdmin.objects.create(instance=instance, user=user, role=role)
        serializer = InstanceAdminSerializer(instance_admin)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @cache_response(60 * 60 * 2, user=False)
    def get(self, request):
        """Return every ``InstanceAdmin`` row scoped to the singleton instance."""
        instance = Instance.objects.first()
        if instance is None:
            return Response(
                {"error": "Instance is not registered yet"},
                status=status.HTTP_403_FORBIDDEN,
            )
        instance_admins = InstanceAdmin.objects.filter(instance=instance)
        serializer = InstanceAdminSerializer(instance_admins, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @invalidate_cache(path="/api/instances/", user=False)
    def delete(self, request, pk):
        """Remove the ``InstanceAdmin`` row identified by ``pk`` from the singleton instance."""
        instance = Instance.objects.first()
        InstanceAdmin.objects.filter(instance=instance, pk=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class InstanceAdminSignUpEndpoint(View):
    """One-shot bootstrap signup that creates the first ``InstanceAdmin``.

    HTTP methods + URL patterns:
        POST /api/instances/admins/sign-up/

    Request body (POST form-encoded):
        email (str, required): admin email (lower-cased server-side).
        password (str, required): plaintext password (zxcvbn score >= 3).
        first_name (str, required): admin first name.
        last_name (str, optional, default ""): admin last name.
        company_name (str, optional, default ""): persisted on the new
            ``Profile`` and as ``Instance.instance_name``.
        is_telemetry_enabled (any, optional, default True): persisted on
            the singleton ``Instance``.

    Response shape:
        HTTP 302 redirects (success or failure) — this is a Django
        ``View`` flow, not a DRF JSON endpoint:
            success -> ``<base_host>/general/`` with session set.
            failure -> ``<base_host>/?<urlencoded error dict>``.

    Permissions:
        ``permission_classes = [AllowAny]`` — must be public because the
        endpoint is only reachable BEFORE any admin exists.

    Side effects:
        Creates a ``User`` with ``is_password_autoset=False`` plus a
        ``Profile`` row; promotes the user to ``InstanceAdmin``; flips
        ``instance.is_setup_done = True`` and persists ``instance_name``
        and ``is_telemetry_enabled``; logs the user in via
        ``user_login(... is_admin=True)``; invalidates ``/api/instances/``.

    Notes:
        NON-idempotent — once an admin exists the endpoint refuses with
        ``ADMIN_ALREADY_EXIST``. Failure cases use redirect-with-error
        rather than DRF error responses because this view is consumed by
        the admin browser UI form post.
    """

    permission_classes = [AllowAny]

    @invalidate_cache(path="/api/instances/", user=False)
    def post(self, request):
        """Create the bootstrap admin user + profile and mark the instance setup-done."""
        # Check instance first
        instance = Instance.objects.first()
        if instance is None:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INSTANCE_NOT_CONFIGURED"],
                error_message="INSTANCE_NOT_CONFIGURED",
            )
            url = urljoin(
                base_host(request=request, is_admin=True),
                "?" + urlencode(exc.get_error_dict()),
            )
            return HttpResponseRedirect(url)

        # check if the instance has already an admin registered
        if InstanceAdmin.objects.first():
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["ADMIN_ALREADY_EXIST"],
                error_message="ADMIN_ALREADY_EXIST",
            )
            url = urljoin(
                base_host(request=request, is_admin=True),
                "?" + urlencode(exc.get_error_dict()),
            )
            return HttpResponseRedirect(url)

        # Get the email and password from all the user
        email = request.POST.get("email", False)
        password = request.POST.get("password", False)
        first_name = request.POST.get("first_name", False)
        last_name = request.POST.get("last_name", "")
        company_name = request.POST.get("company_name", "")
        is_telemetry_enabled = request.POST.get("is_telemetry_enabled", True)

        # return error if the email and password is not present
        if not email or not password or not first_name:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["REQUIRED_ADMIN_EMAIL_PASSWORD_FIRST_NAME"],
                error_message="REQUIRED_ADMIN_EMAIL_PASSWORD_FIRST_NAME",
                payload={
                    "email": email,
                    "first_name": first_name,
                    "last_name": last_name,
                    "company_name": company_name,
                    "is_telemetry_enabled": is_telemetry_enabled,
                },
            )
            url = urljoin(
                base_host(
                    request=request,
                    is_admin=True,
                ),
                "?" + urlencode(exc.get_error_dict()),
            )
            return HttpResponseRedirect(url)

        # Validate the email
        email = email.strip().lower()
        try:
            validate_email(email)
        except ValidationError:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INVALID_ADMIN_EMAIL"],
                error_message="INVALID_ADMIN_EMAIL",
                payload={
                    "email": email,
                    "first_name": first_name,
                    "last_name": last_name,
                    "company_name": company_name,
                    "is_telemetry_enabled": is_telemetry_enabled,
                },
            )
            url = urljoin(
                base_host(request=request, is_admin=True),
                "?" + urlencode(exc.get_error_dict()),
            )
            return HttpResponseRedirect(url)

        # Check if already a user exists or not
        # Existing user
        if User.objects.filter(email=email).exists():
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["ADMIN_USER_ALREADY_EXIST"],
                error_message="ADMIN_USER_ALREADY_EXIST",
                payload={
                    "email": email,
                    "first_name": first_name,
                    "last_name": last_name,
                    "company_name": company_name,
                    "is_telemetry_enabled": is_telemetry_enabled,
                },
            )
            url = urljoin(
                base_host(request=request, is_admin=True),
                "?" + urlencode(exc.get_error_dict()),
            )
            return HttpResponseRedirect(url)
        else:
            results = zxcvbn(password)
            if results["score"] < 3:
                exc = AuthenticationException(
                    error_code=AUTHENTICATION_ERROR_CODES["PASSWORD_TOO_WEAK"],
                    error_message="PASSWORD_TOO_WEAK",
                    payload={
                        "email": email,
                        "first_name": first_name,
                        "last_name": last_name,
                        "company_name": company_name,
                        "is_telemetry_enabled": is_telemetry_enabled,
                    },
                )
                url = urljoin(
                    base_host(request=request, is_admin=True),
                    "?" + urlencode(exc.get_error_dict()),
                )
                return HttpResponseRedirect(url)

            user = User.objects.create(
                first_name=first_name,
                last_name=last_name,
                email=email,
                username=uuid.uuid4().hex,
                password=make_password(password),
                is_password_autoset=False,
            )
            _ = Profile.objects.create(user=user, company_name=company_name)
            # settings last active for the user
            user.is_active = True
            user.last_active = timezone.now()
            user.last_login_time = timezone.now()
            user.last_login_ip = get_client_ip(request=request)
            user.last_login_uagent = request.META.get("HTTP_USER_AGENT")
            user.token_updated_at = timezone.now()
            user.save()

            # Register the user as an instance admin
            _ = InstanceAdmin.objects.create(user=user, instance=instance)
            # Make the setup flag True
            instance.is_setup_done = True
            instance.instance_name = company_name
            instance.is_telemetry_enabled = is_telemetry_enabled
            instance.save()

            # get tokens for user
            user_login(request=request, user=user, is_admin=True)
            url = urljoin(base_host(request=request, is_admin=True), "general/")
            return HttpResponseRedirect(url)


class InstanceAdminSignInEndpoint(View):
    """Browser-form admin sign-in flow for existing ``InstanceAdmin`` users.

    HTTP methods + URL patterns:
        POST /api/instances/admins/sign-in/

    Request body (POST form-encoded):
        email (str, required): admin email.
        password (str, required): plaintext password.

    Response shape:
        HTTP 302 redirects (success or failure):
            success -> ``<base_host>/general/`` with session cookie set.
            failure -> ``<base_host>/?<urlencoded error dict>`` with one
                of: ``INSTANCE_NOT_CONFIGURED``,
                ``REQUIRED_ADMIN_EMAIL_PASSWORD``, ``INVALID_ADMIN_EMAIL``,
                ``ADMIN_USER_DOES_NOT_EXIST``, ``ADMIN_USER_DEACTIVATED``,
                ``ADMIN_AUTHENTICATION_FAILED``.

    Permissions:
        ``permission_classes = [AllowAny]`` — a sign-in flow cannot
        require a signed-in admin.

    Side effects:
        Updates ``last_active``, ``last_login_time``, ``last_login_ip``,
        ``last_login_uagent``, ``token_updated_at`` on the matched
        ``User``; calls ``user_login(... is_admin=True)`` to establish the
        admin session; invalidates ``/api/instances/``.

    Notes:
        Extends Django's ``View`` (not DRF) because the admin UI posts an
        HTML form and follows redirects. The ``permission_classes``
        attribute is declared for documentation parity with DRF endpoints
        but is NOT honoured by Django's ``View`` dispatch — auth gating
        is implicit in the validation chain.
    """

    permission_classes = [AllowAny]

    @invalidate_cache(path="/api/instances/", user=False)
    def post(self, request):
        """Authenticate an admin and establish the session, redirecting on success or error."""
        # Check instance first
        instance = Instance.objects.first()
        if instance is None:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INSTANCE_NOT_CONFIGURED"],
                error_message="INSTANCE_NOT_CONFIGURED",
            )
            url = urljoin(
                base_host(request=request, is_admin=True),
                "?" + urlencode(exc.get_error_dict()),
            )
            return HttpResponseRedirect(url)

        # Get email and password
        email = request.POST.get("email", False)
        password = request.POST.get("password", False)

        # return error if the email and password is not present
        if not email or not password:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["REQUIRED_ADMIN_EMAIL_PASSWORD"],
                error_message="REQUIRED_ADMIN_EMAIL_PASSWORD",
                payload={"email": email},
            )
            url = urljoin(
                base_host(request=request, is_admin=True),
                "?" + urlencode(exc.get_error_dict()),
            )
            return HttpResponseRedirect(url)

        # Validate the email
        email = email.strip().lower()
        try:
            validate_email(email)
        except ValidationError:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["INVALID_ADMIN_EMAIL"],
                error_message="INVALID_ADMIN_EMAIL",
                payload={"email": email},
            )
            url = urljoin(
                base_host(request=request, is_admin=True),
                "?" + urlencode(exc.get_error_dict()),
            )
            return HttpResponseRedirect(url)

        # Fetch the user
        user = User.objects.filter(email=email).first()

        # Error out if the user is not present
        if not user:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["ADMIN_USER_DOES_NOT_EXIST"],
                error_message="ADMIN_USER_DOES_NOT_EXIST",
                payload={"email": email},
            )
            url = urljoin(
                base_host(request=request, is_admin=True),
                "?" + urlencode(exc.get_error_dict()),
            )
            return HttpResponseRedirect(url)

        # is_active
        if not user.is_active:
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["ADMIN_USER_DEACTIVATED"],
                error_message="ADMIN_USER_DEACTIVATED",
            )
            url = urljoin(
                base_host(request=request, is_admin=True),
                "?" + urlencode(exc.get_error_dict()),
            )
            return HttpResponseRedirect(url)

        # Check password of the user
        if not user.check_password(password):
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["ADMIN_AUTHENTICATION_FAILED"],
                error_message="ADMIN_AUTHENTICATION_FAILED",
                payload={"email": email},
            )
            url = urljoin(
                base_host(request=request, is_admin=True),
                "?" + urlencode(exc.get_error_dict()),
            )
            return HttpResponseRedirect(url)

        # Check if the user is an instance admin
        if not InstanceAdmin.objects.filter(instance=instance, user=user):
            exc = AuthenticationException(
                error_code=AUTHENTICATION_ERROR_CODES["ADMIN_AUTHENTICATION_FAILED"],
                error_message="ADMIN_AUTHENTICATION_FAILED",
                payload={"email": email},
            )
            url = urljoin(
                base_host(request=request, is_admin=True),
                "?" + urlencode(exc.get_error_dict()),
            )
            return HttpResponseRedirect(url)
        # settings last active for the user
        user.is_active = True
        user.last_active = timezone.now()
        user.last_login_time = timezone.now()
        user.last_login_ip = get_client_ip(request=request)
        user.last_login_uagent = request.META.get("HTTP_USER_AGENT")
        user.token_updated_at = timezone.now()
        user.save()

        # get tokens for user
        user_login(request=request, user=user, is_admin=True)
        url = urljoin(base_host(request=request, is_admin=True), "general/")
        return HttpResponseRedirect(url)


class InstanceAdminUserMeEndpoint(BaseAPIView):
    """Return the signed-in admin's user payload for the admin console.

    HTTP methods + URL patterns:
        GET /api/instances/admins/me/

    Request body:
        Empty.

    Response shape:
        200: ``InstanceAdminMeSerializer(request.user).data`` — the 15
        admin-safe fields from ``User`` (no password hash, no sensitive
        token state).

    Permissions:
        ``permission_classes = [InstanceAdminPermission]``.

    Notes:
        Extends the local ``BaseAPIView`` (``views/base.py``);
        ``get_queryset`` is not overridden (this is a DRF ``APIView``,
        not a ``ModelViewSet``).
    """

    permission_classes = [InstanceAdminPermission]

    def get(self, request):
        """Return the serialized admin profile for ``request.user``."""
        serializer = InstanceAdminMeSerializer(request.user)
        return Response(serializer.data, status=status.HTTP_200_OK)


class InstanceAdminUserSessionEndpoint(BaseAPIView):
    """Probe endpoint reporting whether the current session is an admin session.

    HTTP methods + URL patterns:
        GET /api/instances/admins/session/

    Request body:
        Empty.

    Response shape:
        200 when authenticated AND row exists in ``InstanceAdmin``:
            {"is_authenticated": True, "user": <InstanceAdminMeSerializer>}
        200 otherwise:
            {"is_authenticated": False}

    Permissions:
        ``permission_classes = [AllowAny]`` — the endpoint is the probe
        the admin shell uses to decide whether to render the login form
        or the authenticated console, so it must be callable without an
        active admin session.

    Notes:
        Extends the local ``BaseAPIView`` (``views/base.py``);
        ``get_queryset`` is not overridden. The check is a two-step
        ``request.user.is_authenticated`` AND existence probe over
        ``InstanceAdmin`` — a regular signed-in user (non-admin) returns
        ``{"is_authenticated": False}``.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        """Report whether the active session belongs to an ``InstanceAdmin``."""
        if request.user.is_authenticated and InstanceAdmin.objects.filter(user=request.user).exists():
            serializer = InstanceAdminMeSerializer(request.user)
            data = {"is_authenticated": True}
            data["user"] = serializer.data
            return Response(data, status=status.HTTP_200_OK)
        else:
            return Response({"is_authenticated": False}, status=status.HTTP_200_OK)


class InstanceAdminSignOutEndpoint(View):
    """Browser-form admin sign-out flow that clears the admin session.

    HTTP methods + URL patterns:
        POST /api/instances/admins/sign-out/

    Request body:
        Empty.

    Response shape:
        HTTP 302 to ``<base_host>`` (safe-redirect-validated). Always
        redirects — even on internal exception — so the admin browser is
        never left on a JSON error page.

    Permissions:
        ``permission_classes = [InstanceAdminPermission]`` is declared as
        an attribute but Django's ``View`` dispatch does NOT consult it;
        the effective gate is the session check inside ``post`` —
        unauthenticated callers hit the ``except Exception`` branch and
        receive the same safe redirect.

    Side effects:
        Records ``last_logout_ip`` and ``last_logout_time`` on the
        ``User``; calls ``django.contrib.auth.logout(request)`` to clear
        the session cookie.

    Notes:
        Extends Django's ``View`` for protocol parity with the sign-up
        and sign-in flows. The exception-swallowing redirect ensures the
        admin UI can always finish a logout transition.
    """

    permission_classes = [InstanceAdminPermission]

    def post(self, request):
        """Clear the admin session cookie and redirect to the admin base host."""
        # Get user
        try:
            user = User.objects.get(pk=request.user.id)
            user.last_logout_ip = user_ip(request=request)
            user.last_logout_time = timezone.now()
            user.save()
            # Log the user out
            logout(request)
            url = get_safe_redirect_url(base_url=base_host(request=request, is_admin=True), next_path="")
            return HttpResponseRedirect(url)
        except Exception:
            url = get_safe_redirect_url(base_url=base_host(request=request, is_admin=True), next_path="")
            return HttpResponseRedirect(url)
