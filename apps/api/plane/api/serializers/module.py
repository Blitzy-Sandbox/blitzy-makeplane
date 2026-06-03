# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
"""Module (feature grouping) serializers for the ``/api/v1/`` API surface.

Used by :mod:`plane.api.views.module`. Write paths gate creation on the
project's ``module_view`` feature flag, narrow ``members`` to active project
members, reject duplicate module names within the same project, and bulk
maintain ``ModuleMember`` join rows. Read serializers attach work-item
counters (total / completed / cancelled / started / unstarted / backlog)
annotated by the ViewSet queryset.
"""

# Third party imports
from rest_framework import serializers

# Module imports
from .base import BaseSerializer
from plane.db.models import (
    User,
    Module,
    ModuleLink,
    ModuleMember,
    ModuleIssue,
    ProjectMember,
    Project,
)


class ModuleCreateSerializer(BaseSerializer):
    """
    Serializer for creating modules with member validation and date checking.

    Handles module creation including member assignment validation, date range
    verification, and duplicate name prevention for feature-based
    project organization setup.
    """

    members = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=User.objects.all()),
        write_only=True,
        required=False,
    )

    class Meta:
        """DRF metadata for ``ModuleCreateSerializer``.

        Exposes the writable fields needed for new-module creation; the
        ``members`` join is handled separately via ``ModuleMember`` and
        audit columns are kept read-only.
        """

        model = Module
        fields = [
            "name",
            "description",
            "start_date",
            "target_date",
            "status",
            "lead",
            "members",
            "external_source",
            "external_id",
        ]
        read_only_fields = [
            "id",
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
            "deleted_at",
        ]

    def validate(self, data):
        """Validate project context, the module feature flag, the date range, and member project-membership.

        Rejects projects without ``module_view`` enabled, enforces
        ``start_date <= target_date``, and narrows ``members`` to active project
        members for the host ``project_id``.
        """
        project_id = self.context.get("project_id")
        if not project_id:
            raise serializers.ValidationError("Project ID is required")
        project = Project.objects.get(id=project_id)
        if not project:
            raise serializers.ValidationError("Project not found")
        if not project.module_view:
            raise serializers.ValidationError("Modules are not enabled for this project")
        if (
            data.get("start_date", None) is not None
            and data.get("target_date", None) is not None
            and data.get("start_date", None) > data.get("target_date", None)
        ):
            raise serializers.ValidationError("Start date cannot exceed target date")

        if data.get("members", []):
            data["members"] = ProjectMember.objects.filter(
                project_id=self.context.get("project_id"), member_id__in=data["members"]
            ).values_list("member_id", flat=True)

        return data

    def create(self, validated_data):
        """Create a ``Module`` and bulk-create its ``ModuleMember`` rows.

        Rejects duplicate module names within the same project.
        """
        members = validated_data.pop("members", None)

        project_id = self.context["project_id"]
        workspace_id = self.context["workspace_id"]

        module_name = validated_data.get("name")
        if module_name:
            # Lookup for the module name in the module table for that project
            module = Module.objects.filter(name=module_name, project_id=project_id).first()
            if module:
                raise serializers.ValidationError(
                    {
                        "id": str(module.id),
                        "code": "MODULE_NAME_ALREADY_EXISTS",
                        "error": "Module with this name already exists",
                        "message": "Module with this name already exists",
                    }
                )

        module = Module.objects.create(**validated_data, project_id=project_id)
        if members is not None:
            ModuleMember.objects.bulk_create(
                [
                    ModuleMember(
                        module=module,
                        member_id=str(member),
                        project_id=project_id,
                        workspace_id=workspace_id,
                        created_by=module.created_by,
                        updated_by=module.updated_by,
                    )
                    for member in members
                ],
                batch_size=10,
                ignore_conflicts=True,
            )

        return module


class ModuleUpdateSerializer(ModuleCreateSerializer):
    """
    Serializer for updating modules with enhanced validation and member management.

    Extends module creation with update-specific validations including
    member reassignment, name conflict checking,
    and relationship management for module modifications.
    """

    class Meta(ModuleCreateSerializer.Meta):
        """DRF metadata for ``ModuleUpdateSerializer``.

        Extends ``ModuleCreateSerializer.Meta`` by additionally exposing
        ``members`` as a writable field for update flows.
        """

        model = Module
        fields = ModuleCreateSerializer.Meta.fields + [
            "members",
        ]
        read_only_fields = ModuleCreateSerializer.Meta.read_only_fields

    def update(self, instance, validated_data):
        """Update a ``Module`` and replace its ``ModuleMember`` join rows.

        Rejects name collisions within the project; the ``ModuleMember`` join
        rows are replaced only when ``members`` is supplied.
        """
        members = validated_data.pop("members", None)
        module_name = validated_data.get("name")
        if module_name:
            # Lookup for the module name in the module table for that project
            if Module.objects.filter(name=module_name, project=instance.project).exclude(id=instance.id).exists():
                raise serializers.ValidationError({"error": "Module with this name already exists"})

        if members is not None:
            ModuleMember.objects.filter(module=instance).delete()
            ModuleMember.objects.bulk_create(
                [
                    ModuleMember(
                        module=instance,
                        member_id=str(member),
                        project=instance.project,
                        workspace=instance.project.workspace,
                        created_by=instance.created_by,
                        updated_by=instance.updated_by,
                    )
                    for member in members
                ],
                batch_size=10,
                ignore_conflicts=True,
            )

        return super().update(instance, validated_data)


class ModuleSerializer(BaseSerializer):
    """
    Comprehensive module serializer with work item metrics and member management.

    Provides complete module data including work item counts by status, member
    relationships, and progress tracking for feature-based project organization.
    """

    members = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=User.objects.all()),
        write_only=True,
        required=False,
    )
    total_issues = serializers.IntegerField(read_only=True)
    cancelled_issues = serializers.IntegerField(read_only=True)
    completed_issues = serializers.IntegerField(read_only=True)
    started_issues = serializers.IntegerField(read_only=True)
    unstarted_issues = serializers.IntegerField(read_only=True)
    backlog_issues = serializers.IntegerField(read_only=True)

    class Meta:
        """DRF metadata for the full ``ModuleSerializer``.

        Includes all ``Module`` model fields plus the read-only work-item
        counter annotations; audit columns are kept read-only.
        """

        model = Module
        fields = "__all__"
        read_only_fields = [
            "id",
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
            "deleted_at",
        ]

    def to_representation(self, instance):
        """Inject ``members`` as a list of UUID strings sourced from the ``Module.members`` many-to-many relation."""
        data = super().to_representation(instance)
        data["members"] = [str(member.id) for member in instance.members.all()]
        return data


class ModuleIssueSerializer(BaseSerializer):
    """
    Serializer for module-work item relationships with sub-item counting.

    Manages the association between modules and work items, including
    hierarchical issue tracking for nested work item structures.
    """

    sub_issues_count = serializers.IntegerField(read_only=True)

    class Meta:
        """DRF metadata for ``ModuleIssueSerializer``.

        Serializes every ``ModuleIssue`` field; ``module`` and audit columns
        remain read-only since the membership is established by the parent
        ViewSet.
        """

        model = ModuleIssue
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
            "module",
        ]


class ModuleLinkSerializer(BaseSerializer):
    """
    Serializer for module external links with URL validation.

    Handles external resource associations with modules including
    URL validation and duplicate prevention for reference management.
    """

    class Meta:
        """DRF metadata for ``ModuleLinkSerializer``.

        Serializes every ``ModuleLink`` field; ``module`` and audit columns
        remain read-only since the link is scoped to a specific module by
        the parent ViewSet.
        """

        model = ModuleLink
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
            "module",
        ]

    # Validation if url already exists
    def create(self, validated_data):
        """Create a ``ModuleLink`` rejecting duplicates within a module.

        Duplicates are determined by the ``(url, module_id)`` pair to keep
        link lists unique per module.
        """
        if ModuleLink.objects.filter(url=validated_data.get("url"), module_id=validated_data.get("module_id")).exists():
            raise serializers.ValidationError({"error": "URL already exists for this Issue"})
        return ModuleLink.objects.create(**validated_data)


class ModuleLiteSerializer(BaseSerializer):
    """
    Lightweight module serializer for minimal data transfer.

    Provides essential module information without computed metrics,
    optimized for list views and reference lookups.
    """

    class Meta:
        """DRF metadata for ``ModuleLiteSerializer``.

        Exposes every ``Module`` field as a lightweight payload for list and
        reference views (no work-item counters or member expansion).
        """

        model = Module
        fields = "__all__"


class ModuleIssueRequestSerializer(serializers.Serializer):
    """
    Serializer for bulk work item assignment to modules.

    Validates work item ID lists for batch operations including
    module assignment and work item organization workflows.
    """

    issues = serializers.ListField(
        child=serializers.UUIDField(),
        help_text="List of issue IDs to add to the module",
    )
