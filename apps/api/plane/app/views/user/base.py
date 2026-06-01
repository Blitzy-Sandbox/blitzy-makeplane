# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Current-user (self) Django REST Framework endpoints for the Plane app.

Every endpoint in this module operates on ``request.user`` and is mounted
under the ``/api/users/`` URL prefix (see ``apps/api/plane/app/urls/user.py``);
none of the routes accept a ``<user_id>`` parameter, so the authenticated
session always identifies the target record.

The exported view classes cover profile retrieval/update, settings retrieval,
the instance-admin check, the magic-code email-change lifecycle, account
deactivation, session inspection, onboarding/tour flag updates, the paginated
user activity feed, OAuth ``Account`` listing/deletion, and ``Profile``
read/patch.

Asynchronous side effects (deactivation confirmation email, email-change
magic code issuance, and email-change confirmations) are dispatched through
Celery (routed via RabbitMQ). The magic-code itself is persisted in Django's
cache backend (Redis -- caching/session only, not a task queue) with a
10-minute TTL.
"""

# Python imports
import uuid
import json
import logging
import secrets

# Django imports
from django.db.models import Case, Count, IntegerField, Q, When
from django.contrib.auth import logout
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.cache import cache_control
from django.views.decorators.vary import vary_on_cookie
from django.core.validators import validate_email
from django.core.cache import cache

# Third party imports
from rest_framework import status
from rest_framework.response import Response
from rest_framework.permissions import AllowAny

# Module imports
from plane.app.serializers import (
    AccountSerializer,
    IssueActivitySerializer,
    ProfileSerializer,
    UserMeSerializer,
    UserMeSettingsSerializer,
    UserSerializer,
)
from plane.app.views.base import BaseAPIView, BaseViewSet
from plane.db.models import (
    Account,
    IssueActivity,
    Profile,
    ProjectMember,
    User,
    WorkspaceMember,
    WorkspaceMemberInvite,
    Session,
)
from plane.license.models import Instance, InstanceAdmin
from plane.utils.paginator import BasePaginator
from plane.authentication.utils.host import user_ip
from plane.bgtasks.user_deactivation_email_task import user_deactivation_email
from plane.utils.host import base_host
from plane.bgtasks.user_email_update_task import send_email_update_magic_code, send_email_update_confirmation
from plane.authentication.rate_limit import EmailVerificationThrottle


logger = logging.getLogger("plane")


class UserEndpoint(BaseViewSet):
    """Current-user (self) view set: profile, settings, instance-admin, email change, and deactivation.

    HTTP methods + URL patterns (mapped in ``apps/api/plane/app/urls/user.py``):
        - ``GET    /api/users/me/``                          -> ``retrieve``
          (returns ``UserMeSerializer`` payload)
        - ``PATCH  /api/users/me/``                          -> ``partial_update``
          (writable subset of ``UserSerializer``)
        - ``DELETE /api/users/me/``                          -> ``deactivate``
          (account shutdown; see ``deactivate`` for the full side-effect chain)
        - ``GET    /api/users/me/settings/``                 -> ``retrieve_user_settings``
          (returns ``UserMeSettingsSerializer``)
        - ``GET    /api/users/me/instance-admin/``           -> ``retrieve_instance_admin``
        - ``POST   /api/users/me/email/generate-code/``      -> ``generate_email_verification_code``
          (throttled by ``EmailVerificationThrottle``, 3/hour per user)
        - ``PATCH  /api/users/me/email/``                    -> ``update_email``

    Request body schemas:
        - ``PATCH /api/users/me/``: writable subset of ``UserSerializer`` --
          ``first_name``, ``last_name``, ``display_name``, ``avatar``,
          ``avatar_url``, ``cover_image``, ``cover_image_url``,
          ``user_timezone`` (everything in ``UserSerializer.Meta.fields`` that
          is not listed in ``UserSerializer.Meta.read_only_fields``).
          ``validate_first_name`` / ``validate_last_name`` reject values that
          contain a URL.
        - ``POST /api/users/me/email/generate-code/``: ``{"email": "<new_email>"}``.
        - ``PATCH /api/users/me/email/``: ``{"email": "<new_email>", "code": "<6-digit-token>"}``.

    Response shapes:
        - ``retrieve`` -> ``UserMeSerializer`` (id, avatar, cover_image,
          avatar_url, cover_image_url, date_joined, display_name, email,
          first_name, last_name, is_active, is_bot, is_email_verified,
          user_timezone, username, is_password_autoset, last_login_medium,
          last_login_time).
        - ``retrieve_user_settings`` -> ``UserMeSettingsSerializer``
          (id, email, workspace).
        - ``retrieve_instance_admin`` -> ``{"is_instance_admin": bool}``.
        - ``partial_update`` -> serialized ``UserSerializer`` (DRF default).
        - ``generate_email_verification_code`` -> ``{"message": "Verification
          code sent to email"}`` on success; ``{"error": "..."}`` on validation
          failure (HTTP 400) or HTTP 429 via
          ``EmailVerificationThrottle.throttle_failure_view`` on rate-limit.
        - ``update_email`` -> ``UserMeSerializer`` on success; ``{"error":
          "..."}`` (HTTP 400) on token / availability failure.
        - ``deactivate`` -> HTTP 204 with empty body on success; ``{"error":
          "..."}`` (HTTP 400) if the user is an instance admin or the sole
          admin in some workspace or project.

    Permissions:
        Inherits ``permission_classes = [IsAuthenticated]`` from ``BaseViewSet``
        (see ``apps/api/plane/app/views/base.py``). There is no workspace or
        project scope -- the view is bound to ``request.user`` via the
        ``get_object`` override.

    Caching:
        ``retrieve`` and ``retrieve_user_settings`` are wrapped with
        ``cache_control(private=True, max_age=12)`` and ``vary_on_cookie``, so
        each authenticated client gets a 12-second private cache that varies by
        session cookie.

    Throttling:
        Only ``generate_email_verification_code`` is throttled (3 requests per
        hour per user via ``EmailVerificationThrottle`` -- wired in
        ``get_throttles``). All other actions inherit DRF defaults.

    Read replica:
        ``use_read_replica = True`` -- read-heavy operations are routed to the
        PostgreSQL read replica via ``ReadReplicaControlMixin``.

    Side effects (email change / deactivate):
        ``send_email_update_magic_code``,
        ``send_email_update_confirmation``, and
        ``user_deactivation_email`` Celery tasks are dispatched via
        RabbitMQ (worker modules
        :mod:`plane.bgtasks.user_email_update_task` and
        :mod:`plane.bgtasks.user_deactivation_email_task`).

    Cross-references:
        * Serializers: ``UserSerializer``, ``UserMeSerializer``,
          ``UserMeSettingsSerializer`` in
          ``apps/api/plane/app/serializers/user.py``.
        * Models: ``User``, ``Account``, ``Profile`` in
          ``apps/api/plane/db/models/user.py`` and
          ``apps/api/plane/db/models/social_connection.py``;
          ``Instance``, ``InstanceAdmin`` in
          ``apps/api/plane/license/models/`` (license module).
        * Permissions: inherited DRF ``IsAuthenticated``; no custom
          permission file.
        * Throttle: ``EmailVerificationThrottle`` in
          ``apps/api/plane/authentication/rate_limit.py``.
        * Celery tasks:
          ``apps/api/plane/bgtasks/user_email_update_task.py``,
          ``apps/api/plane/bgtasks/user_deactivation_email_task.py``
          (queued via RabbitMQ).
        * URL registration:
          ``apps/api/plane/app/urls/user.py``.
    """

    serializer_class = UserSerializer
    model = User
    use_read_replica = True

    def get_object(self):
        """Return the authenticated user; binds every action to ``request.user``."""
        return self.request.user

    def get_throttles(self):
        """Apply rate limiting to specific endpoints."""
        if self.action == "generate_email_verification_code":
            return [EmailVerificationThrottle()]
        return super().get_throttles()

    @method_decorator(cache_control(private=True, max_age=12))
    @method_decorator(vary_on_cookie)
    def retrieve(self, request):
        """Return the current user's profile via ``UserMeSerializer`` (12-second private cache)."""
        serialized_data = UserMeSerializer(request.user).data
        return Response(serialized_data, status=status.HTTP_200_OK)

    @method_decorator(cache_control(private=True, max_age=12))
    @method_decorator(vary_on_cookie)
    def retrieve_user_settings(self, request):
        """Return the current user's settings via ``UserMeSettingsSerializer`` (12-second private cache)."""
        serialized_data = UserMeSettingsSerializer(request.user).data
        return Response(serialized_data, status=status.HTTP_200_OK)

    def retrieve_instance_admin(self, request):
        """Report whether the current user is an instance administrator on the first ``Instance`` row."""
        instance = Instance.objects.first()
        is_admin = InstanceAdmin.objects.filter(instance=instance, user=request.user).exists()
        return Response({"is_instance_admin": is_admin}, status=status.HTTP_200_OK)

    def partial_update(self, request, *args, **kwargs):
        """Update the current user partially via the default ``ModelViewSet.partial_update``.

        The write surface is constrained by ``UserSerializer.Meta.read_only_fields``,
        so sensitive attributes such as ``email``, ``is_active``, and ``is_staff``
        cannot be mutated through this path; ``email`` changes go through the
        ``generate_email_verification_code`` / ``update_email`` workflow.
        """
        return super().partial_update(request, *args, **kwargs)

    def _validate_new_email(self, user, new_email):
        """
        Validate the new email address.

        Args:
            user: The User instance
            new_email: The new email address to validate

        Returns:
            Response object with error if validation fails, None if validation passes
        """
        if not new_email:
            return Response(
                {"error": "Email is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate email format
        try:
            validate_email(new_email)
        except Exception:
            return Response(
                {"error": "Invalid email format"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check if email is the same as current email
        if new_email == user.email:
            return Response(
                {"error": "New email must be different from current email"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check if email already exists in the User model
        if User.objects.filter(email=new_email).exclude(id=user.id).exists():
            return Response(
                {"error": "An account with this email already exists"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return None

    def generate_email_verification_code(self, request):
        """Generate and send a magic code to the new email address for verification (Celery via RabbitMQ).

        Rate limited to 3 requests per hour per user (enforced by EmailVerificationThrottle).
        Additional per-email cooldown of 60 seconds prevents rapid repeated requests.
        The magic-code email is dispatched through Celery via RabbitMQ via
        :func:`plane.bgtasks.user_email_update_task.send_email_update_magic_code`.
        """
        user = self.get_object()
        new_email = request.data.get("email", "").strip().lower()

        # Validate the new email
        validation_error = self._validate_new_email(user, new_email)
        if validation_error:
            return validation_error

        try:
            # Generate magic code for email verification
            # Use a special key prefix to distinguish from regular magic signin
            # Include user ID to bind the code to the specific user
            cache_key = f"magic_email_update_{user.id}_{new_email}"
            ## Generate a random token
            token = str(secrets.randbelow(900000) + 100000)
            # Store in cache with 10 minute expiration
            cache_data = json.dumps({"token": token})
            cache.set(cache_key, cache_data, timeout=600)

            # Send magic code to the new email
            send_email_update_magic_code.delay(new_email, token)

            return Response(
                {"message": "Verification code sent to email"},
                status=status.HTTP_200_OK,
            )
        except Exception as e:
            logger.error("Failed to generate verification code: %s", str(e), exc_info=True)
            return Response(
                {"error": "Failed to generate verification code. Please try again."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    def update_email(self, request):
        """Verify the magic code and update the user's email address (Celery via RabbitMQ).

        This endpoint verifies the code and updates the existing user record
        without creating a new user, ensuring the user ID remains unchanged.
        On success, dispatches ``send_email_update_confirmation`` Celery
        tasks (RabbitMQ) to both the old and new email addresses via
        :mod:`plane.bgtasks.user_email_update_task`.
        """
        user = self.get_object()
        new_email = request.data.get("email", "").strip().lower()
        code = request.data.get("code", "").strip()

        # Validate the new email
        validation_error = self._validate_new_email(user, new_email)
        if validation_error:
            return validation_error

        if not code:
            return Response(
                {"error": "Verification code is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Verify the magic code
        try:
            cache_key = f"magic_email_update_{user.id}_{new_email}"
            cached_data = cache.get(cache_key)

            if not cached_data:
                logger.warning("Cache key not found: %s. Code may have expired or was never generated.", cache_key)
                return Response(
                    {"error": "Verification code has expired or is invalid"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            data = json.loads(cached_data)
            stored_token = data.get("token")

            if str(stored_token) != str(code):
                return Response(
                    {"error": "Invalid verification code"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        except Exception:
            return Response(
                {"error": "Failed to verify code. Please try again."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Final check: ensure email is still available (might have been taken between code generation and update)
        if User.objects.filter(email=new_email).exclude(id=user.id).exists():
            return Response(
                {"error": "An account with this email already exists"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        old_email = user.email
        # Update the email - this updates the existing user record without creating a new user
        user.email = new_email
        # Reset email verification status when email is changed
        user.is_email_verified = False
        user.save()

        # delete the cache
        cache.delete(cache_key)

        # Logout the user
        logout(request)

        # Send confirmation email to the new email address
        send_email_update_confirmation.delay(new_email)
        # send the email to the old email address
        send_email_update_confirmation.delay(old_email)

        # Return updated user data
        serialized_data = UserMeSerializer(user).data
        return Response(serialized_data, status=status.HTTP_200_OK)

    def deactivate(self, request):
        """Deactivate the authenticated user; cascade the shutdown to memberships, sessions, and credentials.

        Triggered by ``DELETE /api/users/me/`` and initiated by the user themselves.

        Pre-checks (each returns HTTP 400 if it fails):
            - Rejects instance admins (an instance admin cannot self-deactivate).
            - Rejects users who are the sole admin of any project or workspace
              that still has other members.

        Side effects (executed sequentially -- NOT wrapped in a single
        transaction; partial failure can leave the user in an intermediate state):
            - Marks ``ProjectMember.is_active = False`` via ``bulk_update`` for
              every project where another admin remains or the user is the only
              member.
            - Marks ``WorkspaceMember.is_active = False`` via ``bulk_update``
              under the same conditional rule.
            - Deletes all ``WorkspaceMemberInvite`` rows that match the user's
              email (pending invitations are revoked).
            - Deletes all ``Session`` rows for the user, invalidating every
              active session (Redis-backed via the configured session backend).
            - Resets the ``Profile`` onboarding state
              (``last_workspace_id``, ``is_tour_completed``, ``is_onboarded``,
              ``onboarding_step``).
            - Randomizes the password to ``uuid.uuid4().hex`` and sets
              ``is_password_autoset = True``.
            - Sets ``User.is_active = False`` and records ``last_logout_ip``
              plus ``last_logout_time``.
            - Enqueues ``user_deactivation_email.delay(...)`` -- a Celery task
              (routed through RabbitMQ) defined in
              ``apps/api/plane/bgtasks/user_deactivation_email_task.py`` that
              sends the deactivation confirmation email asynchronously.
            - Calls ``logout(request)`` to clear the current request's session
              cookie.

        Idempotency:
            NOT idempotent -- calling this action again after deactivation will
            still re-randomize the password and re-enqueue the email task.

        Response:
            HTTP 204 with an empty body on success.
        """
        # Check all workspace user is active
        user = self.get_object()

        # Instance admin check
        if InstanceAdmin.objects.filter(user=user).exists():
            return Response(
                {"error": "You cannot deactivate your account since you are an instance admin"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        projects_to_deactivate = []
        workspaces_to_deactivate = []

        projects = ProjectMember.objects.filter(member=request.user, is_active=True).annotate(
            other_admin_exists=Count(
                Case(
                    When(Q(role=20, is_active=True) & ~Q(member=request.user), then=1),
                    default=0,
                    output_field=IntegerField(),
                )
            ),
            total_members=Count("id"),
        )

        for project in projects:
            if project.other_admin_exists > 0 or (project.total_members == 1):
                project.is_active = False
                projects_to_deactivate.append(project)
            else:
                return Response(
                    {"error": "You cannot deactivate account as you are the only admin in some projects."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        workspaces = WorkspaceMember.objects.filter(member=request.user, is_active=True).annotate(
            other_admin_exists=Count(
                Case(
                    When(Q(role=20, is_active=True) & ~Q(member=request.user), then=1),
                    default=0,
                    output_field=IntegerField(),
                )
            ),
            total_members=Count("id"),
        )

        for workspace in workspaces:
            if workspace.other_admin_exists > 0 or (workspace.total_members == 1):
                workspace.is_active = False
                workspaces_to_deactivate.append(workspace)
            else:
                return Response(
                    {"error": "You cannot deactivate account as you are the only admin in some workspaces."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        ProjectMember.objects.bulk_update(projects_to_deactivate, ["is_active"], batch_size=100)

        WorkspaceMember.objects.bulk_update(workspaces_to_deactivate, ["is_active"], batch_size=100)

        # Delete all workspace invites
        WorkspaceMemberInvite.objects.filter(email=user.email).delete()

        # Delete all sessions
        Session.objects.filter(user_id=request.user.id).delete()

        # Profile updates
        profile = Profile.objects.get(user=user)

        # Reset onboarding
        profile.last_workspace_id = None
        profile.is_tour_completed = False
        profile.is_onboarded = False
        profile.onboarding_step = {
            "workspace_join": False,
            "profile_complete": False,
            "workspace_create": False,
            "workspace_invite": False,
        }
        profile.save()

        # Reset password
        user.is_password_autoset = True
        user.set_password(uuid.uuid4().hex)

        # Deactivate the user
        user.is_active = False
        user.last_logout_ip = user_ip(request=request)
        user.last_logout_time = timezone.now()
        user.save()

        # Send an email to the user
        user_deactivation_email.delay(base_host(request=request, is_app=True), user.id)

        # Logout the user
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class UserSessionEndpoint(BaseAPIView):
    """Report whether the incoming request carries an authenticated session.

    HTTP method + URL:
        ``GET /api/users/session/`` -> ``get``.

    Request body:
        None (GET only).

    Permissions:
        ``permission_classes = [AllowAny]`` (declared on the class
        attribute; see ``apps/api/plane/app/views/user/base.py``) --
        explicit override of ``BaseAPIView``'s default
        ``[IsAuthenticated]`` so this endpoint can return
        ``{"is_authenticated": false}`` instead of a 401 when the
        caller has no session. This is the only view in the module
        that is publicly reachable.

    Response shape:
        - Authenticated -> ``{"is_authenticated": true, "user": <UserMeSerializer
          payload>}``.
        - Unauthenticated -> ``{"is_authenticated": false}``.

    The view reads the session cookie (Redis-backed session store) but does
    not enqueue any Celery task or write to the database. Redis here is
    used for session storage and caching only; task queueing flows
    through Celery via RabbitMQ.

    Cross-references:
        * Serializer: ``UserMeSerializer`` in
          ``apps/api/plane/app/serializers/user.py``.
        * Model: ``User`` in ``apps/api/plane/db/models/user.py``.
        * URL registration: ``apps/api/plane/app/urls/user.py``.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        """Return ``{is_authenticated, user?}`` based on the request session state (no auth required)."""
        if request.user.is_authenticated:
            user = User.objects.get(pk=request.user.id)
            serializer = UserMeSerializer(user)
            data = {"is_authenticated": True}
            data["user"] = serializer.data
            return Response(data, status=status.HTTP_200_OK)
        else:
            return Response({"is_authenticated": False}, status=status.HTTP_200_OK)


class UpdateUserOnBoardedEndpoint(BaseAPIView):
    """Flip the ``is_onboarded`` boolean on the authenticated user's ``Profile``.

    HTTP method + URL:
        ``PATCH /api/users/me/onboard/`` -> ``patch``.

    Request body:
        ``{"is_onboarded": <bool>}`` -- value defaults to ``False`` if omitted.

    Permissions:
        Inherits ``[IsAuthenticated]`` from ``BaseAPIView``.

    Response shape:
        ``{"message": "Updated successfully"}`` with HTTP 200.

    Idempotency:
        Idempotent -- repeated PATCHes with the same payload converge to the
        same ``Profile.is_onboarded`` value.
    """

    def patch(self, request):
        """Set ``Profile.is_onboarded`` to the value in the request body (defaults to ``False``)."""
        profile = Profile.objects.get(user_id=request.user.id)
        profile.is_onboarded = request.data.get("is_onboarded", False)
        profile.save()
        return Response({"message": "Updated successfully"}, status=status.HTTP_200_OK)


class UpdateUserTourCompletedEndpoint(BaseAPIView):
    """Flip the ``is_tour_completed`` boolean on the authenticated user's ``Profile``.

    HTTP method + URL:
        ``PATCH /api/users/me/tour-completed/`` -> ``patch``.

    Request body:
        ``{"is_tour_completed": <bool>}`` -- value defaults to ``False`` if omitted.

    Permissions:
        Inherits ``[IsAuthenticated]`` from ``BaseAPIView``.

    Response shape:
        ``{"message": "Updated successfully"}`` with HTTP 200.

    Idempotency:
        Idempotent -- repeated PATCHes with the same payload converge to the
        same ``Profile.is_tour_completed`` value.
    """

    def patch(self, request):
        """Set ``Profile.is_tour_completed`` to the value in the request body (defaults to ``False``)."""
        profile = Profile.objects.get(user_id=request.user.id)
        profile.is_tour_completed = request.data.get("is_tour_completed", False)
        profile.save()
        return Response({"message": "Updated successfully"}, status=status.HTTP_200_OK)


class UserActivityEndpoint(BaseAPIView, BasePaginator):
    """Paginated feed of ``IssueActivity`` rows where the authenticated user is the actor.

    HTTP method + URL:
        ``GET /api/users/me/activities/`` -> ``get``.

    Query parameters:
        - ``order_by`` (optional, defaults to ``-created_at``).
        - Standard pagination parameters consumed by ``BasePaginator``.

    Permissions:
        Inherits ``[IsAuthenticated]`` from ``BaseAPIView``.

    Response shape:
        ``BasePaginator`` envelope wrapping ``IssueActivitySerializer(many=True).data``.

    Queryset filter:
        ``IssueActivity.objects.filter(actor=request.user)`` with
        ``select_related("actor", "workspace", "issue", "project")``. The result
        is explicitly scoped to the authenticated user; cross-workspace
        activity is visible only because the user could only have been the
        actor inside workspaces they belong to.

    Request body:
        None (GET only); pagination uses query parameters.

    Cross-references:
        * Serializer: ``IssueActivitySerializer`` in
          ``apps/api/plane/app/serializers/issue.py``.
        * Model: ``IssueActivity`` in
          ``apps/api/plane/db/models/issue.py``.
        * URL registration: ``apps/api/plane/app/urls/user.py``.
    """

    def get(self, request):
        """Return a paginated feed of ``IssueActivity`` rows where the current user is the actor.

        Queryset filter: ``actor=request.user`` with ``select_related`` joins
        on actor/workspace/issue/project.
        """
        queryset = IssueActivity.objects.filter(actor=request.user).select_related(
            "actor", "workspace", "issue", "project"
        )

        return self.paginate(
            order_by=request.GET.get("order_by", "-created_at"),
            request=request,
            queryset=queryset,
            on_results=lambda issue_activities: IssueActivitySerializer(issue_activities, many=True).data,
        )


class AccountEndpoint(BaseAPIView):
    """List or delete OAuth/social ``Account`` rows belonging to the authenticated user.

    HTTP methods + URL patterns:
        - ``GET    /api/users/me/accounts/``             -> ``get`` (list every linked account).
        - ``GET    /api/users/me/accounts/<uuid:pk>/``   -> ``get`` (retrieve a single linked account).
        - ``DELETE /api/users/me/accounts/<uuid:pk>/``   -> ``delete`` (unlink a single account).

    Permissions:
        Inherits ``[IsAuthenticated]`` from ``BaseAPIView``.

    Response shapes:
        - ``get`` -> ``AccountSerializer`` for one record when ``pk`` is given,
          or for many records when ``pk`` is omitted.
        - ``delete`` -> HTTP 204 with an empty body.

    Filter logic:
        Every query filters ``Account.objects.filter(user=request.user)``, so a
        user may only inspect or remove their own linked accounts.

    Request body:
        None (GET and DELETE are body-less).

    Cross-references:
        * Serializer: ``AccountSerializer`` in
          ``apps/api/plane/app/serializers/user.py``.
        * Model: ``Account`` in
          ``apps/api/plane/db/models/social_connection.py``.
        * URL registration: ``apps/api/plane/app/urls/user.py``.
    """

    def get(self, request, pk=None):
        """Return one or all OAuth ``Account`` rows owned by the current user.

        When ``pk`` is provided, returns a single serialized record; otherwise
        returns the list.
        """
        if pk:
            account = Account.objects.get(pk=pk, user=request.user)
            serializer = AccountSerializer(account)
            return Response(serializer.data, status=status.HTTP_200_OK)

        account = Account.objects.filter(user=request.user)
        serializer = AccountSerializer(account, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def delete(self, request, pk):
        """Delete a single OAuth ``Account`` record owned by the current user (HTTP 204)."""
        account = Account.objects.get(pk=pk, user=request.user)
        account.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProfileEndpoint(BaseAPIView):
    """Cached read and partial-update surface for the authenticated user's ``Profile``.

    HTTP methods + URL:
        ``GET /api/users/me/profile/``   -> ``get``.
        ``PATCH /api/users/me/profile/`` -> ``patch``.

    Permissions:
        Inherits ``[IsAuthenticated]`` from ``BaseAPIView``.

    Caching:
        ``get`` is wrapped in ``cache_control(private=True, max_age=12)`` and
        ``vary_on_cookie``, giving each authenticated session a 12-second
        private cache.

    Request body (PATCH):
        Any subset of ``ProfileSerializer`` fields except ``user``, which is
        declared read-only on the serializer.

    Response shapes:
        - ``get`` -> ``ProfileSerializer`` payload with HTTP 200.
        - ``patch`` -> ``ProfileSerializer`` payload (HTTP 200) on success;
          serializer errors dictionary (HTTP 400) on validation failure.
    """

    @method_decorator(cache_control(private=True, max_age=12))
    @method_decorator(vary_on_cookie)
    def get(self, request):
        """Return the current user's ``Profile`` (12-second private cache per session)."""
        profile = Profile.objects.get(user=request.user)
        serializer = ProfileSerializer(profile)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def patch(self, request):
        """Update the current user's ``Profile`` partially; ``user`` field is read-only."""
        profile = Profile.objects.get(user=request.user)
        serializer = ProfileSerializer(profile, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
