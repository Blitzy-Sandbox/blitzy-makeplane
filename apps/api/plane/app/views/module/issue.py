# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Module-to-issue membership HTTP endpoint for project modules.

Defines :class:`ModuleIssueViewSet`, the DRF ``ModelViewSet`` subclass
managing the :class:`plane.db.models.ModuleIssue` junction model that
links :class:`plane.db.models.Issue` rows to a parent
:class:`plane.db.models.Module`. Mounted at four URL patterns:

* ``GET    /api/workspaces/<slug>/projects/<project_id>/modules/<module_id>/issues/``
  -- list issues in the module.
* ``POST   /api/workspaces/<slug>/projects/<project_id>/modules/<module_id>/issues/``
  -- bulk-add issues to the module (``create_module_issues``).
* ``POST   /api/workspaces/<slug>/projects/<project_id>/issues/<issue_id>/modules/``
  -- bidirectional: add an issue to multiple modules and/or remove an
  issue from multiple modules (``create_issue_modules``).
* ``DELETE /api/workspaces/<slug>/projects/<project_id>/modules/<module_id>/issues/<issue_id>/``
  -- remove a single issue from the module.

Invariant: an issue MAY belong to MULTIPLE modules simultaneously (unlike
the cycle-issue relationship which enforces single-cycle membership).
``bulk_create([...], ignore_conflicts=True)`` silently skips duplicate
``(module_id, issue_id)`` pairs rather than moving them, supporting this
many-to-many semantic.

Mutations queue ``issue_activity`` Celery tasks (RabbitMQ-backed) for
audit logging with ``module.activity.created`` / ``module.activity.deleted``
event types. The ``list`` handler is gzip-compressed and supports
filter-by-labels/assignees, ordering, group_by, and sub_group_by with
grouped pagination via
:class:`plane.utils.paginator.GroupedOffsetPaginator` /
:class:`plane.utils.paginator.SubGroupedOffsetPaginator`.
"""

# Python imports
import copy
import json

from django.db.models import F, Func, OuterRef, Q, Subquery

# Django Imports
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.gzip import gzip_page

# Third party imports
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import allow_permission, ROLE
from plane.app.serializers import ModuleIssueSerializer
from plane.bgtasks.issue_activities_task import issue_activity
from plane.db.models import (
    Issue,
    FileAsset,
    IssueLink,
    ModuleIssue,
    Project,
    CycleIssue,
)
from plane.utils.grouper import (
    issue_group_values,
    issue_on_results,
    issue_queryset_grouper,
)
from plane.utils.issue_filters import issue_filters
from plane.utils.order_queryset import order_issue_queryset
from plane.utils.paginator import GroupedOffsetPaginator, SubGroupedOffsetPaginator
from plane.utils.filters import ComplexFilterBackend
from plane.utils.filters import IssueFilterSet
from .. import BaseViewSet
from plane.utils.host import base_host


class ModuleIssueViewSet(BaseViewSet):
    """Manage the many-to-many module-issue membership for a project module.

    Resource managed:
        :class:`plane.db.models.ModuleIssue` -- the junction table that
        links issues to modules. An issue may belong to MULTIPLE modules
        simultaneously (unlike CycleIssue which is many-to-one); soft
        deletes via ``deleted_at`` are used so historical activity
        events can still resolve the module name.

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<project_id>/modules/<uuid:module_id>/issues/
               -- list issues currently in the module, with grouping/sub-grouping
               and gzip compression. Action: ``list``.
        POST   /api/workspaces/<slug>/projects/<project_id>/modules/<uuid:module_id>/issues/
               -- bulk add issues into the module. Action: ``create_module_issues``.
        POST   /api/workspaces/<slug>/projects/<project_id>/issues/<uuid:issue_id>/modules/
               -- bulk add or remove modules from a single issue.
               Action: ``create_issue_modules``.
        DELETE /api/workspaces/<slug>/projects/<project_id>/modules/<uuid:module_id>/issues/<uuid:issue_id>/
               -- remove a single issue from the module. Action: ``destroy``.

        The URL conf also wires ``retrieve`` / ``update`` / ``partial_update``
        on the ``/modules/<module_id>/issues/<issue_id>/`` path, but this
        class does NOT override those methods -- they fall through to the
        DRF ``ModelViewSet`` defaults inherited from
        :class:`plane.app.views.base.BaseViewSet`.

    Request body (POST ``create_module_issues``):
        issues (list[UUID], required): the issue UUIDs to add to the
            URL module. Duplicate ``(module_id, issue_id)`` pairs are
            silently skipped via ``ignore_conflicts=True``.

    Request body (POST ``create_issue_modules``):
        modules (list[UUID], optional): module UUIDs to add the URL
            issue to. Each new membership is created via bulk_create
            with ``ignore_conflicts=True``.
        removed_modules (list[UUID], optional): module UUIDs to remove
            the URL issue from. Each removal soft-deletes the matching
            ``ModuleIssue`` row via ``.delete()`` (model's overridden
            soft delete).

    Response shape (GET list):
        Paginated payload from
        :class:`plane.utils.paginator.GroupedOffsetPaginator` (when
        ``group_by`` is present), or
        :class:`plane.utils.paginator.SubGroupedOffsetPaginator` (when
        both ``group_by`` and ``sub_group_by`` are present), or the
        default offset paginator otherwise. Each issue row carries
        annotations: ``cycle_id`` (the issue's current cycle, if any),
        ``link_count``, ``attachment_count``, ``sub_issues_count``, and
        prefetched ``assignees`` / ``labels`` / ``issue_module__module``.

        Query parameters:
            * ``order_by`` -- default ``-created_at``; forwarded to
              :func:`plane.utils.order_queryset.order_issue_queryset`.
            * ``group_by`` -- field to group rows by (e.g. ``state``,
              ``assignees``, ``labels``).
            * ``sub_group_by`` -- secondary grouping field. Must differ
              from ``group_by`` or HTTP 400 is returned.
            * standard issue filters from
              :func:`plane.utils.issue_filters.issue_filters` (legacy)
              and ``ComplexFilterBackend`` / ``IssueFilterSet`` (new).

    Response shape (POST ``create_module_issues``):
        ``{"message": "success"}`` with HTTP 201.

    Response shape (POST ``create_issue_modules``):
        ``{"message": "success"}`` with HTTP 201.

    Response shape (DELETE):
        Empty body with HTTP 204.

    Permissions:
        permission_classes = [IsAuthenticated]
            (inherited from :class:`plane.app.views.base.BaseViewSet`)

        Per-method via the ``@allow_permission`` decorator:
            * ``list``                  -- ROLE.ADMIN, ROLE.MEMBER
            * ``create_module_issues``  -- ROLE.ADMIN, ROLE.MEMBER
            * ``create_issue_modules``  -- ROLE.ADMIN, ROLE.MEMBER
            * ``destroy``               -- ROLE.ADMIN, ROLE.MEMBER

        GUEST role is intentionally excluded from module-issue
        membership operations because it can affect module progress
        metrics (which downstream UI / analytics consume).

    Side effects:
        * ``create_module_issues``: emits ``issue_activity.delay(
          type="module.activity.created", ...)`` for EACH added issue,
          even when bulk_create's ``ignore_conflicts=True`` silently
          skipped the row (the activity is emitted from the requested
          list, not from the actually-inserted set).
        * ``create_issue_modules``: emits ``issue_activity.delay(
          type="module.activity.created", ...)`` for each module in
          ``modules``, and ``issue_activity.delay(
          type="module.activity.deleted", ...)`` for each module in
          ``removed_modules``. The deletion activity includes the
          removed module's name in ``current_instance`` (with null
          safety via a ternary expression).
        * ``destroy``: emits ``issue_activity.delay(
          type="module.activity.deleted", ...)`` then performs a model
          ``.delete()`` (soft-delete via the ``ModuleIssue`` model's
          overridden delete behavior -- sets ``deleted_at``).

    Queryset filter logic (``get_queryset``):
        Restricts to :class:`plane.db.models.Issue` rows joined through
        the ``issue_module`` reverse relation (the ``ModuleIssue`` table)
        where:

        * ``project_id`` matches the URL kwarg.
        * ``workspace__slug`` matches the URL kwarg.
        * ``issue_module__module_id`` matches the URL kwarg.
        * ``issue_module__deleted_at IS NULL`` -- excludes
          soft-deleted ``ModuleIssue`` rows so a previously-removed
          issue does not reappear in the list view.

        ``.distinct()`` is applied because an issue with multiple
        non-deleted ``ModuleIssue`` rows for the same module would
        otherwise appear multiple times after the join. Note that the
        queryset returns Issue rows (not ModuleIssue rows) -- the
        serializer field is configured separately.

    Class attributes:
        * ``serializer_class = ModuleIssueSerializer``
        * ``model = ModuleIssue``
        * ``webhook_event = "module_issue"`` -- mutations trigger
          workspace webhook delivery (per tech spec §5.2.10) with this
          event name.
        * ``bulk = True`` -- declares this viewset accepts bulk POST
          payloads (handled in ``create_module_issues`` and
          ``create_issue_modules``).
        * ``filter_backends = (ComplexFilterBackend,)`` -- overrides the
          ``BaseViewSet`` default ``(DjangoFilterBackend, SearchFilter)``.
        * ``filterset_class = IssueFilterSet``
    """

    serializer_class = ModuleIssueSerializer
    model = ModuleIssue
    webhook_event = "module_issue"
    bulk = True
    filter_backends = (ComplexFilterBackend,)
    filterset_class = IssueFilterSet

    def apply_annotations(self, issues):
        """Annotate issue queryset with cycle/link/attachment/sub_issue counts and prefetch joins.

        Adds ``cycle_id``, ``link_count``, ``attachment_count``, and
        ``sub_issues_count`` annotations, then prefetches ``assignees``,
        ``labels``, and ``issue_module__module`` for the rendered list.
        """
        return (
            issues.annotate(
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
            .prefetch_related("assignees", "labels", "issue_module__module")
        )

    def get_queryset(self):
        """Return distinct Issue queryset for the URL module, excluding soft-deleted ModuleIssue junction rows."""
        return (
            Issue.issue_objects.filter(
                project_id=self.kwargs.get("project_id"),
                workspace__slug=self.kwargs.get("slug"),
                issue_module__module_id=self.kwargs.get("module_id"),
                issue_module__deleted_at__isnull=True,
            )
        ).distinct()

    @method_decorator(gzip_page)
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def list(self, request, slug, project_id, module_id):
        """List issues in the module with filtering, ordering, and optional grouping.

        Output is paginated and gzip-compressed; supports ``group_by`` and
        ``sub_group_by`` query parameters routed through the grouped
        offset paginator.
        """
        filters = issue_filters(request.query_params, "GET")
        issue_queryset = self.get_queryset()

        # Apply filtering from filterset
        issue_queryset = self.filter_queryset(issue_queryset)

        # Apply legacy filters
        issue_queryset = issue_queryset.filter(**filters)

        # Total count queryset
        total_issue_queryset = copy.deepcopy(issue_queryset)

        # Apply annotations to the issue queryset
        issue_queryset = self.apply_annotations(issue_queryset)

        order_by_param = request.GET.get("order_by", "created_at")

        # Issue queryset
        issue_queryset, order_by_param = order_issue_queryset(
            issue_queryset=issue_queryset, order_by_param=order_by_param
        )

        # Group by
        group_by = request.GET.get("group_by", False)
        sub_group_by = request.GET.get("sub_group_by", False)

        # issue queryset
        issue_queryset = issue_queryset_grouper(queryset=issue_queryset, group_by=group_by, sub_group_by=sub_group_by)

        if group_by:
            # Check group and sub group value paginate
            if sub_group_by:
                if group_by == sub_group_by:
                    return Response(
                        {"error": "Group by and sub group by cannot have same parameters"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                else:
                    # group and sub group pagination
                    return self.paginate(
                        request=request,
                        order_by=order_by_param,
                        queryset=issue_queryset,
                        total_count_queryset=total_issue_queryset,
                        on_results=lambda issues: issue_on_results(
                            group_by=group_by, issues=issues, sub_group_by=sub_group_by
                        ),
                        paginator_cls=SubGroupedOffsetPaginator,
                        group_by_fields=issue_group_values(
                            field=group_by,
                            slug=slug,
                            project_id=project_id,
                            filters=filters,
                            queryset=total_issue_queryset,
                        ),
                        sub_group_by_fields=issue_group_values(
                            field=sub_group_by,
                            slug=slug,
                            project_id=project_id,
                            filters=filters,
                            queryset=total_issue_queryset,
                        ),
                        group_by_field_name=group_by,
                        sub_group_by_field_name=sub_group_by,
                        count_filter=Q(
                            Q(issue_intake__status=1)
                            | Q(issue_intake__status=-1)
                            | Q(issue_intake__status=2)
                            | Q(issue_intake__isnull=True),
                            archived_at__isnull=True,
                            is_draft=False,
                        ),
                    )
            # Group Paginate
            else:
                # Group paginate
                return self.paginate(
                    request=request,
                    order_by=order_by_param,
                    queryset=issue_queryset,
                    total_count_queryset=total_issue_queryset,
                    on_results=lambda issues: issue_on_results(
                        group_by=group_by, issues=issues, sub_group_by=sub_group_by
                    ),
                    paginator_cls=GroupedOffsetPaginator,
                    group_by_fields=issue_group_values(
                        field=group_by,
                        slug=slug,
                        project_id=project_id,
                        filters=filters,
                        queryset=total_issue_queryset,
                    ),
                    group_by_field_name=group_by,
                    count_filter=Q(
                        Q(issue_intake__status=1)
                        | Q(issue_intake__status=-1)
                        | Q(issue_intake__status=2)
                        | Q(issue_intake__isnull=True),
                        archived_at__isnull=True,
                        is_draft=False,
                    ),
                )
        else:
            # List Paginate
            return self.paginate(
                order_by=order_by_param,
                request=request,
                queryset=issue_queryset,
                total_count_queryset=total_issue_queryset,
                on_results=lambda issues: issue_on_results(group_by=group_by, issues=issues, sub_group_by=sub_group_by),
            )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    # create multiple issues inside a module
    def create_module_issues(self, request, slug, project_id, module_id):
        """Bulk-add the request's ``issues`` UUIDs to the URL module.

        Duplicate ``(module_id, issue_id)`` pairs are silently skipped via
        ``ignore_conflicts=True`` (many-to-many ADD-ONLY semantic; unlike
        the cycle-issue MOVE behavior).
        """
        issues = request.data.get("issues", [])
        if not issues:
            return Response({"error": "Issues are required"}, status=status.HTTP_400_BAD_REQUEST)
        project = Project.objects.get(pk=project_id)
        _ = ModuleIssue.objects.bulk_create(
            [
                ModuleIssue(
                    issue_id=str(issue),
                    module_id=module_id,
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
        # Bulk Update the activity
        _ = [
            issue_activity.delay(
                type="module.activity.created",
                requested_data=json.dumps({"module_id": str(module_id)}),
                actor_id=str(request.user.id),
                issue_id=str(issue),
                project_id=project_id,
                current_instance=None,
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )
            for issue in issues
        ]
        return Response({"message": "success"}, status=status.HTTP_201_CREATED)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    # add multiple module inside an issue and remove multiple modules from an issue
    def create_issue_modules(self, request, slug, project_id, issue_id):
        """Bidirectionally add and remove the URL issue from multiple modules.

        Adds the issue to each UUID in ``request.data["modules"]`` and
        removes it from each UUID in ``request.data["removed_modules"]``
        in a single request, emitting per-module activity events.
        """
        modules = request.data.get("modules", [])
        removed_modules = request.data.get("removed_modules", [])
        project = Project.objects.get(pk=project_id)

        if modules:
            _ = ModuleIssue.objects.bulk_create(
                [
                    ModuleIssue(
                        issue_id=issue_id,
                        module_id=module,
                        project_id=project_id,
                        workspace_id=project.workspace_id,
                        created_by=request.user,
                        updated_by=request.user,
                    )
                    for module in modules
                ],
                batch_size=10,
                ignore_conflicts=True,
            )
            # Bulk Update the activity
            _ = [
                issue_activity.delay(
                    type="module.activity.created",
                    requested_data=json.dumps({"module_id": module}),
                    actor_id=str(request.user.id),
                    issue_id=issue_id,
                    project_id=project_id,
                    current_instance=None,
                    epoch=int(timezone.now().timestamp()),
                    notification=True,
                    origin=base_host(request=request, is_app=True),
                )
                for module in modules
            ]

        for module_id in removed_modules:
            module_issue = ModuleIssue.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                module_id=module_id,
                issue_id=issue_id,
            )
            issue_activity.delay(
                type="module.activity.deleted",
                requested_data=json.dumps({"module_id": str(module_id)}),
                actor_id=str(request.user.id),
                issue_id=str(issue_id),
                project_id=str(project_id),
                current_instance=json.dumps(
                    {
                        "module_name": (
                            module_issue.first().module.name
                            if (module_issue.first() and module_issue.first().module)
                            else None
                        )
                    }
                ),
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )
            module_issue.delete()

        return Response({"message": "success"}, status=status.HTTP_201_CREATED)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def destroy(self, request, slug, project_id, module_id, issue_id):
        """Soft-delete the ``ModuleIssue`` junction row for ``(module_id, issue_id)``.

        Emits a ``module.activity.deleted`` audit event via the
        ``issue_activity`` Celery task (RabbitMQ-backed) before the
        model's overridden soft-delete sets ``deleted_at``.
        """
        module_issue = ModuleIssue.objects.filter(
            workspace__slug=slug,
            project_id=project_id,
            module_id=module_id,
            issue_id=issue_id,
        )
        issue_activity.delay(
            type="module.activity.deleted",
            requested_data=json.dumps({"module_id": str(module_id)}),
            actor_id=str(request.user.id),
            issue_id=str(issue_id),
            project_id=str(project_id),
            current_instance=json.dumps({"module_name": module_issue.first().module.name}),
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )
        module_issue.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
