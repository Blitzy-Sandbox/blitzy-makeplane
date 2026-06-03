# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for projects, project members, invites, identifiers, deploy boards, and the public members surface.

This module spans the full project-lifecycle surface -- creation, member
roster, role changes, invitations, the per-workspace identifier table, and
public sharing via deploy boards. Each serializer is paired with one model
from :mod:`plane.db.models` and wires in nested workspace/project/user
representations from sibling serializer modules so the web-client API can
deliver fully-resolved payloads in a single round trip.
"""

# Third party imports
from rest_framework import serializers

# Python imports
import re

# Module imports
from .base import BaseSerializer, DynamicBaseSerializer
from django.db.models import Max
from plane.app.serializers.workspace import WorkspaceLiteSerializer
from plane.app.serializers.user import UserLiteSerializer, UserAdminLiteSerializer
from plane.db.models import (
    Project,
    ProjectMember,
    ProjectMemberInvite,
    ProjectIdentifier,
    DeployBoard,
    ProjectPublicMember,
    IssueSequence,
)
from plane.utils.content_validator import (
    validate_html_content,
)


class ProjectSerializer(BaseSerializer):
    """Write serializer for :class:`~plane.db.models.Project`.

    Validates name and identifier uniqueness within the parent workspace,
    rejects values containing forbidden special characters, sanitizes the
    ``description_html`` blob through :func:`validate_html_content`, and
    creates the paired :class:`~plane.db.models.ProjectIdentifier` row in
    the same :meth:`create` call so the per-workspace identifier table
    never drifts from the project table. The ``workspace_id`` for write
    operations is read from ``self.context["workspace_id"]`` rather than
    the request payload (``workspace`` is also pinned read-only).
    """

    workspace_detail = WorkspaceLiteSerializer(source="workspace", read_only=True)
    inbox_view = serializers.BooleanField(read_only=True, source="intake_view")

    class Meta:
        """DRF metadata: bind to ``Project`` and pin ``workspace``/``deleted_at`` read-only."""

        model = Project
        fields = "__all__"
        read_only_fields = ["workspace", "deleted_at"]

    def validate_name(self, name):
        """Reject names that fail per-workspace uniqueness or character constraints.

        Raises if ``name`` matches ``Project.FORBIDDEN_IDENTIFIER_CHARS_PATTERN``
        or collides with an existing project name in the same workspace
        (excluding the current instance for updates).
        """
        project_id = self.instance.id if self.instance else None
        workspace_id = self.context["workspace_id"]

        if re.match(Project.FORBIDDEN_IDENTIFIER_CHARS_PATTERN, name):
            raise serializers.ValidationError(detail="PROJECT_NAME_CANNOT_CONTAIN_SPECIAL_CHARACTERS")

        project = Project.objects.filter(name=name, workspace_id=workspace_id)

        if project_id:
            project = project.exclude(id=project_id)

        if project.exists():
            raise serializers.ValidationError(
                detail="PROJECT_NAME_ALREADY_EXIST",
            )

        return name

    def validate_identifier(self, identifier):
        """Reject identifiers that fail per-workspace uniqueness or character constraints.

        Raises if ``identifier`` matches ``Project.FORBIDDEN_IDENTIFIER_CHARS_PATTERN``
        or collides with an existing project identifier in the same workspace
        (excluding the current instance for updates).
        """
        project_id = self.instance.id if self.instance else None
        workspace_id = self.context["workspace_id"]

        if re.match(Project.FORBIDDEN_IDENTIFIER_CHARS_PATTERN, identifier):
            raise serializers.ValidationError(detail="PROJECT_IDENTIFIER_CANNOT_CONTAIN_SPECIAL_CHARACTERS")

        project = Project.objects.filter(identifier=identifier, workspace_id=workspace_id)

        if project_id:
            project = project.exclude(id=project_id)

        if project.exists():
            raise serializers.ValidationError(
                detail="PROJECT_IDENTIFIER_ALREADY_EXIST",
            )

        return identifier

    def validate(self, data):
        """Sanitize ``description_html`` and reject markup that fails security checks.

        Runs the inbound ``description_html`` through
        :func:`validate_html_content`, replacing the field with the
        sanitized payload on success and raising
        :class:`~rest_framework.serializers.ValidationError` otherwise.
        """
        # Validate description content for security
        if "description_html" in data and data["description_html"]:
            is_valid, error_msg, sanitized_html = validate_html_content(str(data["description_html"]))
            # Update the data with sanitized HTML if available
            if sanitized_html is not None:
                data["description_html"] = sanitized_html

            if not is_valid:
                raise serializers.ValidationError({"error": "html content is not valid"})

        return data

    def create(self, validated_data):
        """Create the project row and the paired ``ProjectIdentifier`` row in the same operation."""
        workspace_id = self.context["workspace_id"]

        project = Project.objects.create(**validated_data, workspace_id=workspace_id)

        ProjectIdentifier.objects.create(name=project.identifier, project=project, workspace_id=workspace_id)

        return project


class ProjectLiteSerializer(BaseSerializer):
    """Compact ``Project`` representation (id, identifier, name, cover, logo, description) for nested embedding.

    Used anywhere a parent project must be expressed inline (members,
    invites, deploy boards, etc.). All fields are read-only.
    """

    class Meta:
        """DRF metadata: read-only projection of identity/branding fields on ``Project``."""

        model = Project
        fields = [
            "id",
            "identifier",
            "name",
            "cover_image",
            "cover_image_url",
            "logo_props",
            "description",
        ]
        read_only_fields = fields


class ProjectListSerializer(DynamicBaseSerializer):
    """Read serializer for the project list view.

    Exposes the project alongside queryset-annotated ``is_favorite``,
    ``sort_order``, ``member_role``, ``anchor``, ``cover_image_url``, the
    active non-bot member roster (``members``), and the next issue
    sequence number (``next_work_item_sequence``). All annotated fields
    must be populated by the upstream viewset's queryset because they are
    declared read-only on the serializer.
    """

    is_favorite = serializers.BooleanField(read_only=True)
    sort_order = serializers.FloatField(read_only=True)
    member_role = serializers.IntegerField(read_only=True)
    anchor = serializers.CharField(read_only=True)
    members = serializers.SerializerMethodField()
    cover_image_url = serializers.CharField(read_only=True)
    inbox_view = serializers.BooleanField(read_only=True, source="intake_view")
    next_work_item_sequence = serializers.SerializerMethodField()

    def get_members(self, obj):
        """Return non-bot active member IDs from the ``members_list`` prefetch.

        Returns an empty list when the upstream viewset has not attached
        ``members_list`` to the project instance.
        """
        project_members = getattr(obj, "members_list", None)
        if project_members is not None:
            # Filter members by the project ID
            return [member.member_id for member in project_members if member.is_active and not member.member.is_bot]
        return []

    def get_next_work_item_sequence(self, obj):
        """Return the next sequence ID that will be assigned to a new issue in this project."""
        max_sequence = IssueSequence.objects.filter(project_id=obj.id).aggregate(max_seq=Max("sequence"))["max_seq"]
        return (max_sequence + 1) if max_sequence else 1

    class Meta:
        """DRF metadata: bind to ``Project`` and expose every field."""

        model = Project
        fields = "__all__"


class ProjectDetailSerializer(BaseSerializer):
    """Detail-view ``Project`` serializer.

    Nests ``default_assignee`` and ``project_lead`` as lite-user payloads
    and exposes the same queryset-annotated preference fields as
    :class:`ProjectListSerializer` (``is_favorite``, ``sort_order``,
    ``member_role``, ``anchor``). Annotated fields are read-only and must
    be supplied by the upstream viewset's queryset.
    """

    # workspace = WorkSpaceSerializer(read_only=True)
    default_assignee = UserLiteSerializer(read_only=True)
    project_lead = UserLiteSerializer(read_only=True)
    is_favorite = serializers.BooleanField(read_only=True)
    sort_order = serializers.FloatField(read_only=True)
    member_role = serializers.IntegerField(read_only=True)
    anchor = serializers.CharField(read_only=True)

    class Meta:
        """DRF metadata: bind to ``Project`` and expose every field."""

        model = Project
        fields = "__all__"


class ProjectMemberSerializer(BaseSerializer):
    """Read serializer for ``ProjectMember`` rows with nested workspace, project, and lite-user views."""

    workspace = WorkspaceLiteSerializer(read_only=True)
    project = ProjectLiteSerializer(read_only=True)
    member = UserLiteSerializer(read_only=True)

    class Meta:
        """DRF metadata: bind to ``ProjectMember`` and expose every field."""

        model = ProjectMember
        fields = "__all__"


class ProjectMemberPreferenceSerializer(BaseSerializer):
    """Write-merge serializer for a project member's ``preferences`` JSON.

    Unlike a standard ``validate_*`` hook, :meth:`validate_preferences`
    mutates the stored preferences blob by shallow-merging the inbound
    dict onto :attr:`self.instance.preferences` and returning the merged
    value -- the inbound payload is therefore treated as a partial update
    rather than a full replacement.
    """

    class Meta:
        """DRF metadata: bind to ``ProjectMember`` with only the preferences/scope-id surface exposed."""

        model = ProjectMember
        fields = ["preferences", "project_id", "member_id", "workspace_id"]

    def validate_preferences(self, value):
        """Shallow-merge the inbound preferences dict onto the existing stored preferences.

        Returns the merged dict so DRF persists the combined value rather
        than replacing the entire preferences blob.
        """
        preferences = self.instance.preferences

        preferences.update(value)
        return preferences


class ProjectMemberAdminSerializer(BaseSerializer):
    """Admin variant of :class:`ProjectMemberSerializer`.

    Identical to :class:`ProjectMemberSerializer` except the nested
    ``member`` payload uses :class:`UserAdminLiteSerializer`, which
    additionally exposes the user's ``email`` and ``last_login_medium``.
    """

    workspace = WorkspaceLiteSerializer(read_only=True)
    project = ProjectLiteSerializer(read_only=True)
    member = UserAdminLiteSerializer(read_only=True)

    class Meta:
        """DRF metadata: bind to ``ProjectMember`` and expose every field."""

        model = ProjectMember
        fields = "__all__"


class ProjectMemberRoleSerializer(DynamicBaseSerializer):
    """Compact ``ProjectMember`` view focused on role changes.

    Exposes ``original_role`` (a read-only mirror of ``role`` captured at
    serialization time, useful for audit/UI diffing) alongside the
    writable ``role`` field.
    """

    original_role = serializers.IntegerField(source="role", read_only=True)

    class Meta:
        """DRF metadata: bind to ``ProjectMember`` with ``original_role``/``created_at`` pinned read-only."""

        model = ProjectMember
        fields = ("id", "role", "member", "project", "original_role", "created_at")
        read_only_fields = ["original_role", "created_at"]


class ProjectMemberInviteSerializer(BaseSerializer):
    """Read serializer for ``ProjectMemberInvite`` rows with nested project and workspace details."""

    project = ProjectLiteSerializer(read_only=True)
    workspace = WorkspaceLiteSerializer(read_only=True)

    class Meta:
        """DRF metadata: bind to ``ProjectMemberInvite`` and expose every field."""

        model = ProjectMemberInvite
        fields = "__all__"


class ProjectIdentifierSerializer(BaseSerializer):
    """Pass-through serializer for ``ProjectIdentifier`` (the per-workspace unique project identifier table)."""

    class Meta:
        """DRF metadata: bind to ``ProjectIdentifier`` and expose every field."""

        model = ProjectIdentifier
        fields = "__all__"


class ProjectMemberLiteSerializer(BaseSerializer):
    """Compact ``ProjectMember`` view with nested user details and a queryset-annotated ``is_subscribed`` flag."""

    member = UserLiteSerializer(read_only=True)
    is_subscribed = serializers.BooleanField(read_only=True)

    class Meta:
        """DRF metadata: read-only ``member``/``id``/``is_subscribed`` projection of ``ProjectMember``."""

        model = ProjectMember
        fields = ["member", "id", "is_subscribed"]
        read_only_fields = fields


class DeployBoardSerializer(BaseSerializer):
    """Serializer for :class:`~plane.db.models.DeployBoard`.

    Exposes the project's public-sharing configuration with nested
    project/workspace details. ``workspace``, ``project``, and ``anchor``
    are pinned read-only: the anchor is generated server-side at deploy
    time, and the parent workspace/project association is fixed for the
    lifetime of the deploy board.
    """

    project_details = ProjectLiteSerializer(read_only=True, source="project")
    workspace_detail = WorkspaceLiteSerializer(read_only=True, source="workspace")

    class Meta:
        """DRF metadata: bind to ``DeployBoard`` with ``workspace``/``project``/``anchor`` pinned read-only."""

        model = DeployBoard
        fields = "__all__"
        read_only_fields = ["workspace", "project", "anchor"]


class ProjectPublicMemberSerializer(BaseSerializer):
    """Serializer for ``ProjectPublicMember`` rows -- public users who can view a deploy-board-shared project.

    ``workspace``, ``project``, and ``member`` are pinned read-only: a
    public-member row is identified by this triple and the association is
    fixed for the lifetime of the row.
    """

    class Meta:
        """DRF metadata: bind to ``ProjectPublicMember`` with ``workspace``/``project``/``member`` pinned read-only."""

        model = ProjectPublicMember
        fields = "__all__"
        read_only_fields = ["workspace", "project", "member"]
