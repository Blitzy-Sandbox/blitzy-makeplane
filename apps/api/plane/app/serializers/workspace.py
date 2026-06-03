# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for the workspace surface (workspaces, members, invites, themes, prefs, links, stickies, recent visits).

This module owns the workspace-level serialization surface: anything that
exists at workspace scope (above project scope) flows through serializers
defined here. The recent-visit serializer additionally renders a polymorphic
``entity_data`` payload that delegates to per-entity compact serializers
(``Issue``, ``Project``, ``Page``) declared in the same module.
"""

# Third party imports
from rest_framework import serializers

# Module imports
from .base import BaseSerializer, DynamicBaseSerializer
from .user import UserLiteSerializer, UserAdminLiteSerializer


from plane.db.models import (
    Workspace,
    WorkspaceMember,
    WorkspaceMemberInvite,
    WorkspaceTheme,
    WorkspaceUserProperties,
    WorkspaceUserLink,
    UserRecentVisit,
    Issue,
    Page,
    Project,
    ProjectMember,
    WorkspaceHomePreference,
    Sticky,
    WorkspaceUserPreference,
)
from plane.utils.constants import RESTRICTED_WORKSPACE_SLUGS
from plane.utils.url import contains_url
from plane.utils.content_validator import (
    validate_html_content,
    validate_binary_data,
)

# Django imports
from django.core.validators import URLValidator
from django.core.exceptions import ValidationError
import re


class WorkSpaceSerializer(DynamicBaseSerializer):
    """Write/read serializer for ``Workspace``.

    Validates the workspace name (no URLs) and slug (alphanumeric, hyphen,
    underscore only; not on the restricted reserved list). Exposes
    ``total_members``, ``logo_url``, and the requesting user's ``role`` as
    read-only annotations that callers must populate upstream.
    """

    total_members = serializers.IntegerField(read_only=True)
    logo_url = serializers.CharField(read_only=True)
    role = serializers.IntegerField(read_only=True)

    def validate_name(self, value):
        """Reject workspace names that contain a URL (anti-spam heuristic)."""
        # Check if the name contains a URL
        if contains_url(value):
            raise serializers.ValidationError("Name must not contain URLs")
        return value

    def validate_slug(self, value):
        """Reject slugs in the restricted reserved list or that contain characters outside ``[A-Za-z0-9_-]``."""
        # Check if the slug is restricted
        if value in RESTRICTED_WORKSPACE_SLUGS:
            raise serializers.ValidationError("Slug is not valid")
        # Slug should only contain alphanumeric characters, hyphens, and underscores
        if not re.match(r"^[a-zA-Z0-9_-]+$", value):
            raise serializers.ValidationError(
                "Slug can only contain letters, numbers, hyphens (-), and underscores (_)"
            )
        return value

    class Meta:
        """DRF metadata: bind to ``Workspace`` with read-only system fields and owner/logo."""

        model = Workspace
        fields = "__all__"
        read_only_fields = [
            "id",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
            "owner",
            "logo_url",
        ]


class WorkspaceLiteSerializer(BaseSerializer):
    """Compact ``Workspace`` representation (``name``, ``slug``, ``id``, ``logo_url``).

    This is the standard nested workspace payload returned anywhere a parent
    workspace must be expressed inline (memberships, invites, recent visits,
    etc.). All fields are read-only.
    """

    class Meta:
        """DRF metadata: read-only ``name``/``slug``/``id``/``logo_url`` projection of ``Workspace``."""

        model = Workspace
        fields = ["name", "slug", "id", "logo_url"]
        read_only_fields = fields


class WorkSpaceMemberSerializer(DynamicBaseSerializer):
    """Read serializer for ``WorkspaceMember`` rows with a nested lite-user view."""

    member = UserLiteSerializer(read_only=True)

    class Meta:
        """DRF metadata: bind to ``WorkspaceMember`` and expose every field."""

        model = WorkspaceMember
        fields = "__all__"


class WorkspaceMemberMeSerializer(BaseSerializer):
    """Workspace-member projection for the current user.

    Includes the user's ``draft_issue_count`` (annotated by the view's queryset
    so it is reported alongside membership metadata in a single round trip).
    """

    draft_issue_count = serializers.IntegerField(read_only=True)

    class Meta:
        """DRF metadata: bind to ``WorkspaceMember`` and expose every field."""

        model = WorkspaceMember
        fields = "__all__"


class WorkspaceMemberAdminSerializer(DynamicBaseSerializer):
    """Admin variant of :class:`WorkSpaceMemberSerializer`.

    Uses :class:`UserAdminLiteSerializer` instead of the public lite user so
    that admin-only fields such as ``email`` and ``last_login_medium`` are
    surfaced for workspace admins.
    """

    member = UserAdminLiteSerializer(read_only=True)

    class Meta:
        """DRF metadata: bind to ``WorkspaceMember`` and expose every field."""

        model = WorkspaceMember
        fields = "__all__"


class WorkSpaceMemberInviteSerializer(BaseSerializer):
    """Serializer for ``WorkspaceMemberInvite`` rows.

    Exposes the inviting workspace (as a lite payload) and a derived
    ``invite_link`` suitable for inclusion in the invitation email body.
    """

    workspace = WorkspaceLiteSerializer(read_only=True)
    invite_link = serializers.SerializerMethodField()

    def get_invite_link(self, obj):
        """Return the workspace-relative invite acceptance path.

        Includes ``invitation_id``, ``slug``, and ``token`` as query parameters.
        """
        return f"/workspace-invitations/?invitation_id={obj.id}&slug={obj.workspace.slug}&token={obj.token}"

    class Meta:
        """DRF metadata: bind to ``WorkspaceMemberInvite``; immutable identity, audit, and link fields."""

        model = WorkspaceMemberInvite
        fields = "__all__"
        read_only_fields = [
            "id",
            "email",
            "token",
            "workspace",
            "message",
            "responded_at",
            "created_at",
            "updated_at",
            "invite_link",
        ]


class WorkspaceThemeSerializer(BaseSerializer):
    """Write/read serializer for ``WorkspaceTheme`` rows (workspace and actor are read-only)."""

    class Meta:
        """DRF metadata: bind to ``WorkspaceTheme``; ``workspace`` and ``actor`` are set server-side."""

        model = WorkspaceTheme
        fields = "__all__"
        read_only_fields = ["workspace", "actor"]


class WorkspaceUserPropertiesSerializer(BaseSerializer):
    """Serializer for ``WorkspaceUserProperties`` rows.

    These are per-user display and filter preferences scoped to a single
    workspace (e.g. saved filter selections for the workspace inbox or issue
    feed).
    """

    class Meta:
        """DRF metadata: bind to ``WorkspaceUserProperties``; ``workspace`` and ``user`` are set server-side."""

        model = WorkspaceUserProperties
        fields = "__all__"
        read_only_fields = ["workspace", "user"]


class WorkspaceUserLinkSerializer(BaseSerializer):
    """Write/read serializer for ``WorkspaceUserLink`` rows (per-user pinned links).

    Prepends ``http://`` to schemeless URLs before validation and enforces URL
    uniqueness scoped to the pair ``(workspace, owner)``.
    """

    class Meta:
        """DRF metadata: bind to ``WorkspaceUserLink``; ``workspace`` and ``owner`` are set server-side."""

        model = WorkspaceUserLink
        fields = "__all__"
        read_only_fields = ["workspace", "owner"]

    def to_internal_value(self, data):
        """Normalize the URL by prepending ``http://`` when no scheme is supplied before standard validation runs."""
        url = data.get("url", "")
        if url and not url.startswith(("http://", "https://")):
            data["url"] = "http://" + url

        return super().to_internal_value(data)

    def validate_url(self, value):
        """Validate the URL with Django's ``URLValidator`` and surface a friendly error message."""
        url_validator = URLValidator()
        try:
            url_validator(value)
        except ValidationError:
            raise serializers.ValidationError({"error": "Invalid URL format."})

        return value

    def create(self, validated_data):
        """Reject duplicate URLs for the same workspace and owner before creating the row."""
        # Filtering the WorkspaceUserLink with the given url to check if the link already exists.

        url = validated_data.get("url")

        workspace_user_link = WorkspaceUserLink.objects.filter(
            url=url,
            workspace_id=validated_data.get("workspace_id"),
            owner_id=validated_data.get("owner_id"),
        )

        if workspace_user_link.exists():
            raise serializers.ValidationError({"error": "URL already exists for this workspace and owner"})

        return super().create(validated_data)

    def update(self, instance, validated_data):
        """Reject duplicate URLs (excluding the row being updated) for the same workspace and owner before saving."""
        # Filtering the WorkspaceUserLink with the given url to check if the link already exists.

        url = validated_data.get("url")

        workspace_user_link = WorkspaceUserLink.objects.filter(
            url=url, workspace_id=instance.workspace_id, owner=instance.owner
        )

        if workspace_user_link.exclude(pk=instance.id).exists():
            raise serializers.ValidationError({"error": "URL already exists for this workspace and owner"})

        return super().update(instance, validated_data)


class IssueRecentVisitSerializer(serializers.ModelSerializer):
    """Compact ``Issue`` representation embedded in workspace recent-visit payloads.

    Exposes the minimum set required to render an issue card in the recent
    feed (``id``, ``name``, ``state``, ``priority``, ``assignees``, ``type``,
    ``sequence_id``, ``project_id``, ``project_identifier``).
    """

    project_identifier = serializers.SerializerMethodField()
    assignees = serializers.SerializerMethodField()

    class Meta:
        """DRF metadata: read-only feed projection of ``Issue``."""

        model = Issue
        fields = [
            "id",
            "name",
            "state",
            "priority",
            "assignees",
            "type",
            "sequence_id",
            "project_id",
            "project_identifier",
        ]

    def get_project_identifier(self, obj):
        """Return the issue's project identifier or ``None`` if the project is missing."""
        project = obj.project
        return project.identifier if project else None

    def get_assignees(self, obj):
        """Return the assignee IDs filtered to non-deleted ``IssueAssignee`` rows."""
        return list(obj.assignees.filter(issue_assignee__deleted_at__isnull=True).values_list("id", flat=True))


class ProjectRecentVisitSerializer(serializers.ModelSerializer):
    """Compact ``Project`` representation embedded in workspace recent-visit payloads.

    Includes a list of active non-bot project members so the recent-visit
    surface can render member avatars without an additional round trip.
    """

    project_members = serializers.SerializerMethodField()

    class Meta:
        """DRF metadata: read-only feed projection of ``Project`` with active member IDs."""

        model = Project
        fields = ["id", "name", "logo_props", "project_members", "identifier"]

    def get_project_members(self, obj):
        """Return the IDs of active non-bot members of the project."""
        members = ProjectMember.objects.filter(project_id=obj.id, member__is_bot=False, is_active=True).values_list(
            "member", flat=True
        )

        return members


class PageRecentVisitSerializer(serializers.ModelSerializer):
    """Compact ``Page`` representation embedded in workspace recent-visit payloads.

    Derives ``project_id`` and ``project_identifier`` from the page's many-to-many
    ``projects`` relation so a single owning project can be displayed even
    though pages structurally belong to a set of projects.
    """

    project_id = serializers.SerializerMethodField()
    project_identifier = serializers.SerializerMethodField()

    class Meta:
        """DRF metadata: read-only feed projection of ``Page`` with derived project linkage."""

        model = Page
        fields = [
            "id",
            "name",
            "logo_props",
            "project_id",
            "owned_by",
            "project_identifier",
        ]

    def get_project_id(self, obj):
        """Return the page's ``project_id`` if set on the instance.

        Falls back to the first associated project ID from the page's M2M
        ``projects`` relation.
        """
        return obj.project_id if hasattr(obj, "project_id") else obj.projects.values_list("id", flat=True).first()

    def get_project_identifier(self, obj):
        """Return the first associated project's identifier, or ``None`` if the page has no project."""
        project = obj.projects.first()

        return project.identifier if project else None


def get_entity_model_and_serializer(entity_type):
    """Return the ``(Model, Serializer)`` pair to render a recently-visited entity of the given type.

    Returns ``(None, None)`` for unsupported entity types so that callers can
    short-circuit rather than raising ``KeyError`` for unknown rows in the
    recent-visit feed.
    """
    entity_map = {
        "issue": (Issue, IssueRecentVisitSerializer),
        "page": (Page, PageRecentVisitSerializer),
        "project": (Project, ProjectRecentVisitSerializer),
    }
    return entity_map.get(entity_type, (None, None))


class WorkspaceRecentVisitSerializer(BaseSerializer):
    """Serializer for ``UserRecentVisit`` rows.

    Exposes a polymorphic compact ``entity_data`` payload resolved per row via
    :func:`get_entity_model_and_serializer`, so the recent-visit feed can mix
    issues, pages, and projects in a single response.
    """

    entity_data = serializers.SerializerMethodField()

    class Meta:
        """DRF metadata: bind to ``UserRecentVisit``; expose feed-relevant fields with audit fields read-only."""

        model = UserRecentVisit
        fields = ["id", "entity_name", "entity_identifier", "entity_data", "visited_at"]
        read_only_fields = ["workspace", "owner", "created_by", "updated_by"]

    def get_entity_data(self, obj):
        """Resolve the recently-visited entity through the dispatch table and return its compact serialization.

        Returns ``None`` when ``entity_name`` is unknown or when the underlying
        entity row has been deleted between the visit being recorded and the
        feed being rendered.
        """
        entity_name = obj.entity_name
        entity_identifier = obj.entity_identifier

        entity_model, entity_serializer = get_entity_model_and_serializer(entity_name)

        if entity_model and entity_serializer:
            try:
                entity = entity_model.objects.get(pk=entity_identifier)

                return entity_serializer(entity).data
            except entity_model.DoesNotExist:
                return None
        return None


class WorkspaceHomePreferenceSerializer(BaseSerializer):
    """Serializer for ``WorkspaceHomePreference`` rows.

    Captures per-user home-dashboard widget visibility (``is_enabled``) and
    widget ordering (``sort_order``) keyed by ``key``.
    """

    class Meta:
        """DRF metadata: bind to ``WorkspaceHomePreference``; audit and workspace fields read-only."""

        model = WorkspaceHomePreference
        fields = ["key", "is_enabled", "sort_order"]
        read_only_fields = ["workspace", "created_by", "updated_by"]


class StickySerializer(BaseSerializer):
    """Write/read serializer for ``Sticky`` workspace sticky-note rows.

    ``workspace`` and ``owner`` are set server-side; ``name`` is optional so
    quickly-jotted notes can be created without a title.
    """

    class Meta:
        """DRF metadata: bind to ``Sticky``; server-side workspace/owner, optional ``name``."""

        model = Sticky
        fields = "__all__"
        read_only_fields = ["workspace", "owner"]
        extra_kwargs = {"name": {"required": False}}

    def validate(self, data):
        """Sanitize ``description_html`` and validate ``description_binary`` content before saving."""
        # Validate description content for security
        if "description_html" in data and data["description_html"]:
            is_valid, error_msg, sanitized_html = validate_html_content(data["description_html"])
            if not is_valid:
                raise serializers.ValidationError({"error": "html content is not valid"})
            # Update the data with sanitized HTML if available
            if sanitized_html is not None:
                data["description_html"] = sanitized_html

        if "description_binary" in data and data["description_binary"]:
            is_valid, error_msg = validate_binary_data(data["description_binary"])
            if not is_valid:
                raise serializers.ValidationError({"description_binary": "Invalid binary data"})

        return data


class WorkspaceUserPreferenceSerializer(BaseSerializer):
    """Serializer for top-level ``WorkspaceUserPreference`` rows.

    Captures per-user workspace-wide pinning (``is_pinned``) and ordering
    (``sort_order``) keyed by ``key`` (e.g. saved-view shortcuts).
    """

    class Meta:
        """DRF metadata: bind to ``WorkspaceUserPreference``; audit and workspace fields read-only."""

        model = WorkspaceUserPreference
        fields = ["key", "is_pinned", "sort_order"]
        read_only_fields = ["workspace", "created_by", "updated_by"]
