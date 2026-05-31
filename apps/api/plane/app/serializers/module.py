# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for modules, their member rosters, link lists, and per-user preferences.

A module is a themed grouping of issues within a project and spans the
same project as its members. The write serializer synchronizes the
:class:`~plane.db.models.ModuleMember` join rows whenever ``member_ids``
is supplied. Read-side serializers expose queryset-annotated completion
counts and estimate-point rollups that the upstream viewset is
responsible for attaching to the queryset before serialization.
"""

# Third Party imports
from rest_framework import serializers

# Module imports
from .base import BaseSerializer, DynamicBaseSerializer
from .project import ProjectLiteSerializer

# Django imports
from django.core.validators import URLValidator
from django.core.exceptions import ValidationError

from plane.db.models import (
    User,
    Module,
    ModuleMember,
    ModuleIssue,
    ModuleLink,
    ModuleUserProperties,
)


class ModuleWriteSerializer(BaseSerializer):
    """Write serializer for :class:`~plane.db.models.Module`.

    Accepts ``lead_id`` and ``member_ids`` and synchronizes the
    :class:`~plane.db.models.ModuleMember` join rows on create/update.
    ``lead_id`` maps to the ``lead`` FK via ``source="lead"`` and
    ``member_ids`` is a write-only list of user UUIDs that is translated
    into ``ModuleMember`` join rows. The project is taken from
    ``self.context["project"]`` rather than the request payload, and the
    workspace/project/audit fields are pinned read-only.
    """

    lead_id = serializers.PrimaryKeyRelatedField(
        source="lead", queryset=User.objects.all(), required=False, allow_null=True
    )
    member_ids = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=User.objects.all()),
        write_only=True,
        required=False,
    )

    class Meta:
        """DRF metadata: bind to ``Module`` and pin workspace/project/audit/archive fields read-only."""

        model = Module
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
            "archived_at",
            "deleted_at",
        ]

    def to_representation(self, instance):
        """Add ``member_ids`` to the payload as a string-list of the module's member UUIDs."""
        data = super().to_representation(instance)
        data["member_ids"] = [str(member.id) for member in instance.members.all()]
        return data

    def validate(self, data):
        """Reject modules whose start date is after the target date."""
        if (
            data.get("start_date", None) is not None
            and data.get("target_date", None) is not None
            and data.get("start_date", None) > data.get("target_date", None)
        ):
            raise serializers.ValidationError("Start date cannot exceed target date")
        return data

    def create(self, validated_data):
        """Reject duplicate module names per project and bulk-create the supplied member roster.

        The project is taken from ``self.context["project"]`` rather than
        the payload. ``ModuleMember`` rows are inserted via ``bulk_create``
        in batches of 10 with ``ignore_conflicts=True`` so existing
        membership rows are not duplicated.
        """
        members = validated_data.pop("member_ids", None)
        project = self.context["project"]

        module_name = validated_data.get("name")
        if module_name:
            # Lookup for the module name in the module table for that project
            if Module.objects.filter(name=module_name, project=project).exists():
                raise serializers.ValidationError({"error": "Module with this name already exists"})

        module = Module.objects.create(**validated_data, project=project)
        if members is not None:
            ModuleMember.objects.bulk_create(
                [
                    ModuleMember(
                        module=module,
                        member=member,
                        project=project,
                        workspace=project.workspace,
                        created_by=module.created_by,
                        updated_by=module.updated_by,
                    )
                    for member in members
                ],
                batch_size=10,
                ignore_conflicts=True,
            )

        return module

    def update(self, instance, validated_data):
        """Enforce per-project name uniqueness on rename and re-sync member rows when supplied.

        When ``member_ids`` is supplied, the existing ``ModuleMember`` rows
        for the module are deleted and the new roster is bulk-inserted to
        replace it. When ``member_ids`` is omitted, the existing membership
        roster is preserved as-is.
        """
        members = validated_data.pop("member_ids", None)
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
                        member=member,
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


class ModuleFlatSerializer(BaseSerializer):
    """Compact ``Module`` serializer used as a nested payload by :attr:`ModuleIssueSerializer.module_detail`.

    Workspace, project, and audit fields are pinned read-only because this
    serializer is only used for embedding inside other read payloads, not
    for write operations.
    """

    class Meta:
        """DRF metadata: bind to ``Module`` and pin workspace/project/audit fields read-only."""

        model = Module
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]


class ModuleIssueSerializer(BaseSerializer):
    """Serializer for :class:`~plane.db.models.ModuleIssue` rows nesting both module and issue detail.

    Embeds ``module_detail`` (a :class:`ModuleFlatSerializer` projection of
    the parent module), ``issue_detail`` (a
    :class:`~plane.app.serializers.project.ProjectLiteSerializer`
    projection of the joined issue), and the queryset-annotated
    ``sub_issues_count`` integer. The ``module`` FK itself is pinned
    read-only since it is set from the URL context, not the payload.
    """

    module_detail = ModuleFlatSerializer(read_only=True, source="module")
    issue_detail = ProjectLiteSerializer(read_only=True, source="issue")
    sub_issues_count = serializers.IntegerField(read_only=True)

    class Meta:
        """DRF metadata: bind to ``ModuleIssue`` with workspace/project/audit/module fields pinned read-only."""

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
    """Write/read serializer for :class:`~plane.db.models.ModuleLink` rows.

    Normalizes schemeless URLs by prepending ``http://`` before standard
    validation, runs Django's :class:`~django.core.validators.URLValidator`
    against the result, and enforces URL uniqueness per module on both
    create and update. The ``module`` FK is pinned read-only because it is
    derived from the URL context, not the payload.
    """

    class Meta:
        """DRF metadata: bind to ``ModuleLink`` with workspace/project/audit/module fields pinned read-only."""

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

    def to_internal_value(self, data):
        """Normalize the URL by prepending ``http://`` when no scheme is supplied before standard validation runs."""
        # Modify the URL before validation by appending http:// if missing
        url = data.get("url", "")
        if url and not url.startswith(("http://", "https://")):
            data["url"] = "http://" + url

        return super().to_internal_value(data)

    def validate_url(self, value):
        """Validate the URL with Django's :class:`URLValidator` and surface a friendly error message."""
        # Use Django's built-in URLValidator for validation
        url_validator = URLValidator()
        try:
            url_validator(value)
        except ValidationError:
            raise serializers.ValidationError({"error": "Invalid URL format."})

        return value

    def create(self, validated_data):
        """Re-validate the URL and create the link only if no link with the same URL exists on the module."""
        validated_data["url"] = self.validate_url(validated_data.get("url"))
        if ModuleLink.objects.filter(url=validated_data.get("url"), module_id=validated_data.get("module_id")).exists():
            raise serializers.ValidationError({"error": "URL already exists."})
        return super().create(validated_data)

    def update(self, instance, validated_data):
        """Re-validate the URL and update the link only if no other link on the same module shares it."""
        validated_data["url"] = self.validate_url(validated_data.get("url"))
        if (
            ModuleLink.objects.filter(url=validated_data.get("url"), module_id=instance.module_id)
            .exclude(pk=instance.id)
            .exists()
        ):
            raise serializers.ValidationError({"error": "URL already exists for this Issue"})

        return super().update(instance, validated_data)


class ModuleSerializer(DynamicBaseSerializer):
    """Read serializer for :class:`~plane.db.models.Module`.

    Exposes the module fields together with ``member_ids`` and the
    queryset-annotated completion counts (``total_issues``,
    ``cancelled_issues``, ``completed_issues``, ``started_issues``,
    ``unstarted_issues``, ``backlog_issues``), the estimate-point rollups
    (``total_estimate_points``, ``completed_estimate_points``), and the
    ``is_favorite`` flag. All of these annotated fields are computed at
    queryset time by the upstream viewset; if the viewset does not annotate
    them they will be absent from the serialized payload. Every field on
    this serializer is read-only -- writes go through
    :class:`ModuleWriteSerializer`.
    """

    member_ids = serializers.ListField(child=serializers.UUIDField(), required=False, allow_null=True)
    is_favorite = serializers.BooleanField(read_only=True)
    total_issues = serializers.IntegerField(read_only=True)
    cancelled_issues = serializers.IntegerField(read_only=True)
    completed_issues = serializers.IntegerField(read_only=True)
    started_issues = serializers.IntegerField(read_only=True)
    unstarted_issues = serializers.IntegerField(read_only=True)
    backlog_issues = serializers.IntegerField(read_only=True)
    total_estimate_points = serializers.FloatField(read_only=True)
    completed_estimate_points = serializers.FloatField(read_only=True)

    class Meta:
        """DRF metadata: bind to ``Module`` and expose the explicit read-only field projection."""

        model = Module
        fields = [
            # Required fields
            "id",
            "workspace_id",
            "project_id",
            # Model fields
            "name",
            "description",
            "description_text",
            "description_html",
            "start_date",
            "target_date",
            "status",
            "lead_id",
            "member_ids",
            "view_props",
            "sort_order",
            "external_source",
            "external_id",
            "logo_props",
            # computed fields
            "total_estimate_points",
            "completed_estimate_points",
            "is_favorite",
            "total_issues",
            "cancelled_issues",
            "completed_issues",
            "started_issues",
            "unstarted_issues",
            "backlog_issues",
            "created_at",
            "updated_at",
            "archived_at",
        ]
        read_only_fields = fields


class ModuleDetailSerializer(ModuleSerializer):
    """Detail-view extension of :class:`ModuleSerializer`.

    Adds the nested ``link_module`` payload (full list of associated
    :class:`~plane.db.models.ModuleLink` rows), the queryset-annotated
    ``sub_issues`` count, and the per-state estimate-point breakdowns
    (``backlog_estimate_points``, ``unstarted_estimate_points``,
    ``started_estimate_points``, ``cancelled_estimate_points``). Like its
    parent, the count/estimate fields must be annotated by the upstream
    viewset's queryset to appear on the response.
    """

    link_module = ModuleLinkSerializer(read_only=True, many=True)
    sub_issues = serializers.IntegerField(read_only=True)
    backlog_estimate_points = serializers.FloatField(read_only=True)
    unstarted_estimate_points = serializers.FloatField(read_only=True)
    started_estimate_points = serializers.FloatField(read_only=True)
    cancelled_estimate_points = serializers.FloatField(read_only=True)

    class Meta(ModuleSerializer.Meta):
        """DRF metadata: extend :class:`ModuleSerializer.Meta` with detail-view nested fields."""

        fields = ModuleSerializer.Meta.fields + [
            "link_module",
            "sub_issues",
            "backlog_estimate_points",
            "unstarted_estimate_points",
            "started_estimate_points",
            "cancelled_estimate_points",
        ]


class ModuleUserPropertiesSerializer(BaseSerializer):
    """Serializer for per-user :class:`~plane.db.models.ModuleUserProperties` rows.

    Stores each user's module display/filter preferences (which fields are
    visible, sort order, applied filters, etc.). The workspace, project,
    module, and user FKs are pinned read-only because they are derived
    from the URL context and the authenticated request, not the payload.
    """

    class Meta:
        """DRF metadata: bind to ``ModuleUserProperties`` with workspace/project/module/user fields pinned read-only."""

        model = ModuleUserProperties
        fields = "__all__"
        read_only_fields = ["workspace", "project", "module", "user"]
