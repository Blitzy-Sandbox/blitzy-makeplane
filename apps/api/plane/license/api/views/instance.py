# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Singleton-instance endpoints for the license API.

Exposes the read/update surface for the global ``Instance`` row plus a
small bootstrap helper that records when the sign-up screen has been
shown. The migrator container is responsible for creating the
``Instance``, ``InstanceConfiguration`` and related tables before this
module is reachable. Cache invalidation on writes targets
``/api/instances/`` so the admin console always sees a consistent
snapshot.
"""

# Python imports
import os

# Django imports
from django.conf import settings

# Third party imports
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

# Module imports
from plane.app.views import BaseAPIView
from plane.db.models import Workspace
from plane.license.api.permissions import InstanceAdminPermission
from plane.license.api.serializers import InstanceSerializer
from plane.license.models import Instance
from plane.license.utils.instance_value import get_configuration_value
from plane.utils.cache import cache_response, invalidate_cache
from django.utils.decorators import method_decorator
from django.views.decorators.cache import cache_control


class InstanceEndpoint(BaseAPIView):
    """Read and partially update the singleton ``Instance`` configuration.

    HTTP methods + URL patterns:
        GET   /api/instances/
        PATCH /api/instances/

    Request body (PATCH):
        Any subset of writable ``InstanceSerializer`` fields. Fields marked
        read-only on the serializer (``id``, ``email``, ``last_checked_at``,
        ``is_setup_done``) are silently ignored. ``partial=True`` is set.

    Response shape:
        GET 200 when no ``Instance`` row exists:
            {"is_activated": False, "is_setup_done": False}
        GET 200 when an instance is configured:
            {
                "config": {
                    "enable_signup": bool,
                    "is_workspace_creation_disabled": bool,
                    "is_google_enabled": bool,
                    "is_github_enabled": bool,
                    "is_gitlab_enabled": bool,
                    "is_gitea_enabled": bool,
                    "is_magic_login_enabled": bool,
                    "is_email_password_enabled": bool,
                    "github_app_name": str,
                    "slack_client_id": str | None,
                    "posthog_api_key": str | None,
                    "posthog_host": str | None,
                    "has_unsplash_configured": bool,
                    "has_llm_configured": bool,
                    "file_size_limit": float,
                    "is_smtp_configured": bool,
                    "admin_base_url": str,
                    "space_base_url": str,
                    "app_base_url": str,
                    "instance_changelog_url": str,
                    "is_self_managed": bool,
                },
                "instance": <InstanceSerializer payload with
                             is_activated=True and workspaces_exist:bool>,
            }
        PATCH 200: serialized updated instance.
        PATCH 400: serializer error dict.

    Permissions:
        Resolved per-request via ``get_permissions``:
            PATCH -> ``[InstanceAdminPermission()]``
            else  -> ``[AllowAny()]``  (GET is intentionally public so the
                     web client can show the right onboarding screen).

    Caching:
        GET wraps a 2-hour server-side cache (``cache_response(60*60*2,
        user=False)``) plus a 12-second private browser cache
        (``cache_control(private=True, max_age=12)``).
        PATCH invalidates the ``/api/instances/`` cache via
        ``@invalidate_cache``.

    Notes:
        Extends ``plane.app.views.BaseAPIView`` (the application-wide base),
        not the local ``BaseAPIView`` in ``views/base.py``.
        ``get_queryset`` is not overridden — the singleton is read directly
        through ``Instance.objects.first()``.
    """

    def get_permissions(self):
        """Return admin-only permissions for PATCH, ``AllowAny`` otherwise."""
        if self.request.method == "PATCH":
            return [InstanceAdminPermission()]
        return [AllowAny()]

    @cache_response(60 * 60 * 2, user=False)
    @method_decorator(cache_control(private=True, max_age=12))
    def get(self, request):
        """Return the merged instance + feature-flag configuration payload.

        Falls back to ``{"is_activated": False, "is_setup_done": False}``
        when no ``Instance`` row exists yet (pre-bootstrap state).
        Feature flags are resolved through
        ``plane.license.utils.instance_value.get_configuration_value`` which
        prefers an ``InstanceConfiguration`` row over the environment
        default.
        """
        instance = Instance.objects.first()

        # get the instance
        if instance is None:
            return Response(
                {"is_activated": False, "is_setup_done": False},
                status=status.HTTP_200_OK,
            )
        # Return instance
        serializer = InstanceSerializer(instance)
        data = serializer.data
        data["is_activated"] = True
        # Get all the configuration
        (
            ENABLE_SIGNUP,
            DISABLE_WORKSPACE_CREATION,
            IS_GOOGLE_ENABLED,
            IS_GITHUB_ENABLED,
            GITHUB_APP_NAME,
            IS_GITLAB_ENABLED,
            IS_GITEA_ENABLED,
            EMAIL_HOST,
            ENABLE_MAGIC_LINK_LOGIN,
            ENABLE_EMAIL_PASSWORD,
            SLACK_CLIENT_ID,
            POSTHOG_API_KEY,
            POSTHOG_HOST,
            UNSPLASH_ACCESS_KEY,
            LLM_API_KEY,
        ) = get_configuration_value(
            [
                {
                    "key": "ENABLE_SIGNUP",
                    "default": os.environ.get("ENABLE_SIGNUP", "0"),
                },
                {
                    "key": "DISABLE_WORKSPACE_CREATION",
                    "default": os.environ.get("DISABLE_WORKSPACE_CREATION", "0"),
                },
                {
                    "key": "IS_GOOGLE_ENABLED",
                    "default": os.environ.get("IS_GOOGLE_ENABLED", "0"),
                },
                {
                    "key": "IS_GITHUB_ENABLED",
                    "default": os.environ.get("IS_GITHUB_ENABLED", "0"),
                },
                {
                    "key": "GITHUB_APP_NAME",
                    "default": os.environ.get("GITHUB_APP_NAME", ""),
                },
                {
                    "key": "IS_GITLAB_ENABLED",
                    "default": os.environ.get("IS_GITLAB_ENABLED", "0"),
                },
                {
                    "key": "IS_GITEA_ENABLED",
                    "default": os.environ.get("IS_GITEA_ENABLED", "0"),
                },
                {"key": "EMAIL_HOST", "default": os.environ.get("EMAIL_HOST", "")},
                {
                    "key": "ENABLE_MAGIC_LINK_LOGIN",
                    "default": os.environ.get("ENABLE_MAGIC_LINK_LOGIN", "1"),
                },
                {
                    "key": "ENABLE_EMAIL_PASSWORD",
                    "default": os.environ.get("ENABLE_EMAIL_PASSWORD", "1"),
                },
                {
                    "key": "SLACK_CLIENT_ID",
                    "default": os.environ.get("SLACK_CLIENT_ID", None),
                },
                {
                    "key": "POSTHOG_API_KEY",
                    "default": os.environ.get("POSTHOG_API_KEY", None),
                },
                {
                    "key": "POSTHOG_HOST",
                    "default": os.environ.get("POSTHOG_HOST", None),
                },
                {
                    "key": "UNSPLASH_ACCESS_KEY",
                    "default": os.environ.get("UNSPLASH_ACCESS_KEY", ""),
                },
                {
                    "key": "LLM_API_KEY",
                    "default": os.environ.get("LLM_API_KEY", ""),
                },
            ]
        )

        data = {}
        # Authentication
        data["enable_signup"] = ENABLE_SIGNUP == "1"
        data["is_workspace_creation_disabled"] = DISABLE_WORKSPACE_CREATION == "1"
        data["is_google_enabled"] = IS_GOOGLE_ENABLED == "1"
        data["is_github_enabled"] = IS_GITHUB_ENABLED == "1"
        data["is_gitlab_enabled"] = IS_GITLAB_ENABLED == "1"
        data["is_gitea_enabled"] = IS_GITEA_ENABLED == "1"
        data["is_magic_login_enabled"] = ENABLE_MAGIC_LINK_LOGIN == "1"
        data["is_email_password_enabled"] = ENABLE_EMAIL_PASSWORD == "1"

        # Github app name
        data["github_app_name"] = str(GITHUB_APP_NAME)

        # Slack client
        data["slack_client_id"] = SLACK_CLIENT_ID

        # Posthog
        data["posthog_api_key"] = POSTHOG_API_KEY
        data["posthog_host"] = POSTHOG_HOST

        # Unsplash
        data["has_unsplash_configured"] = bool(UNSPLASH_ACCESS_KEY)

        # Open AI settings
        data["has_llm_configured"] = bool(LLM_API_KEY)

        # File size settings
        data["file_size_limit"] = float(os.environ.get("FILE_SIZE_LIMIT", 5242880))

        # is smtp configured
        data["is_smtp_configured"] = bool(EMAIL_HOST)

        # Base URL
        data["admin_base_url"] = settings.ADMIN_BASE_URL
        data["space_base_url"] = settings.SPACE_BASE_URL
        data["app_base_url"] = settings.APP_BASE_URL

        data["instance_changelog_url"] = settings.INSTANCE_CHANGELOG_URL
        data["is_self_managed"] = settings.IS_SELF_MANAGED

        instance_data = serializer.data
        instance_data["workspaces_exist"] = Workspace.objects.count() >= 1

        response_data = {"config": data, "instance": instance_data}
        return Response(response_data, status=status.HTTP_200_OK)

    @invalidate_cache(path="/api/instances/", user=False)
    def patch(self, request):
        """Update the singleton ``Instance`` partially and invalidate the cache.

        Idempotency: PATCH is idempotent for any fixed payload — repeated
        calls converge to the same state and re-invalidate the same cache
        key (``/api/instances/``).
        """
        # Get the instance
        instance = Instance.objects.first()
        serializer = InstanceSerializer(instance, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class SignUpScreenVisitedEndpoint(BaseAPIView):
    """Records that the bootstrap sign-up screen has been displayed.

    HTTP methods + URL patterns:
        POST /api/instances/admins/sign-up-screen-visited/

    Request body:
        Empty.

    Response shape:
        204 No Content on success.
        400 ``{"error": "Instance is not configured"}`` when no
            ``Instance`` row exists yet.

    Permissions:
        ``permission_classes = [AllowAny]`` — public probe so the web
        client can flip the bootstrap UI state without holding an admin
        session.

    Side effects:
        Sets ``instance.is_signup_screen_visited = True`` on the singleton
        ``Instance`` and invalidates ``/api/instances/`` cache.

    Notes:
        NON-idempotent semantically (the flag transitions once from False
        to True), although repeated POSTs are safe and leave the row in
        the same terminal state.
    """

    permission_classes = [AllowAny]

    @invalidate_cache(path="/api/instances/", user=False)
    def post(self, request):
        """Flip the singleton's ``is_signup_screen_visited`` flag to ``True``."""
        instance = Instance.objects.first()
        if instance is None:
            return Response(
                {"error": "Instance is not configured"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        instance.is_signup_screen_visited = True
        instance.save()
        return Response(status=status.HTTP_204_NO_CONTENT)
