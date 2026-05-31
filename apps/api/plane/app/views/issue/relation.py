# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Issue-to-issue relationship graph HTTP endpoints.

Exposes :class:`IssueRelationViewSet` which manages the directed graph
of relationships between issues. Eight relation types are supported:

* ``blocking`` / ``blocked_by`` -- one issue is blocked until another
  is resolved. Stored as a single :class:`IssueRelation` row with
  ``relation_type='blocked_by'``; the inverse direction is synthesized
  on read.
* ``duplicate`` -- two issues describe the same work. Symmetric --
  forward and reverse rows are merged on read.
* ``relates_to`` -- generic association. Symmetric on read.
* ``start_after`` / ``start_before`` -- scheduling dependency on the
  start side.
* ``finish_after`` / ``finish_before`` -- scheduling dependency on the
  finish side.

Inverse types (``blocking``, ``start_after``, ``finish_after``) are
stored by inverting the ``(issue_id, related_issue_id)`` pair so the
database only carries the canonical direction;
:func:`plane.utils.issue_relation_mapper.get_actual_relation` performs
the mapping.

Every create / delete enqueues
``plane.bgtasks.issue_activities_task.issue_activity`` (Celery via
RabbitMQ) for the issue timeline.
"""

# Python imports
import json

# Django imports
from django.utils import timezone
from django.db.models import Q, OuterRef, F, Func, UUIDField, Value, CharField, Subquery
from django.core.serializers.json import DjangoJSONEncoder
from django.db.models.functions import Coalesce
from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField

# Third Party imports
from rest_framework.response import Response
from rest_framework import status

# Module imports
from .. import BaseViewSet
from plane.app.serializers import IssueRelationSerializer, RelatedIssueSerializer
from plane.app.permissions import ProjectEntityPermission
from plane.db.models import (
    Project,
    IssueRelation,
    Issue,
    FileAsset,
    IssueLink,
    CycleIssue,
)
from plane.bgtasks.issue_activities_task import issue_activity
from plane.utils.issue_relation_mapper import get_actual_relation
from plane.utils.host import base_host


class IssueRelationViewSet(BaseViewSet):
    """Manage the directed graph of issue-to-issue relationships.

    Eight relation types are supported: ``blocking``, ``blocked_by``,
    ``duplicate``, ``relates_to``, ``start_after``, ``start_before``,
    ``finish_after``, ``finish_before``.

    HTTP methods + URL patterns:
        GET  /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/issue-relation/
              -- action: ``list`` -- returns the relation graph
              grouped by type.
        POST /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/issue-relation/
              -- action: ``create`` -- bulk-creates relations.
        POST /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/remove-relation/
              -- action: ``remove_relation`` -- deletes one relation.

    Request body:
        - ``list``: none.
        - ``create``:
            * ``relation_type`` (str, required) -- one of ``blocking``,
              ``blocked_by``, ``duplicate``, ``relates_to``,
              ``start_after``, ``start_before``, ``finish_after``,
              ``finish_before``.
            * ``issues`` (list[UUID], required) -- the other side of
              each relation.
        - ``remove_relation``:
            * ``related_issue`` (UUID, required) -- the issue on the
              other side of the relation to delete.

    Response shape:
        - ``list``: dict keyed by relation type, each value a list of
          serialized issue dicts with fields ``id``, ``name``,
          ``state_id``, ``sort_order``, ``priority``, ``sequence_id``,
          ``project_id``, ``label_ids``, ``assignee_ids``,
          ``created_at``, ``updated_at``, ``created_by``, ``updated_by``,
          ``relation_type``.
        - ``create``: list of :class:`RelatedIssueSerializer` (when
          ``relation_type in ['blocking', 'start_after', 'finish_after']``)
          or :class:`IssueRelationSerializer` otherwise (HTTP 201).
        - ``remove_relation``: HTTP 204 empty body.

    Permissions:
        permission_classes = [ProjectEntityPermission]

    Direction flip:
        Inverse types -- ``blocking``, ``start_after``, ``finish_after``
        -- are stored as their canonical counterparts; on ``create`` the
        ``(issue_id, related_issue_id)`` pair is swapped before insert
        and ``relation_type`` is mapped via
        :func:`plane.utils.issue_relation_mapper.get_actual_relation`.

    Symmetric merge:
        For ``duplicate`` and ``relates_to``, both directions are
        merged into one bucket on read using the queryset union (``|``)
        operator.

    Side effects:
        * ``create`` ``IssueRelation.objects.bulk_create(...,
          batch_size=10, ignore_conflicts=True)`` -- duplicates within
          the batch are silently dropped.
        * Each create / delete enqueues
          ``plane.bgtasks.issue_activities_task.issue_activity`` with
          ``type="issue_relation.activity.{created|deleted}"``.
    """

    serializer_class = IssueRelationSerializer
    model = IssueRelation
    permission_classes = [ProjectEntityPermission]

    def list(self, request, slug, project_id, issue_id):
        """Return the issue's full relation graph grouped by relation type.

        Builds eight subqueries (one per relation direction), then
        annotates the master :class:`Issue` queryset (with
        ``cycle_id``, ``link_count``, ``attachment_count``,
        ``sub_issues_count``, ``label_ids``, ``assignee_ids``) and
        slices it into per-type lists. ``duplicate`` and ``relates_to``
        are unioned across both directions.
        """
        issue_relations = (
            IssueRelation.objects.filter(Q(issue_id=issue_id) | Q(related_issue=issue_id))
            .filter(workspace__slug=self.kwargs.get("slug"))
            .select_related("project")
            .select_related("workspace")
            .select_related("issue")
            .order_by("-created_at")
            .distinct()
        )
        # get all blocking issues
        blocking_issues = issue_relations.filter(relation_type="blocked_by", related_issue_id=issue_id).values_list(
            "issue_id", flat=True
        )

        # get all blocked by issues
        blocked_by_issues = issue_relations.filter(relation_type="blocked_by", issue_id=issue_id).values_list(
            "related_issue_id", flat=True
        )

        # get all duplicate issues
        duplicate_issues = issue_relations.filter(issue_id=issue_id, relation_type="duplicate").values_list(
            "related_issue_id", flat=True
        )

        # get all relates to issues
        duplicate_issues_related = issue_relations.filter(
            related_issue_id=issue_id, relation_type="duplicate"
        ).values_list("issue_id", flat=True)

        # get all relates to issues
        relates_to_issues = issue_relations.filter(issue_id=issue_id, relation_type="relates_to").values_list(
            "related_issue_id", flat=True
        )

        # get all relates to issues
        relates_to_issues_related = issue_relations.filter(
            related_issue_id=issue_id, relation_type="relates_to"
        ).values_list("issue_id", flat=True)

        # get all start after issues
        start_after_issues = issue_relations.filter(
            relation_type="start_before", related_issue_id=issue_id
        ).values_list("issue_id", flat=True)

        # get all start_before issues
        start_before_issues = issue_relations.filter(relation_type="start_before", issue_id=issue_id).values_list(
            "related_issue_id", flat=True
        )

        # get all finish after issues
        finish_after_issues = issue_relations.filter(
            relation_type="finish_before", related_issue_id=issue_id
        ).values_list("issue_id", flat=True)

        # get all finish before issues
        finish_before_issues = issue_relations.filter(relation_type="finish_before", issue_id=issue_id).values_list(
            "related_issue_id", flat=True
        )

        queryset = (
            Issue.issue_objects.filter(workspace__slug=slug)
            .select_related("workspace", "project", "state", "parent")
            .prefetch_related("assignees", "labels", "issue_module__module")
            .annotate(
                cycle_id=Subquery(
                    CycleIssue.objects.filter(issue=OuterRef("id"), deleted_at__isnull=True).values("cycle_id")[:1]
                )
            )
            .annotate(
                link_count=IssueLink.objects.filter(issue=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(
                attachment_count=FileAsset.objects.filter(
                    issue_id=OuterRef("id"),
                    entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
                )
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(
                sub_issues_count=Issue.issue_objects.filter(parent=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(
                label_ids=Coalesce(
                    ArrayAgg(
                        "labels__id",
                        distinct=True,
                        filter=Q(~Q(labels__id__isnull=True) & (Q(label_issue__deleted_at__isnull=True))),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                assignee_ids=Coalesce(
                    ArrayAgg(
                        "assignees__id",
                        distinct=True,
                        filter=Q(
                            ~Q(assignees__id__isnull=True)
                            & Q(assignees__member_project__is_active=True)
                            & Q(issue_assignee__deleted_at__isnull=True)
                        ),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
            )
        ).distinct()

        # Fields
        fields = [
            "id",
            "name",
            "state_id",
            "sort_order",
            "priority",
            "sequence_id",
            "project_id",
            "label_ids",
            "assignee_ids",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
            "relation_type",
        ]

        response_data = {
            "blocking": queryset.filter(pk__in=blocking_issues)
            .annotate(relation_type=Value("blocking", output_field=CharField()))
            .values(*fields),
            "blocked_by": queryset.filter(pk__in=blocked_by_issues)
            .annotate(relation_type=Value("blocked_by", output_field=CharField()))
            .values(*fields),
            "duplicate": queryset.filter(pk__in=duplicate_issues)
            .annotate(relation_type=Value("duplicate", output_field=CharField()))
            .values(*fields)
            | queryset.filter(pk__in=duplicate_issues_related)
            .annotate(relation_type=Value("duplicate", output_field=CharField()))
            .values(*fields),
            "relates_to": queryset.filter(pk__in=relates_to_issues)
            .annotate(relation_type=Value("relates_to", output_field=CharField()))
            .values(*fields)
            | queryset.filter(pk__in=relates_to_issues_related)
            .annotate(relation_type=Value("relates_to", output_field=CharField()))
            .values(*fields),
            "start_after": queryset.filter(pk__in=start_after_issues)
            .annotate(relation_type=Value("start_after", output_field=CharField()))
            .values(*fields),
            "start_before": queryset.filter(pk__in=start_before_issues)
            .annotate(relation_type=Value("start_before", output_field=CharField()))
            .values(*fields),
            "finish_after": queryset.filter(pk__in=finish_after_issues)
            .annotate(relation_type=Value("finish_after", output_field=CharField()))
            .values(*fields),
            "finish_before": queryset.filter(pk__in=finish_before_issues)
            .annotate(relation_type=Value("finish_before", output_field=CharField()))
            .values(*fields),
        }

        return Response(response_data, status=status.HTTP_200_OK)

    def create(self, request, slug, project_id, issue_id):
        """Bulk-create relations of ``relation_type`` between this issue and each id in ``issues``.

        For inverse types (``blocking``, ``start_after``,
        ``finish_after``) the ``(issue_id, related_issue_id)`` pair is
        swapped before insert and ``relation_type`` is mapped via
        :func:`get_actual_relation` so only the canonical direction is
        stored. Returns HTTP 400 if ``relation_type`` is missing.
        """
        relation_type = request.data.get("relation_type", None)
        if relation_type is None:
            return Response(
                {"message": "Issue relation type is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        issues = request.data.get("issues", [])
        project = Project.objects.get(pk=project_id)

        issue_relation = IssueRelation.objects.bulk_create(
            [
                IssueRelation(
                    issue_id=(issue if relation_type in ["blocking", "start_after", "finish_after"] else issue_id),
                    related_issue_id=(
                        issue_id if relation_type in ["blocking", "start_after", "finish_after"] else issue
                    ),
                    relation_type=(get_actual_relation(relation_type)),
                    project_id=project_id,
                    workspace_id=project.workspace_id,
                    created_by=request.user,
                    updated_by=request.user,
                )
                for issue in issues
            ],
            batch_size=10,
            ignore_conflicts=True,
        )

        issue_activity.delay(
            type="issue_relation.activity.created",
            requested_data=json.dumps(request.data, cls=DjangoJSONEncoder),
            actor_id=str(request.user.id),
            issue_id=str(issue_id),
            project_id=str(project_id),
            current_instance=None,
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )

        if relation_type in ["blocking", "start_after", "finish_after"]:
            return Response(
                RelatedIssueSerializer(issue_relation, many=True).data,
                status=status.HTTP_201_CREATED,
            )
        else:
            return Response(
                IssueRelationSerializer(issue_relation, many=True).data,
                status=status.HTTP_201_CREATED,
            )

    def remove_relation(self, request, slug, project_id, issue_id):
        """Delete the matching :class:`IssueRelation` row and enqueue a delete activity.

        Matches the relation in either direction; enqueues
        ``issue_relation.activity.deleted`` as a Celery task.
        """
        related_issue = request.data.get("related_issue", None)

        issue_relations = IssueRelation.objects.filter(
            workspace__slug=slug,
        ).filter(
            Q(issue_id=related_issue, related_issue_id=issue_id) | Q(issue_id=issue_id, related_issue_id=related_issue)
        )
        issue_relations = issue_relations.first()
        current_instance = json.dumps(IssueRelationSerializer(issue_relations).data, cls=DjangoJSONEncoder)
        issue_relations.delete()
        issue_activity.delay(
            type="issue_relation.activity.deleted",
            requested_data=json.dumps(request.data, cls=DjangoJSONEncoder),
            actor_id=str(request.user.id),
            issue_id=str(issue_id),
            project_id=str(project_id),
            current_instance=current_instance,
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
