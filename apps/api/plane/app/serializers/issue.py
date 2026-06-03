# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for the issue resource and its surrounding objects.

This module owns the largest serialization surface in
``plane.app.serializers``.  The bulk of the issue read/write API funnels
through :class:`IssueCreateSerializer` (write) and
:class:`IssueSerializer` / :class:`IssueDetailSerializer` (read), with
supporting serializers for labels, relations, assignees, links,
attachments, reactions, comments, votes, subscribers and version history.
"""

# Django imports
from django.utils import timezone
from django.core.validators import URLValidator
from django.core.exceptions import ValidationError
from django.db import IntegrityError

# Third Party imports
from rest_framework import serializers

# Module imports
from .base import BaseSerializer, DynamicBaseSerializer
from .user import UserLiteSerializer
from .state import StateLiteSerializer
from .project import ProjectLiteSerializer
from .workspace import WorkspaceLiteSerializer
from plane.db.models import (
    User,
    Issue,
    IssueActivity,
    IssueComment,
    ProjectUserProperty,
    IssueAssignee,
    IssueSubscriber,
    IssueLabel,
    Label,
    CycleIssue,
    Cycle,
    Module,
    ModuleIssue,
    IssueLink,
    FileAsset,
    IssueReaction,
    CommentReaction,
    IssueVote,
    IssueRelation,
    State,
    IssueVersion,
    IssueDescriptionVersion,
    ProjectMember,
    EstimatePoint,
)
from plane.utils.content_validator import (
    validate_html_content,
    validate_binary_data,
)


class IssueFlatSerializer(BaseSerializer):
    """Read-only flat-fields-only ``Issue`` view.

    Used as a nested payload inside activity and state serializers.
    """

    ## Contain only flat fields

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = Issue
        fields = [
            "id",
            "name",
            "description_json",
            "description_html",
            "priority",
            "start_date",
            "target_date",
            "sequence_id",
            "sort_order",
            "is_draft",
        ]


class IssueProjectLiteSerializer(BaseSerializer):
    """Lightweight ``Issue`` representation that nests the project details.

    Used for cross-project reference lists.
    """

    project_detail = ProjectLiteSerializer(source="project", read_only=True)

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = Issue
        fields = ["id", "project_detail", "name", "sequence_id"]
        read_only_fields = fields


##TODO: Find a better way to write this serializer
## Find a better approach to save manytomany?
class IssueCreateSerializer(BaseSerializer):
    """Main write serializer for ``Issue``.

    Accepts ``assignee_ids`` and ``label_ids`` as write-only ID lists which
    are translated into ``IssueAssignee`` / ``IssueLabel`` join rows on
    create and update.  Triage-state issues are only accepted when the
    calling view places ``allow_triage_state=True`` in the serializer
    context; otherwise the state manager filters them out.
    """

    # ids
    state_id = serializers.PrimaryKeyRelatedField(
        source="state", queryset=State.all_state_objects.all(), required=False, allow_null=True
    )
    parent_id = serializers.PrimaryKeyRelatedField(
        source="parent", queryset=Issue.objects.all(), required=False, allow_null=True
    )
    label_ids = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=Label.objects.all()),
        write_only=True,
        required=False,
    )
    assignee_ids = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=User.objects.all()),
        write_only=True,
        required=False,
    )
    project_id = serializers.UUIDField(source="project.id", read_only=True)
    workspace_id = serializers.UUIDField(source="workspace.id", read_only=True)

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = Issue
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]

    def to_representation(self, instance):
        """Echo the inbound ``assignee_ids`` / ``label_ids`` payload back into the response.

        Ensures the response shape mirrors the write request.
        """
        data = super().to_representation(instance)
        assignee_ids = self.initial_data.get("assignee_ids")
        data["assignee_ids"] = assignee_ids if assignee_ids else []
        label_ids = self.initial_data.get("label_ids")
        data["label_ids"] = label_ids if label_ids else []
        return data

    def validate(self, attrs):
        """Enforce start/target date ordering and sanitize description content.

        Also project-scopes each foreign key (state, parent, estimate,
        labels, assignees) to the URL-addressed project.
        """
        allow_triage = self.context.get("allow_triage_state", False)
        state_manager = State.triage_objects if allow_triage else State.objects

        if (
            attrs.get("start_date", None) is not None
            and attrs.get("target_date", None) is not None
            and attrs.get("start_date", None) > attrs.get("target_date", None)
        ):
            raise serializers.ValidationError("Start date cannot exceed target date")

        # Validate description content for security
        if "description_html" in attrs and attrs["description_html"]:
            is_valid, error_msg, sanitized_html = validate_html_content(attrs["description_html"])
            if not is_valid:
                raise serializers.ValidationError({"error": "html content is not valid"})
            # Update the attrs with sanitized HTML if available
            if sanitized_html is not None:
                attrs["description_html"] = sanitized_html

        if "description_binary" in attrs and attrs["description_binary"]:
            is_valid, error_msg = validate_binary_data(attrs["description_binary"])
            if not is_valid:
                raise serializers.ValidationError({"description_binary": "Invalid binary data"})

        # Validate assignees are from project
        if attrs.get("assignee_ids", []):
            attrs["assignee_ids"] = ProjectMember.objects.filter(
                project_id=self.context["project_id"],
                role__gte=15,
                is_active=True,
                member_id__in=attrs["assignee_ids"],
            ).values_list("member_id", flat=True)

        # Validate labels are from project
        if attrs.get("label_ids"):
            label_ids = [label.id for label in attrs["label_ids"]]
            attrs["label_ids"] = list(
                Label.objects.filter(
                    project_id=self.context.get("project_id"),
                    id__in=label_ids,
                ).values_list("id", flat=True)
            )

        # Check state is from the project only else raise validation error
        if (
            attrs.get("state")
            and not state_manager.filter(
                project_id=self.context.get("project_id"),
                pk=attrs.get("state").id,
            ).exists()
        ):
            raise serializers.ValidationError("State is not valid please pass a valid state_id")

        # Check parent issue is from workspace as it can be cross workspace
        if (
            attrs.get("parent")
            and not Issue.objects.filter(
                project_id=self.context.get("project_id"),
                pk=attrs.get("parent").id,
            ).exists()
        ):
            raise serializers.ValidationError("Parent is not valid issue_id please pass a valid issue_id")

        if (
            attrs.get("estimate_point")
            and not EstimatePoint.objects.filter(
                project_id=self.context.get("project_id"),
                pk=attrs.get("estimate_point").id,
            ).exists()
        ):
            raise serializers.ValidationError("Estimate point is not valid please pass a valid estimate_point_id")

        return attrs

    def create(self, validated_data):
        """Create the issue and bulk-sync the ``IssueAssignee`` / ``IssueLabel`` join rows.

        Falls back to the project's ``default_assignee_id`` when no assignees
        are supplied in the payload.
        """
        assignees = validated_data.pop("assignee_ids", None)
        labels = validated_data.pop("label_ids", None)

        project_id = self.context["project_id"]
        workspace_id = self.context["workspace_id"]
        default_assignee_id = self.context["default_assignee_id"]

        # Create Issue
        issue = Issue.objects.create(**validated_data, project_id=project_id)

        # Issue Audit Users
        created_by_id = issue.created_by_id
        updated_by_id = issue.updated_by_id

        if assignees is not None and len(assignees):
            try:
                IssueAssignee.objects.bulk_create(
                    [
                        IssueAssignee(
                            assignee_id=assignee_id,
                            issue=issue,
                            project_id=project_id,
                            workspace_id=workspace_id,
                            created_by_id=created_by_id,
                            updated_by_id=updated_by_id,
                        )
                        for assignee_id in assignees
                    ],
                    batch_size=10,
                )
            except IntegrityError:
                pass
        else:
            # Then assign it to default assignee, if it is a valid assignee
            if (
                default_assignee_id is not None
                and ProjectMember.objects.filter(
                    member_id=default_assignee_id,
                    project_id=project_id,
                    role__gte=15,
                    is_active=True,
                ).exists()
            ):
                try:
                    IssueAssignee.objects.create(
                        assignee_id=default_assignee_id,
                        issue=issue,
                        project_id=project_id,
                        workspace_id=workspace_id,
                        created_by_id=created_by_id,
                        updated_by_id=updated_by_id,
                    )
                except IntegrityError:
                    pass

        if labels is not None and len(labels):
            try:
                IssueLabel.objects.bulk_create(
                    [
                        IssueLabel(
                            label_id=label_id,
                            issue=issue,
                            project_id=project_id,
                            workspace_id=workspace_id,
                            created_by_id=created_by_id,
                            updated_by_id=updated_by_id,
                        )
                        for label_id in labels
                    ],
                    batch_size=10,
                )
            except IntegrityError:
                pass

        return issue

    def update(self, instance, validated_data):
        """Replace the issue's assignee/label join rows when those payload keys are present.

        Always refreshes ``updated_at`` so the timestamp moves even when
        only related-model rows changed.
        """
        assignees = validated_data.pop("assignee_ids", None)
        labels = validated_data.pop("label_ids", None)

        # Related models
        project_id = instance.project_id
        workspace_id = instance.workspace_id
        created_by_id = instance.created_by_id
        updated_by_id = instance.updated_by_id

        if assignees is not None:
            IssueAssignee.objects.filter(issue=instance).delete()
            try:
                IssueAssignee.objects.bulk_create(
                    [
                        IssueAssignee(
                            assignee_id=assignee_id,
                            issue=instance,
                            project_id=project_id,
                            workspace_id=workspace_id,
                            created_by_id=created_by_id,
                            updated_by_id=updated_by_id,
                        )
                        for assignee_id in assignees
                    ],
                    batch_size=10,
                    ignore_conflicts=True,
                )
            except IntegrityError:
                pass

        if labels is not None:
            IssueLabel.objects.filter(issue=instance).delete()
            try:
                IssueLabel.objects.bulk_create(
                    [
                        IssueLabel(
                            label_id=label_id,
                            issue=instance,
                            project_id=project_id,
                            workspace_id=workspace_id,
                            created_by_id=created_by_id,
                            updated_by_id=updated_by_id,
                        )
                        for label_id in labels
                    ],
                    batch_size=10,
                    ignore_conflicts=True,
                )
            except IntegrityError:
                pass

        # Time updation occues even when other related models are updated
        instance.updated_at = timezone.now()
        return super().update(instance, validated_data)


class IssueActivitySerializer(BaseSerializer):
    """Read-only serializer for ``IssueActivity`` audit rows.

    Nests actor / issue / project / workspace details and exposes
    ``source_data`` for issues created via an external source (e.g.,
    email-in).
    """

    actor_detail = UserLiteSerializer(read_only=True, source="actor")
    issue_detail = IssueFlatSerializer(read_only=True, source="issue")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    workspace_detail = WorkspaceLiteSerializer(read_only=True, source="workspace")
    source_data = serializers.SerializerMethodField()

    def get_source_data(self, obj):
        """Return ``{source, source_email, extra}`` for externally-created issues.

        Returns ``None`` when no source row is attached to the issue.
        """
        if hasattr(obj, "issue") and hasattr(obj.issue, "source_data") and obj.issue.source_data:
            return {
                "source": obj.issue.source_data[0].source,
                "source_email": obj.issue.source_data[0].source_email,
                "extra": obj.issue.source_data[0].extra,
            }
        return None

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = IssueActivity
        fields = "__all__"


class ProjectUserPropertySerializer(BaseSerializer):
    """Serializer for per-user ``ProjectUserProperty`` rows.

    Stores user-specific project display/filter preferences.
    """

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = ProjectUserProperty
        fields = "__all__"
        read_only_fields = ["user", "workspace", "project"]


class LabelSerializer(BaseSerializer):
    """Write/read serializer for ``Label``.

    Enforces case-insensitive name uniqueness per project.
    """

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = Label
        fields = [
            "parent",
            "name",
            "color",
            "id",
            "project_id",
            "workspace_id",
            "sort_order",
        ]
        read_only_fields = ["workspace", "project"]

    def validate_name(self, value):
        """Reject duplicate label names (case-insensitive) within the same project."""
        project_id = self.context.get("project_id")

        label = Label.objects.filter(project_id=project_id, name__iexact=value)

        if self.instance:
            label = label.exclude(id=self.instance.pk)

        if label.exists():
            raise serializers.ValidationError(detail="LABEL_NAME_ALREADY_EXISTS")

        return value


class LabelLiteSerializer(BaseSerializer):
    """Compact ``Label`` representation (id, name, color).

    Used as a nested field on issue/list serializers.
    """

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = Label
        fields = ["id", "name", "color"]


class IssueLabelSerializer(BaseSerializer):
    """Serializer for the ``IssueLabel`` M2M join row.

    Workspace and project are set from URL context.
    """

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = IssueLabel
        fields = "__all__"
        read_only_fields = ["workspace", "project"]


class IssueRelationSerializer(BaseSerializer):
    """Outgoing side of ``IssueRelation``.

    Exposes the related issue's identity (id, sequence_id, name, state,
    priority) plus the relation type.
    """

    id = serializers.UUIDField(source="related_issue.id", read_only=True)
    project_id = serializers.PrimaryKeyRelatedField(source="related_issue.project_id", read_only=True)
    sequence_id = serializers.IntegerField(source="related_issue.sequence_id", read_only=True)
    name = serializers.CharField(source="related_issue.name", read_only=True)
    relation_type = serializers.CharField(read_only=True)
    state_id = serializers.UUIDField(source="related_issue.state.id", read_only=True)
    priority = serializers.CharField(source="related_issue.priority", read_only=True)
    assignee_ids = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=User.objects.all()),
        write_only=True,
        required=False,
    )

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = IssueRelation
        fields = [
            "id",
            "project_id",
            "sequence_id",
            "relation_type",
            "name",
            "state_id",
            "priority",
            "assignee_ids",
            "created_by",
            "created_at",
            "updated_at",
            "updated_by",
        ]
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "created_at",
            "updated_by",
            "updated_at",
        ]


class RelatedIssueSerializer(BaseSerializer):
    """Incoming side of ``IssueRelation``.

    Mirror of :class:`IssueRelationSerializer` that exposes the originating
    issue's identity for the inverse relationship.
    """

    id = serializers.UUIDField(source="issue.id", read_only=True)
    project_id = serializers.PrimaryKeyRelatedField(source="issue.project_id", read_only=True)
    sequence_id = serializers.IntegerField(source="issue.sequence_id", read_only=True)
    name = serializers.CharField(source="issue.name", read_only=True)
    relation_type = serializers.CharField(read_only=True)
    state_id = serializers.UUIDField(source="issue.state.id", read_only=True)
    priority = serializers.CharField(source="issue.priority", read_only=True)
    assignee_ids = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=User.objects.all()),
        write_only=True,
        required=False,
    )

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = IssueRelation
        fields = [
            "id",
            "project_id",
            "sequence_id",
            "relation_type",
            "name",
            "state_id",
            "priority",
            "assignee_ids",
            "created_by",
            "created_at",
            "updated_by",
            "updated_at",
        ]
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "created_at",
            "updated_by",
            "updated_at",
        ]


class IssueAssigneeSerializer(BaseSerializer):
    """Serializer for ``IssueAssignee`` rows with a nested ``assignee_details`` lite-user view."""

    assignee_details = UserLiteSerializer(read_only=True, source="assignee")

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = IssueAssignee
        fields = "__all__"


class CycleBaseSerializer(BaseSerializer):
    """Compact ``Cycle`` serializer used as a nested payload by :class:`IssueCycleDetailSerializer`."""

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = Cycle
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]


class IssueCycleDetailSerializer(BaseSerializer):
    """Serializer for ``CycleIssue`` rows with the cycle pulled in via nested ``cycle_detail``."""

    cycle_detail = CycleBaseSerializer(read_only=True, source="cycle")

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = CycleIssue
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]


class ModuleBaseSerializer(BaseSerializer):
    """Compact ``Module`` serializer used as a nested payload by :class:`IssueModuleDetailSerializer`."""

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

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


class IssueModuleDetailSerializer(BaseSerializer):
    """Serializer for ``ModuleIssue`` rows with the module pulled in via nested ``module_detail``."""

    module_detail = ModuleBaseSerializer(read_only=True, source="module")

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = ModuleIssue
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]


class IssueLinkSerializer(BaseSerializer):
    """Write/read serializer for ``IssueLink`` rows.

    Prepends ``http://`` to schemeless URLs and rejects duplicates per
    issue.
    """

    created_by_detail = UserLiteSerializer(read_only=True, source="created_by")

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = IssueLink
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
            "issue",
        ]

    def to_internal_value(self, data):
        """Normalize the URL by prepending ``http://`` when no scheme is supplied.

        Runs before standard DRF validation so the URLValidator sees a
        schemed URL.
        """
        # Modify the URL before validation by appending http:// if missing
        url = data.get("url", "")
        if url and not url.startswith(("http://", "https://")):
            data["url"] = "http://" + url

        return super().to_internal_value(data)

    def validate_url(self, value):
        """Validate the URL with Django's built-in ``URLValidator``.

        Surfaces a friendly error message when the URL is malformed.
        """
        # Use Django's built-in URLValidator for validation
        url_validator = URLValidator()
        try:
            url_validator(value)
        except ValidationError:
            raise serializers.ValidationError({"error": "Invalid URL format."})

        return value

    # Validation if url already exists
    def create(self, validated_data):
        """Create the link only if no link with the same URL exists on the issue.

        Enforces URL uniqueness per issue.
        """
        if IssueLink.objects.filter(url=validated_data.get("url"), issue_id=validated_data.get("issue_id")).exists():
            raise serializers.ValidationError({"error": "URL already exists for this Issue"})
        return IssueLink.objects.create(**validated_data)

    def update(self, instance, validated_data):
        """Update the link's URL only if no other link with that URL exists on the same issue."""
        if (
            IssueLink.objects.filter(url=validated_data.get("url"), issue_id=instance.issue_id)
            .exclude(pk=instance.id)
            .exists()
        ):
            raise serializers.ValidationError({"error": "URL already exists for this Issue"})

        return super().update(instance, validated_data)


class IssueLinkLiteSerializer(BaseSerializer):
    """Compact read-only ``IssueLink`` view used as the nested expansion target for issue list serializers."""

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = IssueLink
        fields = [
            "id",
            "issue_id",
            "title",
            "url",
            "metadata",
            "created_by_id",
            "created_at",
        ]
        read_only_fields = fields


class IssueAttachmentSerializer(BaseSerializer):
    """Serializer for ``FileAsset`` rows attached to issues, exposing a server-rendered ``asset_url``."""

    asset_url = serializers.CharField(read_only=True)

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = FileAsset
        fields = "__all__"
        read_only_fields = [
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
            "workspace",
            "project",
            "issue",
        ]


class IssueAttachmentLiteSerializer(DynamicBaseSerializer):
    """Compact attachment serializer.

    Used as the expansion target for ``issue_attachments`` in
    :class:`DynamicBaseSerializer`.
    """

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = FileAsset
        fields = [
            "id",
            "asset",
            "attributes",
            # "issue_id",
            "created_by",
            "updated_at",
            "updated_by",
            "asset_url",
        ]
        read_only_fields = fields


class IssueReactionSerializer(BaseSerializer):
    """Serializer for emoji reactions on issues.

    Workspace, project, issue and actor are read-only.
    """

    actor_detail = UserLiteSerializer(read_only=True, source="actor")

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = IssueReaction
        fields = "__all__"
        read_only_fields = ["workspace", "project", "issue", "actor", "deleted_at"]


class IssueReactionLiteSerializer(DynamicBaseSerializer):
    """Compact reaction serializer.

    Used as the expansion target for ``issue_reactions`` in
    :class:`DynamicBaseSerializer`.
    """

    display_name = serializers.CharField(source="actor.display_name", read_only=True)

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = IssueReaction
        fields = ["id", "actor", "issue", "reaction", "display_name"]


class CommentReactionSerializer(BaseSerializer):
    """Serializer for emoji reactions on issue comments.

    Workspace, project, comment and actor are read-only.
    """

    display_name = serializers.CharField(source="actor.display_name", read_only=True)

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = CommentReaction
        fields = [
            "id",
            "actor",
            "comment",
            "reaction",
            "display_name",
            "deleted_at",
            "workspace",
            "project",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]
        read_only_fields = ["workspace", "project", "comment", "actor", "deleted_at", "created_by", "updated_by"]


class IssueVoteSerializer(BaseSerializer):
    """Read-only serializer for up/down ``IssueVote`` rows used by the public deploy-board view."""

    actor_detail = UserLiteSerializer(read_only=True, source="actor")

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = IssueVote
        fields = ["issue", "vote", "workspace", "project", "actor", "actor_detail"]
        read_only_fields = fields


class IssueCommentSerializer(BaseSerializer):
    """Serializer for ``IssueComment`` rows.

    Nests actor / issue / project / workspace details and includes a
    list of comment reactions.
    """

    actor_detail = UserLiteSerializer(read_only=True, source="actor")
    issue_detail = IssueFlatSerializer(read_only=True, source="issue")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    workspace_detail = WorkspaceLiteSerializer(read_only=True, source="workspace")
    comment_reactions = CommentReactionSerializer(read_only=True, many=True)
    is_member = serializers.BooleanField(read_only=True)

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = IssueComment
        fields = "__all__"
        read_only_fields = [
            "workspace",
            "project",
            "issue",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
        ]


class IssueStateFlatSerializer(BaseSerializer):
    """Lightweight ``Issue`` view that nests state and project details.

    Used by activity feeds and similar read-only contexts.
    """

    state_detail = StateLiteSerializer(read_only=True, source="state")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = Issue
        fields = ["id", "sequence_id", "name", "state_detail", "project_detail"]


# Issue Serializer with state details
class IssueStateSerializer(DynamicBaseSerializer):
    """Read serializer for ``Issue`` with nested state, project, labels and assignees.

    Includes annotated counts (sub-issues / attachments / links).
    """

    label_details = LabelLiteSerializer(read_only=True, source="labels", many=True)
    state_detail = StateLiteSerializer(read_only=True, source="state")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    assignee_details = UserLiteSerializer(read_only=True, source="assignees", many=True)
    sub_issues_count = serializers.IntegerField(read_only=True)
    attachment_count = serializers.IntegerField(read_only=True)
    link_count = serializers.IntegerField(read_only=True)

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = Issue
        fields = "__all__"


class IssueIntakeSerializer(DynamicBaseSerializer):
    """Compact ``Issue`` view used inside intake queue payloads.

    Exposes priority, sequence and queryset-annotated ``label_ids``.
    """

    label_ids = serializers.ListField(child=serializers.UUIDField(), required=False)

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = Issue
        fields = [
            "id",
            "name",
            "priority",
            "sequence_id",
            "project_id",
            "created_at",
            "label_ids",
            "created_by",
        ]
        read_only_fields = fields


class IssueSerializer(DynamicBaseSerializer):
    """Primary read serializer for ``Issue``.

    Exposes the flat record plus pre-computed cycle / module / label /
    assignee ID lists and annotated counts.
    """

    # ids
    cycle_id = serializers.PrimaryKeyRelatedField(read_only=True)
    module_ids = serializers.ListField(child=serializers.UUIDField(), required=False)

    # Many to many
    label_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    assignee_ids = serializers.ListField(child=serializers.UUIDField(), required=False)

    # Count items
    sub_issues_count = serializers.IntegerField(read_only=True)
    attachment_count = serializers.IntegerField(read_only=True)
    link_count = serializers.IntegerField(read_only=True)

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = Issue
        fields = [
            "id",
            "name",
            "state_id",
            "sort_order",
            "completed_at",
            "estimate_point",
            "priority",
            "start_date",
            "target_date",
            "sequence_id",
            "project_id",
            "parent_id",
            "cycle_id",
            "module_ids",
            "label_ids",
            "assignee_ids",
            "sub_issues_count",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
            "attachment_count",
            "link_count",
            "is_draft",
            "archived_at",
        ]
        read_only_fields = fields

    def validate(self, data):
        """Validate that any supplied ``state_id`` belongs to the URL-addressed project."""
        if (
            data.get("state_id")
            and not State.objects.filter(project_id=self.context.get("project_id"), pk=data.get("state_id")).exists()
        ):
            raise serializers.ValidationError("State is not valid please pass a valid state_id")
        return data


class IssueListDetailSerializer(serializers.Serializer):
    """Hand-rolled ``serializers.Serializer`` (NOT a ``ModelSerializer``).

    Builds the issue list-view payload with optional inline expansion of
    ``issue_relation`` / ``issue_related`` based on the constructor-
    injected ``expand`` argument.
    """

    def __init__(self, *args, **kwargs):
        """Capture ``expand`` / ``fields`` kwargs before delegating to the parent serializer."""
        # Extract expand parameter and store it as instance variable
        self.expand = kwargs.pop("expand", []) or []
        # Extract fields parameter and store it as instance variable
        self.fields = kwargs.pop("fields", []) or []
        super().__init__(*args, **kwargs)

    def get_module_ids(self, obj):
        """Project related module IDs from the prefetched ``issue_module`` reverse-relation manager."""
        return [module.module_id for module in obj.issue_module.all()]

    def get_label_ids(self, obj):
        """Project related label IDs from the prefetched ``label_issue`` reverse-relation manager."""
        return [label.label_id for label in obj.label_issue.all()]

    def get_assignee_ids(self, obj):
        """Project related assignee IDs from the prefetched ``issue_assignee`` reverse-relation manager."""
        return [assignee.assignee_id for assignee in obj.issue_assignee.all()]

    def to_representation(self, instance):
        """Build the flat list payload with optional inline expansion of related issues.

        Inlines ``issue_relation`` / ``issue_related`` when the constructor
        ``expand`` list requested them.  Deleted related issues are skipped.
        """
        data = {
            # Basic fields
            "id": instance.id,
            "name": instance.name,
            "state_id": instance.state_id,
            "sort_order": instance.sort_order,
            "completed_at": instance.completed_at,
            "estimate_point": instance.estimate_point_id,
            "priority": instance.priority,
            "start_date": instance.start_date,
            "target_date": instance.target_date,
            "sequence_id": instance.sequence_id,
            "project_id": instance.project_id,
            "parent_id": instance.parent_id,
            "created_at": instance.created_at,
            "updated_at": instance.updated_at,
            "created_by": instance.created_by_id,
            "updated_by": instance.updated_by_id,
            "is_draft": instance.is_draft,
            "archived_at": instance.archived_at,
            # Computed fields
            "cycle_id": instance.cycle_id,
            "module_ids": self.get_module_ids(instance),
            "label_ids": self.get_label_ids(instance),
            "assignee_ids": self.get_assignee_ids(instance),
            "sub_issues_count": instance.sub_issues_count,
            "attachment_count": instance.attachment_count,
            "link_count": instance.link_count,
        }

        # Handle expanded fields only when requested - using direct field access
        if self.expand:
            if "issue_relation" in self.expand:
                relations = []
                for relation in instance.issue_relation.all():
                    related_issue = relation.related_issue
                    # If the related issue is deleted, skip it
                    if not related_issue:
                        continue
                    # Add the related issue to the relations list
                    relations.append(
                        {
                            "id": related_issue.id,
                            "project_id": related_issue.project_id,
                            "sequence_id": related_issue.sequence_id,
                            "name": related_issue.name,
                            "relation_type": relation.relation_type,
                            "state_id": related_issue.state_id,
                            "priority": related_issue.priority,
                            "created_by": related_issue.created_by_id,
                            "created_at": related_issue.created_at,
                            "updated_at": related_issue.updated_at,
                            "updated_by": related_issue.updated_by_id,
                        }
                    )
                data["issue_relation"] = relations

            if "issue_related" in self.expand:
                related = []
                for relation in instance.issue_related.all():
                    issue = relation.issue
                    # If the related issue is deleted, skip it
                    if not issue:
                        continue
                    # Add the related issue to the related list
                    related.append(
                        {
                            "id": issue.id,
                            "project_id": issue.project_id,
                            "sequence_id": issue.sequence_id,
                            "name": issue.name,
                            "relation_type": relation.relation_type,
                            "state_id": issue.state_id,
                            "priority": issue.priority,
                            "created_by": issue.created_by_id,
                            "created_at": issue.created_at,
                            "updated_at": issue.updated_at,
                            "updated_by": issue.updated_by_id,
                        }
                    )
                data["issue_related"] = related

        return data


class IssueLiteSerializer(DynamicBaseSerializer):
    """Minimal ``Issue`` representation (id, sequence_id, project_id).

    Used as a nested expansion target for parent/sub-issue references.
    """

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = Issue
        fields = ["id", "sequence_id", "project_id"]
        read_only_fields = fields


class IssueDetailSerializer(IssueSerializer):
    """Detail-view extension of :class:`IssueSerializer`.

    Adds ``description_html``, ``is_subscribed`` and ``is_intake``
    (annotated on the queryset).
    """

    description_html = serializers.CharField()
    is_subscribed = serializers.BooleanField(read_only=True)
    is_intake = serializers.BooleanField(read_only=True)

    class Meta(IssueSerializer.Meta):
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        fields = IssueSerializer.Meta.fields + [
            "description_html",
            "is_subscribed",
            "is_intake",
        ]
        read_only_fields = fields


class IssuePublicSerializer(BaseSerializer):
    """Public deploy-board issue view.

    Exposes the state/project details, reactions and votes for
    unauthenticated visitors.
    """

    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    state_detail = StateLiteSerializer(read_only=True, source="state")
    reactions = IssueReactionSerializer(read_only=True, many=True, source="issue_reactions")
    votes = IssueVoteSerializer(read_only=True, many=True)

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = Issue
        fields = [
            "id",
            "name",
            "description_html",
            "sequence_id",
            "state",
            "state_detail",
            "project",
            "project_detail",
            "workspace",
            "priority",
            "target_date",
            "reactions",
            "votes",
        ]
        read_only_fields = fields


class IssueSubscriberSerializer(BaseSerializer):
    """Serializer for the ``IssueSubscriber`` join row (workspace/project/issue read-only)."""

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = IssueSubscriber
        fields = "__all__"
        read_only_fields = ["workspace", "project", "issue"]


class IssueVersionDetailSerializer(BaseSerializer):
    """Read-only serializer for ``IssueVersion`` historical snapshots of the issue's high-level fields."""

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = IssueVersion
        fields = [
            "id",
            "workspace",
            "project",
            "issue",
            "parent",
            "state",
            "estimate_point",
            "name",
            "priority",
            "start_date",
            "target_date",
            "assignees",
            "sequence_id",
            "labels",
            "sort_order",
            "completed_at",
            "archived_at",
            "is_draft",
            "external_source",
            "external_id",
            "type",
            "cycle",
            "modules",
            "meta",
            "name",
            "last_saved_at",
            "owned_by",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]
        read_only_fields = ["workspace", "project", "issue"]


class IssueDescriptionVersionDetailSerializer(BaseSerializer):
    """Read-only serializer for ``IssueDescriptionVersion`` rows.

    Historical snapshots of the issue's description (binary, html,
    json, stripped).
    """

    class Meta:
        """DRF serializer Meta options (model, fields and read-only configuration)."""

        model = IssueDescriptionVersion
        fields = [
            "id",
            "workspace",
            "project",
            "issue",
            "description_binary",
            "description_html",
            "description_stripped",
            "description_json",
            "last_saved_at",
            "owned_by",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]
        read_only_fields = ["workspace", "project", "issue"]
