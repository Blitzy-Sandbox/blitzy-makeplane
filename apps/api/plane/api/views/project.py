# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Project endpoints for the external ``/api/v1/`` API.

Exposes CRUD over ``Project`` rows plus archive/unarchive and per-project
rollup summaries (members, states, labels, cycles, modules, issues,
intakes, pages). Creating a project also bootstraps the default
``State`` rows and assigns the creator as ``ProjectMember`` admin.

Authentication is via the ``X-Api-Key`` header (see
``plane.api.middleware.api_authentication.APIKeyAuthentication``).
"""

# Python imports
import json

# Django imports
from django.db import IntegrityError, transaction
from django.db.models import Exists, F, Func, OuterRef, Prefetch, Q, Subquery, Count
from django.db.models.functions import Coalesce
from django.utils import timezone
from django.core.serializers.json import DjangoJSONEncoder

# Third party imports
from rest_framework import status
from rest_framework.response import Response
from rest_framework.serializers import ValidationError
from drf_spectacular.utils import OpenApiResponse, OpenApiRequest


# Module imports
from plane.db.models import (
    Cycle,
    Intake,
    Module,
    Project,
    DeployBoard,
    ProjectMember,
    State,
    DEFAULT_STATES,
    Workspace,
    UserFavorite,
    Label,
    Issue,
    StateGroup,
    IntakeIssue,
    ProjectPage,
)
from plane.bgtasks.webhook_task import model_activity, webhook_activity
from plane.utils.exception_logger import log_exception
from .base import BaseAPIView
from plane.utils.host import base_host
from plane.api.serializers import (
    ProjectSerializer,
    ProjectCreateSerializer,
    ProjectUpdateSerializer,
)
from plane.app.permissions import ProjectBasePermission, WorkSpaceAdminPermission
from plane.utils.openapi import (
    project_docs,
    PROJECT_ID_PARAMETER,
    PROJECT_PK_PARAMETER,
    CURSOR_PARAMETER,
    PER_PAGE_PARAMETER,
    ORDER_BY_PARAMETER,
    FIELDS_PARAMETER,
    EXPAND_PARAMETER,
    create_paginated_response,
    # Request Examples
    PROJECT_CREATE_EXAMPLE,
    PROJECT_UPDATE_EXAMPLE,
    # Response Examples
    PROJECT_EXAMPLE,
    PROJECT_NOT_FOUND_RESPONSE,
    WORKSPACE_NOT_FOUND_RESPONSE,
    PROJECT_NAME_TAKEN_RESPONSE,
    DELETED_RESPONSE,
    ARCHIVED_RESPONSE,
    UNARCHIVED_RESPONSE,
)


class ProjectListCreateAPIEndpoint(BaseAPIView):
    """List or create projects within a workspace.

    HTTP methods + URL pattern:
        GET   /api/v1/workspaces/<slug>/projects/
        POST  /api/v1/workspaces/<slug>/projects/

    Request body (POST) -- see ``ProjectCreateSerializer``:
        name            (str, required)  - Project name.
        identifier      (str, required)  - Short identifier (e.g.
            ``ENG``); used as the prefix for work-item sequence IDs;
            IMMUTABLE once set.
        description     (str, optional)
        network         (int, optional, default 2) - Visibility:
            ``0=Secret``, ``2=Public`` within the workspace.
        emoji           (str, optional)
        icon_prop       (object, optional) - Icon descriptor JSON.
        cover_image     (str, optional)   - URL/path.
        module_view     (bool, optional, default True)
        cycle_view      (bool, optional, default True)
        issue_views_view (bool, optional, default True)
        page_view       (bool, optional, default True)
        intake_view     (bool, optional, default False)
        external_id     (str, optional)   - External identifier.
        external_source (str, optional)   - External system identifier.

    Response shape:
        - GET: paginated array of projects via
          ``ProjectSerializer`` with the annotations ``is_member``,
          ``total_members``, ``total_cycles``, ``total_modules``,
          ``member_role``, and ``is_deployed`` (see ``get_queryset``).
        - POST: created project via ``ProjectSerializer``.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectBasePermission``:
            - GET: any workspace member.
            - POST: workspace ``ADMIN`` or ``MEMBER`` only.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Constraints on POST:
        - Returns ``409 Conflict`` on duplicate ``(external_id,
          external_source)`` pair with the existing project's ``id``.
        - ``identifier`` must be unique within the workspace.

    Side effects on POST (executed inside a DB transaction):
        - Writes ``Project`` row.
        - Writes ``ProjectMember`` row for the creator with role
          ``ADMIN`` (20).
        - Bulk-inserts the default ``State`` rows (backlog, unstarted,
          started, completed, cancelled).
        - On commit (``transaction.on_commit(robust=True)``) dispatches
          ``_dispatch_model_activity`` which enqueues the
          ``model_activity`` task via Celery+RabbitMQ for the project
          audit feed.
        - Triggers webhook fan-out via ``webhook_activity``/
          ``webhook_task`` if the workspace has active webhook
          subscriptions for ``project`` events.
    """

    serializer_class = ProjectSerializer
    model = Project
    webhook_event = "project"
    permission_classes = [ProjectBasePermission]
    use_read_replica = True

    def get_queryset(self):
        """Return projects in the workspace with rollup annotations.

        Annotations attached to each row:

        - ``is_member`` - ``Exists(ProjectMember)`` for the requesting
          user.
        - ``total_members`` - count of active project members.
        - ``total_cycles`` - count of non-archived cycles.
        - ``total_modules`` - count of non-archived modules.
        - ``member_role`` - the requesting user's project role.
        - ``is_deployed`` - whether the project has a public
          ``DeployBoard``.

        Archived projects (``archived_at IS NOT NULL``) are excluded.
        Joins are pre-fetched via ``select_related`` and
        ``prefetch_related``; ``distinct()`` is required because the
        join across ``ProjectMember`` would otherwise duplicate rows.
        """
        return (
            Project.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .filter(
                Q(
                    project_projectmember__member=self.request.user,
                    project_projectmember__is_active=True,
                )
                | Q(network=2)
            )
            .select_related("project_lead")
            .annotate(
                is_member=Exists(
                    ProjectMember.objects.filter(
                        member=self.request.user,
                        project_id=OuterRef("pk"),
                        workspace__slug=self.kwargs.get("slug"),
                        is_active=True,
                    )
                )
            )
            .annotate(
                total_members=ProjectMember.objects.filter(
                    project_id=OuterRef("id"), member__is_bot=False, is_active=True
                )
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(
                total_cycles=Cycle.objects.filter(project_id=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(
                total_modules=Module.objects.filter(project_id=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(
                member_role=ProjectMember.objects.filter(
                    project_id=OuterRef("pk"),
                    member_id=self.request.user.id,
                    is_active=True,
                ).values("role")
            )
            .annotate(
                is_deployed=Exists(
                    DeployBoard.objects.filter(
                        project_id=OuterRef("pk"),
                        workspace__slug=self.kwargs.get("slug"),
                    )
                )
            )
            .order_by(self.kwargs.get("order_by", "-created_at"))
            .distinct()
        )

    @project_docs(
        operation_id="list_projects",
        summary="List or retrieve projects",
        description="Retrieve all projects in a workspace or get details of a specific project.",
        parameters=[
            CURSOR_PARAMETER,
            PER_PAGE_PARAMETER,
            ORDER_BY_PARAMETER,
            FIELDS_PARAMETER,
            EXPAND_PARAMETER,
        ],
        responses={
            200: create_paginated_response(
                ProjectSerializer,
                "PaginatedProjectResponse",
                "Paginated list of projects",
                "Paginated Projects",
            ),
            404: PROJECT_NOT_FOUND_RESPONSE,
        },
    )
    def get(self, request, slug):
        """List projects in a workspace.

        Retrieve all projects in a workspace or get details of a specific project.
        Returns projects ordered by user's custom sort order with member information.
        """
        sort_order_query = ProjectMember.objects.filter(
            member=request.user,
            project_id=OuterRef("pk"),
            workspace__slug=self.kwargs.get("slug"),
            is_active=True,
        ).values("sort_order")
        projects = (
            self.get_queryset()
            .annotate(sort_order=Subquery(sort_order_query))
            .prefetch_related(
                Prefetch(
                    "project_projectmember",
                    queryset=ProjectMember.objects.filter(workspace__slug=slug, is_active=True).select_related(
                        "member"
                    ),
                )
            )
            .order_by(request.GET.get("order_by", "sort_order"))
        )
        return self.paginate(
            request=request,
            queryset=(projects),
            on_results=lambda projects: (
                ProjectSerializer(projects, many=True, fields=self.fields, expand=self.expand).data
            ),
        )

    @project_docs(
        operation_id="create_project",
        summary="Create project",
        description="Create a new project in the workspace with default states and member assignments.",
        request=OpenApiRequest(
            request=ProjectCreateSerializer,
            examples=[PROJECT_CREATE_EXAMPLE],
        ),
        responses={
            201: OpenApiResponse(
                description="Project created successfully",
                response=ProjectSerializer,
                examples=[PROJECT_EXAMPLE],
            ),
            404: WORKSPACE_NOT_FOUND_RESPONSE,
            409: PROJECT_NAME_TAKEN_RESPONSE,
        },
    )
    def post(self, request, slug):
        """Create a project and bootstrap its initial membership and states.

        Wraps the operation in a DB transaction: creates ``Project`` row,
        the creator's ``ProjectMember`` admin row, and the default
        ``State`` rows. On commit, dispatches ``model_activity`` via
        Celery+RabbitMQ and fires project webhooks if subscriptions are
        active. Returns ``409 Conflict`` on duplicate ``(external_id,
        external_source)``.
        """
        try:
            workspace = Workspace.objects.get(slug=slug)

            serializer = ProjectCreateSerializer(data={**request.data}, context={"workspace_id": workspace.id})

            if serializer.is_valid():
                with transaction.atomic():
                    serializer.save()

                    # Add the creator as Administrator of the project.
                    _ = ProjectMember.objects.create(project_id=serializer.instance.id, member=request.user, role=20)

                    # If a different project_lead was provided, add them as
                    # Administrator too. Use project_lead_id (the FK column)
                    # rather than project_lead (the related descriptor, which
                    # would resolve to a User instance and break UUID coercion
                    # downstream in ProjectMember.objects.create).
                    if (
                        serializer.instance.project_lead_id is not None
                        and serializer.instance.project_lead_id != request.user.id
                    ):
                        ProjectMember.objects.create(
                            project_id=serializer.instance.id,
                            member_id=serializer.instance.project_lead_id,
                            role=20,
                        )

                    State.objects.bulk_create(
                        [
                            State(
                                name=state["name"],
                                color=state["color"],
                                project=serializer.instance,
                                sequence=state["sequence"],
                                workspace=serializer.instance.workspace,
                                group=state["group"],
                                default=state.get("default", False),
                                created_by=request.user,
                            )
                            for state in DEFAULT_STATES
                        ]
                    )

                    project = self.get_queryset().filter(pk=serializer.instance.id).first()

                    # Defer the activity-log task until the surrounding
                    # transaction commits, so it never fires on a rolled-back
                    # creation.
                    # robust=True so broker / dispatch failures are logged
                    # internally by Django and don't surface as 500 after a
                    # successful commit (the inverse of the rollback path
                    # covered by test_model_activity_not_called_on_rollback).
                    # A nested function (rather than functools.partial) is
                    # used here because Django's robust on_commit logging
                    # path reads ``func.__qualname__`` to format the error
                    # message; ``partial`` objects don't have that dunder
                    # by default and the workaround is brittle when the
                    # wrapped callable is a mock. The closure captures
                    # the locals at construction time and they are never
                    # rebound, so late-binding is not a hazard here.
                    def _dispatch_model_activity():
                        model_activity.delay(
                            model_name="project",
                            model_id=str(project.id),
                            requested_data=request.data,
                            current_instance=None,
                            actor_id=request.user.id,
                            slug=slug,
                            origin=base_host(request=request, is_app=True),
                        )

                    transaction.on_commit(_dispatch_model_activity, robust=True)

                serializer = ProjectSerializer(project)
                return Response(serializer.data, status=status.HTTP_201_CREATED)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError as e:
            if "already exists" in str(e):
                return Response(
                    {"name": "The project name is already taken"},
                    status=status.HTTP_409_CONFLICT,
                )
            # Any other IntegrityError is unexpected: log it the same way
            # the catch-all `except Exception` below would and return the
            # same generic 500 so the client gets a uniform error shape.
            # `raise` here would not fall through to a sibling except
            # clause — it would exit the try/except entirely and bypass
            # both the logging and the JSON response.
            log_exception(e)
            return Response(
                {"error": "An unexpected error occurred"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        except Workspace.DoesNotExist:
            return Response({"error": "Workspace does not exist"}, status=status.HTTP_404_NOT_FOUND)
        except ValidationError:
            return Response(
                {"identifier": "The project identifier is already taken"},
                status=status.HTTP_409_CONFLICT,
            )
        except Exception as e:
            # Unexpected server-side failure: log the traceback and return a
            # generic 500 so the client can distinguish it from a 4xx caused
            # by bad input. Returning 400 here was the anti-pattern that
            # masked the original ghost-create bug.
            log_exception(e)
            return Response(
                {"error": "An unexpected error occurred"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class ProjectDetailAPIEndpoint(BaseAPIView):
    """Retrieve, partially update, or delete a single project.

    HTTP methods + URL pattern:
        GET     /api/v1/workspaces/<slug>/projects/<uuid:pk>/
        PATCH   /api/v1/workspaces/<slug>/projects/<uuid:pk>/
        DELETE  /api/v1/workspaces/<slug>/projects/<uuid:pk>/

    Request body (PATCH) -- partial ``ProjectUpdateSerializer`` payload:
        Any subset of the writable ``Project`` fields except ``identifier``,
        which is IMMUTABLE once set -- including it in the payload returns
        ``400 Bad Request``. Archived projects (``archived_at IS NOT NULL``)
        cannot be updated and return ``400 Bad Request``.

    Response shape:
        - GET: project serialized via ``ProjectSerializer`` (same
          annotations as the list endpoint).
        - PATCH: updated project via ``ProjectSerializer``.
        - DELETE: HTTP 204 with empty body.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectBasePermission`` -- mutations require project ``ADMIN`` or
        (workspace ``ADMIN`` AND project membership).
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Side effects on PATCH / DELETE:
        - PATCH: writes to ``Project``; dispatches ``model_activity`` via
          Celery+RabbitMQ; fires project webhooks if active.
        - DELETE: hard-deletes the project; cascades through all project
          entities (issues, cycles, modules, pages, etc.); fires project
          webhooks.
    """

    serializer_class = ProjectSerializer
    model = Project
    webhook_event = "project"

    permission_classes = [ProjectBasePermission]
    use_read_replica = True

    def get_queryset(self):
        """Return the single project, applying the same annotations as the list endpoint."""
        return (
            Project.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .filter(
                Q(
                    project_projectmember__member=self.request.user,
                    project_projectmember__is_active=True,
                )
                | Q(network=2)
            )
            .select_related("workspace", "workspace__owner", "default_assignee", "project_lead")
            .annotate(
                is_member=Exists(
                    ProjectMember.objects.filter(
                        member=self.request.user,
                        project_id=OuterRef("pk"),
                        workspace__slug=self.kwargs.get("slug"),
                        is_active=True,
                    )
                )
            )
            .annotate(
                total_members=ProjectMember.objects.filter(
                    project_id=OuterRef("id"), member__is_bot=False, is_active=True
                )
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(
                total_cycles=Cycle.objects.filter(project_id=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(
                total_modules=Module.objects.filter(project_id=OuterRef("id"))
                .order_by()
                .annotate(count=Func(F("id"), function="Count"))
                .values("count")
            )
            .annotate(
                member_role=ProjectMember.objects.filter(
                    project_id=OuterRef("pk"),
                    member_id=self.request.user.id,
                    is_active=True,
                ).values("role")
            )
            .annotate(
                is_deployed=Exists(
                    DeployBoard.objects.filter(
                        project_id=OuterRef("pk"),
                        workspace__slug=self.kwargs.get("slug"),
                    )
                )
            )
            .order_by(self.kwargs.get("order_by", "-created_at"))
            .distinct()
        )

    @project_docs(
        operation_id="retrieve_project",
        summary="Retrieve project",
        description="Retrieve details of a specific project.",
        parameters=[
            PROJECT_PK_PARAMETER,
        ],
        responses={
            200: OpenApiResponse(
                description="Project details",
                response=ProjectSerializer,
                examples=[PROJECT_EXAMPLE],
            ),
            404: PROJECT_NOT_FOUND_RESPONSE,
        },
    )
    def get(self, request, slug, pk):
        """Retrieve the project with rollup annotations."""
        project = self.get_queryset().get(workspace__slug=slug, pk=pk)
        serializer = ProjectSerializer(project, fields=self.fields, expand=self.expand)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @project_docs(
        operation_id="update_project",
        summary="Update project",
        description="Partially update an existing project's properties like name, description, or settings.",
        parameters=[
            PROJECT_PK_PARAMETER,
        ],
        request=OpenApiRequest(
            request=ProjectUpdateSerializer,
            examples=[PROJECT_UPDATE_EXAMPLE],
        ),
        responses={
            200: OpenApiResponse(
                description="Project updated successfully",
                response=ProjectSerializer,
                examples=[PROJECT_EXAMPLE],
            ),
            404: PROJECT_NOT_FOUND_RESPONSE,
            409: PROJECT_NAME_TAKEN_RESPONSE,
        },
    )
    def patch(self, request, slug, pk):
        """Apply a partial update to the project; ``identifier`` is immutable."""
        try:
            workspace = Workspace.objects.get(slug=slug)
            project = Project.objects.get(pk=pk)
            current_instance = json.dumps(ProjectSerializer(project).data, cls=DjangoJSONEncoder)

            intake_view = request.data.get("intake_view", project.intake_view)

            if project.archived_at:
                return Response(
                    {"error": "Archived project cannot be updated"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            serializer = ProjectUpdateSerializer(
                project,
                data={**request.data, "intake_view": intake_view},
                context={"workspace_id": workspace.id},
                partial=True,
            )

            if serializer.is_valid():
                serializer.save()
                if serializer.data["intake_view"]:
                    intake = Intake.objects.filter(project=project, is_default=True).first()
                    if not intake:
                        Intake.objects.create(
                            name=f"{project.name} Intake",
                            project=project,
                            is_default=True,
                        )

                project = self.get_queryset().filter(pk=serializer.instance.id).first()

                model_activity.delay(
                    model_name="project",
                    model_id=str(project.id),
                    requested_data=request.data,
                    current_instance=current_instance,
                    actor_id=request.user.id,
                    slug=slug,
                    origin=base_host(request=request, is_app=True),
                )

                serializer = ProjectSerializer(project)
                return Response(serializer.data, status=status.HTTP_200_OK)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError as e:
            if "already exists" in str(e):
                return Response(
                    {"name": "The project name is already taken"},
                    status=status.HTTP_409_CONFLICT,
                )
        except (Project.DoesNotExist, Workspace.DoesNotExist):
            return Response({"error": "Project does not exist"}, status=status.HTTP_404_NOT_FOUND)
        except ValidationError:
            return Response(
                {"identifier": "The project identifier is already taken"},
                status=status.HTTP_409_CONFLICT,
            )

    @project_docs(
        operation_id="delete_project",
        summary="Delete project",
        description="Permanently remove a project and all its associated data from the workspace.",
        parameters=[
            PROJECT_PK_PARAMETER,
        ],
        responses={
            204: DELETED_RESPONSE,
        },
    )
    def delete(self, request, slug, pk):
        """Hard-delete the project; cascades to all project entities and fires webhooks."""
        project = Project.objects.get(pk=pk, workspace__slug=slug)
        # Delete the user favorite cycle
        UserFavorite.objects.filter(entity_type="project", entity_identifier=pk, project_id=pk).delete()
        project.delete()
        webhook_activity.delay(
            event="project",
            verb="deleted",
            field=None,
            old_value=None,
            new_value=None,
            actor_id=request.user.id,
            slug=slug,
            current_site=base_host(request=request, is_app=True),
            event_id=project.id,
            old_identifier=None,
            new_identifier=None,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectArchiveUnarchiveAPIEndpoint(BaseAPIView):
    """Archive or unarchive a project.

    HTTP methods + URL pattern:
        POST    /api/v1/workspaces/<slug>/projects/<uuid:project_id>/archive/
        DELETE  /api/v1/workspaces/<slug>/projects/<uuid:project_id>/archive/

    Request body:
        None.

    Response shape:
        - POST: HTTP 204 with empty body.
        - DELETE: HTTP 204 with empty body.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``ProjectBasePermission`` -- only project ``ADMIN`` or workspace
        ``ADMIN`` + project member can archive/unarchive.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Semantics:
        - POST sets ``Project.archived_at = timezone.now()``. Archived
          projects are excluded from the default list queryset and from
          most child-entity scopes (cycles, modules) by their respective
          endpoint filters. Also drops the user's project favorites.
        - DELETE sets ``Project.archived_at = None`` to restore the
          project.
    """

    permission_classes = [ProjectBasePermission]

    @project_docs(
        operation_id="archive_project",
        summary="Archive project",
        description="Move a project to archived status, hiding it from active project lists.",
        parameters=[
            PROJECT_ID_PARAMETER,
        ],
        request={},
        responses={
            204: ARCHIVED_RESPONSE,
        },
    )
    def post(self, request, slug, project_id):
        """Archive the project by setting ``archived_at`` to the current timestamp."""
        project = Project.objects.get(pk=project_id, workspace__slug=slug)
        project.archived_at = timezone.now()
        project.save()
        UserFavorite.objects.filter(workspace__slug=slug, project=project_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @project_docs(
        operation_id="unarchive_project",
        summary="Unarchive project",
        description="Restore an archived project to active status, making it available in regular workflows.",
        parameters=[
            PROJECT_ID_PARAMETER,
        ],
        request={},
        responses={
            204: UNARCHIVED_RESPONSE,
        },
    )
    def delete(self, request, slug, project_id):
        """Unarchive the project by clearing ``archived_at``."""
        project = Project.objects.get(pk=project_id, workspace__slug=slug)
        project.archived_at = None
        project.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


ALLOWED_PROJECT_SUMMARY_FIELDS = [
    "members",
    "states",
    "labels",
    "cycles",
    "modules",
    "issues",
    "intakes",
    "pages",
]


class ProjectSummaryAPIEndpoint(BaseAPIView):
    """Return rollup counts for a project.

    Provides a fast single-round-trip summary intended for project
    dashboards and CLI consumers that need entity counts without
    paginating each list endpoint.

    HTTP methods + URL pattern:
        GET   /api/v1/workspaces/<slug>/projects/<uuid:project_id>/summary/

    Query parameters:
        fields  (str, optional) - Comma-separated subset of the supported
            facets to include. When omitted, all facets are returned.
            Valid values: ``members``, ``states``, ``labels``, ``cycles``,
            ``modules``, ``issues``, ``intakes``, ``pages``.

    Response shape:
        JSON object with project identity plus a nested ``counts``
        dictionary keyed by the requested fields, e.g.::

            {
              "id": "<uuid>",
              "name": "Project Name",
              "identifier": "ENG",
              "counts": {
                "members": 12,
                "states": 5,
                "labels": 8,
                "cycles": 3,
                "modules": 2,
                "issues": 154,
                "intakes": 4,
                "pages": 21
              }
            }

        Fields absent from the ``fields`` query are omitted from the
        ``counts`` dictionary. Returns ``404 Not Found`` if the project
        does not exist in the workspace.

    Authentication:
        ``X-Api-Key`` header validated by ``APIKeyAuthentication`` (inherited
        from ``BaseAPIView``).
    Permissions:
        ``WorkSpaceAdminPermission`` -- only workspace ``ADMIN`` members
        may read the summary.
    Throttle:
        ``ApiKeyRateThrottle`` (60/minute) or ``ServiceTokenRateThrottle``
        (300/minute) when the API token has ``is_service=True``.

    Performance:
        ``use_read_replica = True`` -- served by the read replica.
        Counts are computed in a single ORM round-trip via
        ``Count(...)`` annotations inside the ``_get_all_summary_counts``
        helper. ``issues`` count excludes triage-state issues.

    Side effects:
        Read-only -- no DB writes, no Celery enqueues.
    """

    permission_classes = [WorkSpaceAdminPermission]
    use_read_replica = True

    def get(self, request, slug, project_id):
        """Return the requested subset of project rollup counts."""
        project = Project.objects.filter(pk=project_id, workspace__slug=slug).first()
        if not project:
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
        fields = request.GET.get("fields", "").split(",")
        requested_fields = set(filter(None, (f.strip() for f in fields))) & set(ALLOWED_PROJECT_SUMMARY_FIELDS)
        if not requested_fields:
            requested_fields = set(ALLOWED_PROJECT_SUMMARY_FIELDS)

        # Single DB round-trip with only requested count subqueries
        counts = self._get_all_summary_counts(project_id, requested_fields)
        counts_dict = {field: counts[field] for field in requested_fields}
        summary = {
            "id": project.id,
            "name": project.name,
            "identifier": project.identifier,
            "counts": counts_dict,
        }
        return Response(summary, status=status.HTTP_200_OK)

    # Getting all summary counts in one ORM query; only runs subqueries for requested fields.
    def _get_all_summary_counts(self, project_id, requested_fields):
        """Return requested summary counts in one ORM query; only runs subqueries for requested fields."""
        # Using a different annotation name for 'pages' to avoid conflict with Project.pages (M2M from Page)
        def _annotation_name(field):
            return "pages_count" if field == "pages" else field

        subquery_builders = {
            "members": lambda: (
                ProjectMember.objects.filter(project_id=OuterRef("pk"), is_active=True)
                .values("project_id")
                .annotate(count=Count("*"))
                .values("count")
            ),
            "states": lambda: (
                State.objects.filter(project_id=OuterRef("pk"))
                .values("project_id")
                .annotate(count=Count("*"))
                .values("count")
            ),
            "labels": lambda: (
                Label.objects.filter(project_id=OuterRef("pk"))
                .values("project_id")
                .annotate(count=Count("*"))
                .values("count")
            ),
            "cycles": lambda: (
                Cycle.objects.filter(project_id=OuterRef("pk"))
                .values("project_id")
                .annotate(count=Count("*"))
                .values("count")
            ),
            "modules": lambda: (
                Module.objects.filter(project_id=OuterRef("pk"))
                .values("project_id")
                .annotate(count=Count("*"))
                .values("count")
            ),
            "issues": lambda: (
                Issue.objects.filter(project_id=OuterRef("pk"))
                .exclude(state__group=StateGroup.TRIAGE.value)
                .values("project_id")
                .annotate(count=Count("*"))
                .values("count")
            ),
            "intakes": lambda: (
                IntakeIssue.objects.filter(project_id=OuterRef("pk"))
                .values("project_id")
                .annotate(count=Count("*"))
                .values("count")
            ),
            "pages": lambda: (
                ProjectPage.objects.filter(project_id=OuterRef("pk"))
                .values("project_id")
                .annotate(count=Count("*"))
                .values("count")
            ),
        }

        # Build annotations dictionary for the requested fields
        annotations = {
            _annotation_name(field): Coalesce(Subquery(subquery_builders[field]()), 0) for field in requested_fields
        }

        # Prepare values list for the annotation names
        fields_list = sorted(requested_fields)
        values_list = [_annotation_name(f) for f in fields_list]
        # Execute the query and get the result
        query_result = Project.objects.filter(pk=project_id).annotate(**annotations).values(*values_list).first()
        if not query_result:
            return {field: 0 for field in requested_fields}
        # Return the result as a dictionary
        return {field: query_result[_annotation_name(field)] for field in requested_fields}
