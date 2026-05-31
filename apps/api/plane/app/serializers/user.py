# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for ``User``, ``Profile``, ``Account``, and password-change/reset flows.

Also serves the ``/users/me/`` and ``/users/me/settings/`` endpoints; the
settings serializer resolves the authenticated user's active or fallback
workspace context via :meth:`UserMeSettingsSerializer.get_workspace`, which
the web client uses to bootstrap navigation immediately after sign-in.
"""

# Third party imports
from rest_framework import serializers

# Module import
from plane.db.models import Account, Profile, User, Workspace, WorkspaceMemberInvite
from plane.utils.url import contains_url

from .base import BaseSerializer


class UserSerializer(BaseSerializer):
    """Write/read serializer for the ``User`` model.

    Strips the ``password`` field outright and marks every system-managed
    column (auth metadata, timestamps, IP audit fields, flags managed by the
    auth flow) read-only so only profile-level attributes such as
    ``first_name``, ``last_name``, ``avatar``, and ``user_timezone`` remain
    writable by end users.
    """

    def validate_first_name(self, value):
        """Reject a first name that contains a URL (anti-spam heuristic)."""
        if contains_url(value):
            raise serializers.ValidationError("First name cannot contain a URL.")
        return value

    def validate_last_name(self, value):
        """Reject a last name that contains a URL (anti-spam heuristic)."""
        if contains_url(value):
            raise serializers.ValidationError("Last name cannot contain a URL.")
        return value

    class Meta:
        """DRF model binding that excludes ``password`` and marks system columns read-only."""

        model = User
        # Exclude password field from the serializer
        fields = [field.name for field in User._meta.fields if field.name != "password"]
        # Make all system fields and email read only
        read_only_fields = [
            "id",
            "username",
            "mobile_number",
            "email",
            "token",
            "created_at",
            "updated_at",
            "is_superuser",
            "is_staff",
            "is_managed",
            "last_active",
            "last_login_time",
            "last_logout_time",
            "last_login_ip",
            "last_logout_ip",
            "last_login_uagent",
            "last_location",
            "last_login_medium",
            "created_location",
            "is_bot",
            "is_password_autoset",
            "is_email_verified",
            "is_active",
            "token_updated_at",
        ]

        # If the user has already filled first name or last name then he is onboarded
        def get_is_onboarded(self, obj):
            """Return ``True`` when the user has supplied a first or last name (onboarding-completed flag)."""
            return bool(obj.first_name) or bool(obj.last_name)


class UserMeSerializer(BaseSerializer):
    """Read-only ``User`` projection scoped to the authenticated user's ``/users/me/`` endpoint.

    Every field is marked read-only at the ``Meta`` level so the endpoint
    behaves as a pure GET projection; mutations to the user record are
    performed through :class:`UserSerializer` against ``/users/me/`` PATCH.
    """

    class Meta:
        """DRF model binding that pins the ``/users/me/`` projection to a read-only subset."""

        model = User
        fields = [
            "id",
            "avatar",
            "cover_image",
            "avatar_url",
            "cover_image_url",
            "date_joined",
            "display_name",
            "email",
            "first_name",
            "last_name",
            "is_active",
            "is_bot",
            "is_email_verified",
            "user_timezone",
            "username",
            "is_password_autoset",
            "is_email_verified",
            "last_login_medium",
            "last_login_time",
        ]
        read_only_fields = fields


class UserMeSettingsSerializer(BaseSerializer):
    """Read-only current-user serializer that resolves the active or fallback workspace context.

    Backs the ``/users/me/settings/`` endpoint that the web client calls
    immediately after sign-in to decide which workspace to land on. The
    ``workspace`` field is computed via :meth:`get_workspace`; the rest of
    the payload is a minimal user identity slice (id + email).
    """

    workspace = serializers.SerializerMethodField()

    class Meta:
        """DRF model binding for the minimal current-user settings payload (id, email, workspace)."""

        model = User
        fields = ["id", "email", "workspace"]
        read_only_fields = fields

    def get_workspace(self, obj):
        """Return the user's last-active workspace, or fall back to the oldest active membership.

        Resolution order:

        1. Use ``profile.last_workspace_id`` when the user still has an
           active membership on that workspace -- emits the workspace's
           slug, name, and logo asset URL.
        2. Otherwise fall back to the oldest workspace where the user is
           an active member (ordered by ``created_at``); emits its id and
           slug only.
        3. If the user is on no active workspace, emits ``None`` for both
           the last-workspace and fallback-workspace slots.

        In every branch the payload also carries ``invites`` -- the count
        of outstanding workspace invitations addressed to the user's email
        -- so the web client can render the "you've been invited" tray
        alongside the workspace landing logic.
        """
        workspace_invites = WorkspaceMemberInvite.objects.filter(email=obj.email).count()

        # profile
        profile = Profile.objects.get(user=obj)
        if (
            profile.last_workspace_id is not None
            and Workspace.objects.filter(
                pk=profile.last_workspace_id,
                workspace_member__member=obj.id,
                workspace_member__is_active=True,
            ).exists()
        ):
            workspace = Workspace.objects.filter(
                pk=profile.last_workspace_id,
                workspace_member__member=obj.id,
                workspace_member__is_active=True,
            ).first()
            logo_asset_url = workspace.logo_asset.asset_url if workspace.logo_asset is not None else ""
            return {
                "last_workspace_id": profile.last_workspace_id,
                "last_workspace_slug": (workspace.slug if workspace is not None else ""),
                "last_workspace_name": (workspace.name if workspace is not None else ""),
                "last_workspace_logo": (logo_asset_url),
                "fallback_workspace_id": profile.last_workspace_id,
                "fallback_workspace_slug": (workspace.slug if workspace is not None else ""),
                "invites": workspace_invites,
            }
        else:
            fallback_workspace = (
                Workspace.objects.filter(workspace_member__member_id=obj.id, workspace_member__is_active=True)
                .order_by("created_at")
                .first()
            )
            return {
                "last_workspace_id": None,
                "last_workspace_slug": None,
                "fallback_workspace_id": (fallback_workspace.id if fallback_workspace is not None else None),
                "fallback_workspace_slug": (fallback_workspace.slug if fallback_workspace is not None else None),
                "invites": workspace_invites,
            }


class UserLiteSerializer(BaseSerializer):
    """Compact ``User`` projection used as the nested user payload across the web-client API.

    This is the standard "user reference" shape embedded inside other
    serializers (issue assignees, comment authors, cycle owners, ...) -- it
    intentionally omits PII and auth metadata. ``id`` and ``is_bot`` are
    read-only because they are server-assigned identity attributes.
    """

    class Meta:
        """DRF model binding for the public-safe lite ``User`` projection."""

        model = User
        fields = [
            "id",
            "first_name",
            "last_name",
            "avatar",
            "avatar_url",
            "is_bot",
            "display_name",
        ]
        read_only_fields = ["id", "is_bot"]


class UserAdminLiteSerializer(BaseSerializer):
    """Admin-only variant of :class:`UserLiteSerializer` that adds ``email`` and ``last_login_medium``.

    Intended for workspace/project admin views (member lists, audit
    surfaces) that legitimately need to display a member's email address
    and the auth medium they last signed in with. Do not use this
    serializer in payloads exposed to non-admin viewers.
    """

    class Meta:
        """DRF model binding for the admin-only lite ``User`` projection (adds email + last_login_medium)."""

        model = User
        fields = [
            "id",
            "first_name",
            "last_name",
            "avatar",
            "avatar_url",
            "is_bot",
            "display_name",
            "email",
            "last_login_medium",
        ]
        read_only_fields = ["id", "is_bot"]


class ChangePasswordSerializer(serializers.Serializer):
    """Input serializer for the change-password endpoint.

    Backs ``PATCH /users/me/change-password/``. Requires the existing
    password (for re-authentication), the new password, and a confirmation
    of the new password; the cross-field check happens in :meth:`validate`.
    The ``model`` attribute below is a no-op on a plain
    :class:`~rest_framework.serializers.Serializer` and is retained to keep
    the public class surface stable.
    """

    model = User

    """
    Serializer for password change endpoint.
    """
    old_password = serializers.CharField(required=True)
    new_password = serializers.CharField(required=True, min_length=8)
    confirm_password = serializers.CharField(required=True, min_length=8)

    def validate(self, data):
        """Reject when the new password matches the old one or fails the confirmation check."""
        if data.get("old_password") == data.get("new_password"):
            raise serializers.ValidationError({"error": "New password cannot be same as old password."})

        if data.get("new_password") != data.get("confirm_password"):
            raise serializers.ValidationError({"error": "Confirm password should be same as the new password."})

        return data


class ResetPasswordSerializer(serializers.Serializer):
    """Input serializer for the password-reset endpoint (accepts only the new password).

    Backs ``POST /reset-password/<uidb64>/<token>/``: the user is identified
    by the signed reset-token URL rather than by a session, so this
    serializer carries no identifier fields and no old-password check --
    only the replacement password.
    """

    new_password = serializers.CharField(required=True, min_length=8)


class ProfileSerializer(BaseSerializer):
    """Write/read serializer for the ``Profile`` model -- per-user preferences row.

    The ``Profile`` row is created in lock-step with its parent ``User`` (a
    one-to-one relation) and stores per-user preferences such as theme,
    onboarding state, and ``last_workspace_id``. The ``user`` FK is read-only
    because the ownership link is server-assigned, never user-supplied.
    """

    class Meta:
        """DRF model binding for ``Profile`` -- exposes every field; ``user`` is read-only."""

        model = Profile
        fields = "__all__"
        read_only_fields = ["user"]


class AccountSerializer(BaseSerializer):
    """Write/read serializer for the ``Account`` model -- third-party OAuth linkage row.

    One row per (user, provider) pair tracks a third-party identity (Google,
    GitHub, ...) linked to a Plane user, along with the access/refresh
    token material that the auth flow refreshes. The ``user`` FK is
    read-only because the linkage is established by the OAuth callback, not
    by an end-user payload.
    """

    class Meta:
        """DRF model binding for ``Account`` -- exposes every field; ``user`` is read-only."""

        model = Account
        fields = "__all__"
        read_only_fields = ["user"]
