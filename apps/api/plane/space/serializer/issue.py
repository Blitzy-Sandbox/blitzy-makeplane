# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for issue-centric payloads in the ``plane.space`` API.

Defines the DRF serializers used by ``apps/api/plane/space/views/issue.py``
and adjacent view modules to shape issues, comments, reactions, votes,
labels, links, attachments, and issue relations on published deploy boards.

Serializer categories:

* **Lite projections** -- :class:`IssueStateFlatSerializer`,
  :class:`IssueProjectLiteSerializer`, :class:`IssueFlatSerializer`,
  :class:`CommentReactionLiteSerializer`, :class:`LabelLiteSerializer`.
  Compact response payloads used inside nested serializers to avoid N+1
  over-fetching when an issue's identity is needed but its full payload is
  not.
* **Full entity serializers** -- :class:`LabelSerializer`,
  :class:`IssueSerializer`, :class:`IssueLinkSerializer`,
  :class:`IssueAttachmentSerializer`, :class:`IssueReactionSerializer`,
  :class:`IssueCommentSerializer`, :class:`CommentReactionSerializer`,
  :class:`IssueVoteSerializer`. Exposed for detail views and CRUD endpoints.
* **Relation serializers** -- :class:`IssueRelationSerializer`,
  :class:`RelatedIssueSerializer`, :class:`IssueCycleDetailSerializer`,
  :class:`IssueModuleDetailSerializer`. Describe how an issue is linked to
  cycles, modules, and other issues.
* **Public-board** -- :class:`IssuePublicSerializer`. Projected issue payload
  safe for anonymous traffic on published deploy boards.
* **Write serializer** -- :class:`IssueCreateSerializer`. The only
  orchestrator in this module; performs multi-table writes via
  ``IssueAssignee`` and ``IssueLabel`` ``bulk_create`` and is the upstream
  point for downstream issue-activity Celery tasks (Celery via RabbitMQ --
  Redis is caching/session only).

These serializers feed endpoints mounted under ``api/public/`` and serve
anonymous traffic for published boards; the read-only / write-only field
choices reflect that security boundary.
"""

# Django imports
from django.utils import timezone

# Third Party imports
from rest_framework import serializers

# Module imports
from .base import BaseSerializer
from .user import UserLiteSerializer
from .state import StateSerializer, StateLiteSerializer
from .project import ProjectLiteSerializer
from .cycle import CycleBaseSerializer
from .module import ModuleBaseSerializer
from .workspace import WorkspaceLiteSerializer
from plane.db.models import (
    User,
    Issue,
    IssueComment,
    IssueAssignee,
    IssueLabel,
    Label,
    CycleIssue,
    ModuleIssue,
    IssueLink,
    FileAsset,
    IssueReaction,
    CommentReaction,
    IssueVote,
    IssueRelation,
)
from plane.utils.content_validator import (
    validate_html_content,
    validate_binary_data,
)


class IssueStateFlatSerializer(BaseSerializer):
    """Compact ``Issue`` projection enriched with state + project lite details.

    Lite shape used inside parent/sub-issue payloads to display issue identity
    (``id``, ``sequence_id``, ``name``) without fetching the full
    :class:`IssueSerializer` payload. The nested ``state_detail`` and
    ``project_detail`` are read-only projections sourced from the underlying
    ``state`` and ``project`` foreign keys.
    """

    state_detail = StateLiteSerializer(read_only=True, source="state")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")

    class Meta:
        """Bind to ``Issue`` exposing only the lite identity projection."""

        model = Issue
        fields = ["id", "sequence_id", "name", "state_detail", "project_detail"]


class LabelSerializer(BaseSerializer):
    """Full ``Label`` payload with workspace + project lite details.

    Used for label CRUD on labels endpoints. ``workspace`` and ``project``
    are write-protected via ``read_only_fields`` so clients cannot change
    ownership of an existing label; ``workspace_detail`` and
    ``project_detail`` are read-only nested projections for response
    composition.
    """

    workspace_detail = WorkspaceLiteSerializer(source="workspace", read_only=True)
    project_detail = ProjectLiteSerializer(source="project", read_only=True)

    class Meta:
        """Bind to ``Label`` with ``workspace``/``project`` write-protected."""

        model = Label
        fields = "__all__"
        read_only_fields = ["workspace", "project"]


class IssueProjectLiteSerializer(BaseSerializer):
    """Compact ``Issue`` projection used inside issue-relation responses.

    All fields (``id``, ``project_detail``, ``name``, ``sequence_id``) are
    read-only (``read_only_fields = fields``). Used by
    :class:`IssueRelationSerializer` and :class:`RelatedIssueSerializer` to
    inline issue identity inside relation rows without triggering N+1
    fetches against the parent ``Issue`` model.
    """

    project_detail = ProjectLiteSerializer(source="project", read_only=True)

    class Meta:
        """Bind to ``Issue`` as a fully read-only lite projection."""

        model = Issue
        fields = ["id", "project_detail", "name", "sequence_id"]
        read_only_fields = fields


class IssueRelationSerializer(BaseSerializer):
    """Outgoing-relation row from a parent ``Issue`` to a related ``Issue``.

    ``issue_detail`` is sourced from ``related_issue`` -- i.e., it surfaces
    the *destination* (related) issue of the relation. Pair this with
    :class:`RelatedIssueSerializer` (which surfaces the *source* side) so a
    consumer can browse both directions of a relation without ambiguity.
    ``workspace`` and ``project`` are write-protected (scoped via URL path).
    """

    issue_detail = IssueProjectLiteSerializer(read_only=True, source="related_issue")

    class Meta:
        """Bind to ``IssueRelation`` for the outgoing-relation row shape."""

        model = IssueRelation
        fields = ["issue_detail", "relation_type", "related_issue", "issue", "id"]
        read_only_fields = ["workspace", "project"]


class RelatedIssueSerializer(BaseSerializer):
    """Incoming-relation row pointing back to the source ``Issue``.

    Despite sharing the same model and field list as
    :class:`IssueRelationSerializer`, ``issue_detail`` here is sourced from
    ``issue`` (the *source* side of the relation) rather than
    ``related_issue``. The two serializers coexist so a consumer browsing
    the inverse direction sees the originating issue's identity instead of
    the destination's -- without this distinction the relation graph would
    appear ambiguous to readers of the API.
    """

    issue_detail = IssueProjectLiteSerializer(read_only=True, source="issue")

    class Meta:
        """Bind to ``IssueRelation`` for the incoming-relation row shape."""

        model = IssueRelation
        fields = ["issue_detail", "relation_type", "related_issue", "issue", "id"]
        read_only_fields = ["workspace", "project"]


class IssueCycleDetailSerializer(BaseSerializer):
    """``CycleIssue`` membership row enriched with the parent ``Cycle`` payload.

    Used inside :attr:`IssueSerializer.issue_cycle` to surface cycle
    metadata alongside an issue. The standard audit fields (``workspace``,
    ``project``, ``created_by``, ``updated_by``, ``created_at``,
    ``updated_at``) are read-only; ``cycle_detail`` is a read-only nested
    projection sourced from the ``cycle`` foreign key.
    """

    cycle_detail = CycleBaseSerializer(read_only=True, source="cycle")

    class Meta:
        """Bind to ``CycleIssue`` with audit fields write-protected."""

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


class IssueModuleDetailSerializer(BaseSerializer):
    """``ModuleIssue`` membership row enriched with the parent ``Module`` payload.

    Used inside :attr:`IssueSerializer.issue_module` to surface module
    metadata alongside an issue. Mirrors :class:`IssueCycleDetailSerializer`
    in shape and read-only fields but is scoped to module memberships;
    ``module_detail`` is a read-only nested projection sourced from the
    ``module`` foreign key.
    """

    module_detail = ModuleBaseSerializer(read_only=True, source="module")

    class Meta:
        """Bind to ``ModuleIssue`` with audit fields write-protected."""

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
    """Full ``IssueLink`` payload with the creator's lite user projection.

    ``issue`` is write-protected at the serializer level because a link is
    scoped to its parent issue via the URL path, not the request body; the
    standard audit fields are likewise read-only. ``created_by_detail`` is
    a nested :class:`UserLiteSerializer` for response composition. The
    :meth:`create` override enforces URL uniqueness within an issue (see
    method docstring).
    """

    created_by_detail = UserLiteSerializer(read_only=True, source="created_by")

    class Meta:
        """Bind to ``IssueLink`` with audit fields and parent ``issue`` write-protected."""

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

    # Validation if url already exists
    def create(self, validated_data):
        """Create an ``IssueLink`` after enforcing URL uniqueness within the parent issue.

        Prevents duplicate citation rows on the same issue, which would
        clutter a published board with redundant links. Raises
        :class:`rest_framework.serializers.ValidationError` with payload
        ``{"error": "URL already exists for this Issue"}`` when a row with
        the same ``url`` and ``issue_id`` already exists; otherwise
        delegates to ``IssueLink.objects.create(**validated_data)``.
        """
        if IssueLink.objects.filter(url=validated_data.get("url"), issue_id=validated_data.get("issue_id")).exists():
            raise serializers.ValidationError({"error": "URL already exists for this Issue"})
        return IssueLink.objects.create(**validated_data)


class IssueAttachmentSerializer(BaseSerializer):
    """Full ``FileAsset`` payload restricted to issue-scoped attachments.

    Serializes the generic ``FileAsset`` model with a stricter read-only
    contour appropriate for issue-attachment endpoints: ``issue`` and the
    standard audit fields are write-protected so clients cannot re-parent
    an existing asset onto a different issue via this serializer.
    """

    class Meta:
        """Bind to ``FileAsset`` with audit fields and parent ``issue`` write-protected."""

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


class IssueReactionSerializer(BaseSerializer):
    """``IssueReaction`` row scoped to issue + actor.

    Only ``reaction`` (the emoji code) is writable; ``workspace``,
    ``project``, ``issue``, and ``actor`` are populated server-side from
    the URL path (issue/workspace/project) and the authenticated request
    (actor), never from the request body.
    """

    class Meta:
        """Bind to ``IssueReaction`` exposing only ``reaction`` as writable."""

        model = IssueReaction
        fields = ["issue", "reaction", "workspace", "project", "actor"]
        read_only_fields = ["workspace", "project", "issue", "actor"]


class IssueSerializer(BaseSerializer):
    """Full ``Issue`` read payload aggregating nested relations and child collections in one response.

    The "godfather" read serializer for issue detail responses on published
    boards; collapses state, project, parent, labels, assignees, relations,
    cycle/module memberships, links, attachments, and reactions into a
    single payload so the public-board UI can render an issue detail
    without firing additional sub-requests.

    Read-only audit fields: ``workspace``, ``project``, ``created_by``,
    ``updated_by``, ``created_at``, ``updated_at``.

    Read-only nested / computed projections (populated by the view queryset
    via ``annotate`` / ``prefetch_related``):

    * ``project_detail`` -- :class:`ProjectLiteSerializer`
      (sourced from ``project``).
    * ``state_detail`` -- :class:`StateSerializer` (sourced from ``state``).
    * ``parent_detail`` -- :class:`IssueStateFlatSerializer`
      (sourced from ``parent``).
    * ``label_details`` -- :class:`LabelSerializer` many=True
      (sourced from ``labels``).
    * ``assignee_details`` -- :class:`UserLiteSerializer` many=True
      (sourced from ``assignees``).
    * ``related_issues`` -- :class:`IssueRelationSerializer` many=True
      (sourced from ``issue_relation`` -- outgoing relations).
    * ``issue_relations`` -- :class:`RelatedIssueSerializer` many=True
      (sourced from ``issue_related`` -- incoming relations).
    * ``issue_cycle`` -- :class:`IssueCycleDetailSerializer`.
    * ``issue_module`` -- :class:`IssueModuleDetailSerializer`.
    * ``issue_link`` -- :class:`IssueLinkSerializer` many=True.
    * ``issue_attachment`` -- :class:`IssueAttachmentSerializer` many=True.
    * ``sub_issues_count`` -- ``IntegerField`` annotated by the view
      queryset.
    * ``issue_reactions`` -- :class:`IssueReactionSerializer` many=True.
    """

    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    state_detail = StateSerializer(read_only=True, source="state")
    parent_detail = IssueStateFlatSerializer(read_only=True, source="parent")
    label_details = LabelSerializer(read_only=True, source="labels", many=True)
    assignee_details = UserLiteSerializer(read_only=True, source="assignees", many=True)
    related_issues = IssueRelationSerializer(read_only=True, source="issue_relation", many=True)
    issue_relations = RelatedIssueSerializer(read_only=True, source="issue_related", many=True)
    issue_cycle = IssueCycleDetailSerializer(read_only=True)
    issue_module = IssueModuleDetailSerializer(read_only=True)
    issue_link = IssueLinkSerializer(read_only=True, many=True)
    issue_attachment = IssueAttachmentSerializer(read_only=True, many=True)
    sub_issues_count = serializers.IntegerField(read_only=True)
    issue_reactions = IssueReactionSerializer(read_only=True, many=True)

    class Meta:
        """Bind to ``Issue`` for the full read payload with audit fields write-protected."""

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


class IssueFlatSerializer(BaseSerializer):
    """Flat ``Issue`` projection -- no nested relations, no computed counts.

    Used by intake nested projections and other contexts where an issue's
    identity (``id``, ``sequence_id``, ``name``), description, scheduling
    (``start_date``, ``target_date``), priority, sort order, and draft
    state are needed but nested relation serializers would be too heavy.
    """

    ## Contain only flat fields

    class Meta:
        """Bind to ``Issue`` exposing only flat identity/scheduling/description fields."""

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


class CommentReactionLiteSerializer(BaseSerializer):
    """Compact ``CommentReaction`` projection with the actor's lite user projection.

    Used inside :attr:`IssueCommentSerializer.comment_reactions` to inline
    reactions in comment responses. ``actor_detail`` is sourced from the
    ``actor`` foreign key as a read-only :class:`UserLiteSerializer`.
    """

    actor_detail = UserLiteSerializer(read_only=True, source="actor")

    class Meta:
        """Bind to ``CommentReaction`` for the compact nested projection."""

        model = CommentReaction
        fields = ["id", "reaction", "comment", "actor_detail"]


class IssueCommentSerializer(BaseSerializer):
    """Full ``IssueComment`` payload with nested actor/issue/project/workspace/reactions.

    Read-only audit fields plus ``issue`` are write-protected (the comment
    is scoped to its parent issue via the URL path). The nested read-only
    projections (``actor_detail``, ``issue_detail``, ``project_detail``,
    ``workspace_detail``, ``comment_reactions``) are populated from the
    underlying foreign keys / reverse relations.

    The computed read-only field ``is_member`` is a ``BooleanField``
    annotated by the view queryset (not computed in the serializer) to
    indicate whether the comment author is currently a member of the
    workspace -- used by the public-board UI to badge comments from
    non-members.
    """

    actor_detail = UserLiteSerializer(read_only=True, source="actor")
    issue_detail = IssueFlatSerializer(read_only=True, source="issue")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    workspace_detail = WorkspaceLiteSerializer(read_only=True, source="workspace")
    comment_reactions = CommentReactionLiteSerializer(read_only=True, many=True)
    is_member = serializers.BooleanField(read_only=True)

    class Meta:
        """Bind to ``IssueComment`` with audit fields and parent ``issue`` write-protected."""

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


##TODO: Find a better way to write this serializer
## Find a better approach to save manytomany?
class IssueCreateSerializer(BaseSerializer):
    """Write-oriented ``Issue`` serializer that orchestrates assignees, labels, and default-assignee fallback.

    The only orchestration boundary in this module: pairs the scalar issue
    fields with relation writes (``IssueAssignee``, ``IssueLabel``) in a
    single ``save()`` call so the view does not need to coordinate multiple
    model writes for an intake submission. Read-only audit fields are
    ``workspace``, ``project``, ``created_by``, ``updated_by``,
    ``created_at``, ``updated_at``.

    Write-only fields (id lists materialized by :meth:`create` /
    :meth:`update` into relation rows):

    * ``assignees`` -- ``ListField`` of ``User`` PK references; becomes
      ``IssueAssignee`` rows.
    * ``labels`` -- ``ListField`` of ``Label`` PK references; becomes
      ``IssueLabel`` rows.

    Read-only nested projections (composed for response shape):

    * ``state_detail`` -- :class:`StateSerializer` (sourced from ``state``).
    * ``created_by_detail`` -- :class:`UserLiteSerializer`
      (sourced from ``created_by``).
    * ``project_detail`` -- :class:`ProjectLiteSerializer`
      (sourced from ``project``).
    * ``workspace_detail`` -- :class:`WorkspaceLiteSerializer`
      (sourced from ``workspace``).

    Required ``self.context`` keys (populated by the view layer before
    calling ``serializer.save()``):

    * ``project_id`` -- scopes the new ``Issue`` row.
    * ``workspace_id`` -- scopes the ``IssueAssignee`` / ``IssueLabel``
      rows.
    * ``default_assignee_id`` -- optional fallback used when ``assignees``
      is empty/missing on create.

    Downstream ``issue_activity`` events are enqueued by the view layer
    (Celery via RabbitMQ -- *not* this serializer; Redis is caching /
    session only) after ``serializer.save()`` returns.
    """

    state_detail = StateSerializer(read_only=True, source="state")
    created_by_detail = UserLiteSerializer(read_only=True, source="created_by")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    workspace_detail = WorkspaceLiteSerializer(read_only=True, source="workspace")

    assignees = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=User.objects.all()),
        write_only=True,
        required=False,
    )

    labels = serializers.ListField(
        child=serializers.PrimaryKeyRelatedField(queryset=Label.objects.all()),
        write_only=True,
        required=False,
    )

    class Meta:
        """Bind to ``Issue`` for the write surface with audit fields write-protected."""

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
        """Serialize an ``Issue`` for response, surfacing assignees/labels as id lists.

        The model exposes ``assignees`` and ``labels`` as M2M managers,
        but the serializer's *input* form takes flat UUID lists; this
        override symmetrizes the *response* shape with the input shape so
        clients can round-trip the same payload (read -> edit -> write)
        without rebuilding the assignee/label collections.

        Extends the base ``to_representation`` output by replacing the
        ``assignees`` and ``labels`` keys with lists of stringified UUIDs
        drawn from ``instance.assignees.all()`` and ``instance.labels.all()``.
        """
        data = super().to_representation(instance)
        data["assignees"] = [str(assignee.id) for assignee in instance.assignees.all()]
        data["labels"] = [str(label.id) for label in instance.labels.all()]
        return data

    def validate(self, data):
        """Enforce start/target date ordering and sanitize description content.

        Validation rules:

        * ``start_date > target_date`` raises ``ValidationError("Start date
          cannot exceed target date")``.
        * ``description_html`` is run through ``validate_html_content``
          (nh3 sanitizer). Failure raises
          ``ValidationError({"error": "html content is not valid"})``;
          on success, ``data["description_html"]`` is replaced with the
          sanitized output when the sanitizer rewrote content.
        * ``description_binary`` is run through ``validate_binary_data``
          (size + format + suspicious-pattern checks). Failure raises
          ``ValidationError({"description_binary": "Invalid binary data"})``.

        HTML sanitization protects published boards from stored XSS via
        unauthenticated submission paths; binary validation protects
        against oversized or malformed Y.js / ProseMirror payloads landing
        in the database.
        """
        if (
            data.get("start_date", None) is not None
            and data.get("target_date", None) is not None
            and data.get("start_date", None) > data.get("target_date", None)
        ):
            raise serializers.ValidationError("Start date cannot exceed target date")

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

    def create(self, validated_data):
        """Create an ``Issue`` and synchronize ``IssueAssignee`` + ``IssueLabel`` rows in one save.

        Required ``self.context`` keys:

        * ``project_id`` -- scopes the new ``Issue``.
        * ``workspace_id`` -- scopes the new ``IssueAssignee`` /
          ``IssueLabel`` rows.
        * ``default_assignee_id`` -- optional; when ``assignees`` is empty
          or missing the issue is assigned to this user as a fallback so
          intake submissions are never left ownerless.

        Side effects:

        * ``Issue.objects.create(...)`` -- the parent row scoped to
          ``project_id``.
        * ``IssueAssignee.objects.bulk_create(..., batch_size=10)`` --
          assignee rows (or a single default-assignee row when no explicit
          assignees were supplied).
        * ``IssueLabel.objects.bulk_create(..., batch_size=10)`` -- label
          rows.

        Batched ``bulk_create`` avoids one INSERT per row when
        bulk-assigning many members or labels at once. Downstream
        ``issue_activity`` events for the new issue are enqueued by the
        *view layer* (Celery via RabbitMQ -- not this serializer) after
        ``serializer.save()`` returns.
        """
        assignees = validated_data.pop("assignees", None)
        labels = validated_data.pop("labels", None)

        project_id = self.context["project_id"]
        workspace_id = self.context["workspace_id"]
        default_assignee_id = self.context["default_assignee_id"]

        issue = Issue.objects.create(**validated_data, project_id=project_id)

        # Issue Audit Users
        created_by_id = issue.created_by_id
        updated_by_id = issue.updated_by_id

        if assignees is not None and len(assignees):
            IssueAssignee.objects.bulk_create(
                [
                    IssueAssignee(
                        assignee=user,
                        issue=issue,
                        project_id=project_id,
                        workspace_id=workspace_id,
                        created_by_id=created_by_id,
                        updated_by_id=updated_by_id,
                    )
                    for user in assignees
                ],
                batch_size=10,
            )
        else:
            # Then assign it to default assignee
            if default_assignee_id is not None:
                IssueAssignee.objects.create(
                    assignee_id=default_assignee_id,
                    issue=issue,
                    project_id=project_id,
                    workspace_id=workspace_id,
                    created_by_id=created_by_id,
                    updated_by_id=updated_by_id,
                )

        if labels is not None and len(labels):
            IssueLabel.objects.bulk_create(
                [
                    IssueLabel(
                        label=label,
                        issue=issue,
                        project_id=project_id,
                        workspace_id=workspace_id,
                        created_by_id=created_by_id,
                        updated_by_id=updated_by_id,
                    )
                    for label in labels
                ],
                batch_size=10,
            )

        return issue

    def update(self, instance, validated_data):
        """Update an ``Issue`` and re-synchronize ``IssueAssignee`` + ``IssueLabel`` rows.

        Side effects:

        * When ``assignees`` is provided in the request, delete all
          existing ``IssueAssignee`` rows for this issue and re-create
          them from the request list (``bulk_create`` batched at 10).
        * When ``labels`` is provided in the request, delete all existing
          ``IssueLabel`` rows for this issue and re-create them from the
          request list (``bulk_create`` batched at 10).
        * Set ``instance.updated_at = timezone.now()`` -- explicitly bumps
          the audit timestamp.
        * Delegate scalar field persistence to ``super().update(...)``.

        The explicit ``updated_at`` bump covers a non-obvious gap: when
        *only* relations change (assignees/labels) and no scalar issue
        field is modified, Django's ``auto_now`` would not advance
        ``updated_at`` because the underlying ``save()`` would be a no-op
        for an otherwise-unchanged instance. Marking the issue dirty here
        signals downstream consumers (Celery activity tasks, MobX store
        invalidation on the frontend, cache busters) that the issue has
        changed -- see the canonical inline comment "Time updation occues
        even when other related models are updated" preserved below.
        """
        assignees = validated_data.pop("assignees", None)
        labels = validated_data.pop("labels", None)

        # Related models
        project_id = instance.project_id
        workspace_id = instance.workspace_id
        created_by_id = instance.created_by_id
        updated_by_id = instance.updated_by_id

        if assignees is not None:
            IssueAssignee.objects.filter(issue=instance).delete()
            IssueAssignee.objects.bulk_create(
                [
                    IssueAssignee(
                        assignee=user,
                        issue=instance,
                        project_id=project_id,
                        workspace_id=workspace_id,
                        created_by_id=created_by_id,
                        updated_by_id=updated_by_id,
                    )
                    for user in assignees
                ],
                batch_size=10,
            )

        if labels is not None:
            IssueLabel.objects.filter(issue=instance).delete()
            IssueLabel.objects.bulk_create(
                [
                    IssueLabel(
                        label=label,
                        issue=instance,
                        project_id=project_id,
                        workspace_id=workspace_id,
                        created_by_id=created_by_id,
                        updated_by_id=updated_by_id,
                    )
                    for label in labels
                ],
                batch_size=10,
            )

        # Time updation occues even when other related models are updated
        instance.updated_at = timezone.now()
        return super().update(instance, validated_data)


class CommentReactionSerializer(BaseSerializer):
    """Full ``CommentReaction`` payload for comment-reaction CRUD endpoints.

    Only ``reaction`` is writable -- the comment is scoped via the URL
    path and the actor is the authenticated user; ``workspace``,
    ``project``, ``comment``, and ``actor`` are write-protected so a
    client cannot re-target a reaction at a different comment or actor.
    """

    class Meta:
        """Bind to ``CommentReaction`` exposing only ``reaction`` as writable."""

        model = CommentReaction
        fields = "__all__"
        read_only_fields = ["workspace", "project", "comment", "actor"]


class IssueVoteSerializer(BaseSerializer):
    """``IssueVote`` row exposing the actor + issue + vote direction (all read-only).

    Every field is in ``read_only_fields`` because vote rows are created
    by the view layer directly (``IssueVote.objects.create(...)`` /
    ``filter().delete()``), not through serializer ``create`` / ``update``
    -- this serializer's job is purely response shaping for upvote /
    downvote listings.
    """

    class Meta:
        """Bind to ``IssueVote`` exposing every field as read-only (response shaping only)."""

        model = IssueVote
        fields = ["issue", "vote", "workspace", "project", "actor"]
        read_only_fields = fields


class IssuePublicSerializer(BaseSerializer):
    """Projected ``Issue`` payload safe for anonymous traffic on published deploy boards.

    Every field is in ``read_only_fields`` (``read_only_fields = fields``)
    because this serializer is only used for anonymous reads of published
    boards. The field selection is deliberately narrow to avoid leaking
    workspace-internal data (member names, label colors, module names) to
    unauthenticated viewers; the inline ``module_ids``, ``label_ids``, and
    ``assignee_ids`` are populated by the view queryset as lists of UUIDs
    rather than nested objects so the public surface never exposes the
    related user/label/module records themselves -- a security-driven
    choice, not an oversight.

    Nested read-only projections:

    * ``reactions`` -- :class:`IssueReactionSerializer` many=True (sourced
      from ``issue_reactions``).
    * ``votes`` -- :class:`IssueVoteSerializer` many=True.
    * ``module_ids`` / ``label_ids`` / ``assignee_ids`` -- ``ListField``
      of ``UUIDField`` annotated by the view queryset.
    """

    reactions = IssueReactionSerializer(read_only=True, many=True, source="issue_reactions")
    votes = IssueVoteSerializer(read_only=True, many=True)
    module_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    label_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    assignee_ids = serializers.ListField(child=serializers.UUIDField(), required=False)

    class Meta:
        """Bind to ``Issue`` exposing only the public-board-safe field projection."""

        model = Issue
        fields = [
            "id",
            "name",
            "sequence_id",
            "state",
            "project",
            "workspace",
            "priority",
            "target_date",
            "reactions",
            "votes",
            "module_ids",
            "created_by",
            "label_ids",
            "assignee_ids",
        ]
        read_only_fields = fields


class LabelLiteSerializer(BaseSerializer):
    """Compact ``Label`` projection (id, name, color) for nested issue/comment responses.

    Kept lite to avoid bringing workspace/project foreign-key objects into
    nested issue payloads -- callers that need label ownership metadata
    use :class:`LabelSerializer` instead.
    """

    class Meta:
        """Bind to ``Label`` exposing only ``id``/``name``/``color`` for nested responses."""

        model = Label
        fields = ["id", "name", "color"]
