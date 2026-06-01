# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Project surface for the Plane web-client API.

Projects are workspace-scoped containers for cycles, modules, issues,
pages, views, intake, and deploy boards. Each project carries a short
uppercase ``identifier`` (e.g. ``"PROJ"``) which prefixes issue
sequence ids (``"PROJ-123"``) and is unique within a workspace.

This module exposes the project CRUD surface plus six closely
coupled sibling endpoints:

* :class:`ProjectViewSet` -- list / create / retrieve / update /
  destroy projects. ``list`` returns a lean ``.values(...)`` row for
  workspace home rendering; ``list_detail`` returns the full
  :class:`plane.app.serializers.ProjectListSerializer` shape with
  annotated ``is_favorite`` / ``member_role`` / ``anchor`` /
  ``sort_order`` and prefetched members.
* :class:`ProjectArchiveUnarchiveEndpoint` -- archive / unarchive
  projects by stamping or clearing ``archived_at``.
* :class:`ProjectIdentifierEndpoint` -- look up project identifier
  availability across a workspace and delete unbound identifiers.
* :class:`ProjectUserViewsEndpoint` -- persist per-user
  ``view_props`` / ``default_props`` / ``preferences`` / ``sort_order``
  on a :class:`ProjectMember`.
* :class:`ProjectFavoritesViewSet` -- mark / unmark projects as
  favorites via :class:`plane.db.models.UserFavorite` rows.
* :class:`DeployBoardViewSet` -- publish a project as a public board
  through :class:`plane.db.models.DeployBoard`. The
  anonymous-readable surface lives in :mod:`plane.space` and is out
  of scope for this module.

Permission classes referenced here come from
:mod:`plane.app.permissions.project`:
``ProjectBasePermission`` / ``ProjectEntityPermission`` /
``ProjectMemberPermission`` / ``ProjectLitePermission`` /
``ProjectPagePermission``. The ``@allow_permission`` decorator
sources its ``ROLE`` enum from :mod:`plane.app.permissions.base`
(``Admin=20``, ``Member=15``, ``Guest=5``).

Network values (from :class:`plane.db.models.project.ProjectNetwork`):
``SECRET=0`` (only members can list/retrieve), ``PUBLIC=2`` (any
workspace member can list).

Side effects:
    * ``create`` -- bulk creates ``DEFAULT_STATES`` rows and enqueues
      a ``model_activity`` Celery task (RabbitMQ).
    * ``partial_update`` -- enqueues ``model_activity`` and may
      lazily create a default :class:`Intake` row when
      ``intake_view`` is enabled.
    * ``destroy`` -- enqueues ``webhook_activity`` (RabbitMQ) and
      deletes related ``DeployBoard`` and ``UserFavorite`` rows.
    * ``retrieve`` -- enqueues ``recent_visited_task`` (RabbitMQ) to
      record the visit on the workspace home recents widget.

This module is referenced by the local imports
``from .base import BaseViewSet, BaseAPIView`` in
:mod:`plane.app.views.project.member` and
:mod:`plane.app.views.project.invite`, which is why
:class:`BaseViewSet` and :class:`BaseAPIView` are imported via the
package-level :mod:`plane.app.views.base` rather than re-exported
here.
"""

# Python imports
import json


# Django imports
from django.core.serializers.json import DjangoJSONEncoder
from django.db.models import Exists, F, OuterRef, Prefetch, Q, Subquery, Count
from django.utils import timezone

# Third Party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, ProjectMemberPermission, allow_permission
from plane.app.serializers import (
    DeployBoardSerializer,
    ProjectListSerializer,
    ProjectSerializer,
)
from plane.app.views.base import BaseAPIView, BaseViewSet
from plane.bgtasks.recent_visited_task import recent_visited_task
from plane.bgtasks.webhook_task import model_activity, webhook_activity
from plane.db.models import (
    UserFavorite,
    DeployBoard,
    Intake,
    Project,
    ProjectIdentifier,
    ProjectMember,
    ProjectNetwork,
    ProjectUserProperty,
    State,
    DEFAULT_STATES,
    Workspace,
    WorkspaceMember,
)
from plane.db.models.intake import IntakeIssueStatus
from plane.utils.host import base_host


class ProjectViewSet(BaseViewSet):
    """Workspace project CRUD with role-aware visibility and webhook integration.

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/                (``list`` -- lean ``.values(...)`` rows)
        GET    /api/workspaces/<slug>/projects/details/        (``list_detail`` -- full serializer)
        POST   /api/workspaces/<slug>/projects/                (``create``)
        GET    /api/workspaces/<slug>/projects/<pk>/           (``retrieve``)
        PUT    /api/workspaces/<slug>/projects/<pk>/           (``update`` -- inherited from DRF)
        PATCH  /api/workspaces/<slug>/projects/<pk>/           (``partial_update``)
        DELETE /api/workspaces/<slug>/projects/<pk>/           (``destroy``)

    Request body (POST):
        name (str, required): Human-readable project name; unique per
            workspace (per ``Project.Meta.unique_together``).
        identifier (str, required): Uppercase short code (max 12 chars
            per ``Project.identifier`` field, stripped + uppercased on
            save); UNIQUE per workspace; used as the issue sequence
            prefix (e.g. ``"PROJ-123"``).
        description (str, optional): Free-form text description.
        description_html (JSON, optional): Sanitized HTML description
            (passed through ``validate_html_content``).
        network (int, optional, default=2): ``ProjectNetwork.SECRET=0``
            (only members can list/retrieve) or
            ``ProjectNetwork.PUBLIC=2`` (any workspace member can
            list).
        emoji (str, optional): Legacy emoji icon.
        icon_prop (JSON, optional): Modern structured icon
            ``{name, color, ...}``.
        logo_props (JSON, optional): Same shape as ``icon_prop`` for
            the modern UI.
        cover_image (URL, optional) or cover_image_asset (UUID,
            optional): Legacy URL or
            :class:`plane.db.models.FileAsset` reference.
        project_lead (UUID, optional): Workspace user who leads the
            project; auto-added as project admin if different from
            the creator.
        default_assignee (UUID, optional): Workspace user assigned
            new issues by default.
        module_view / cycle_view / issue_views / page_view /
            intake_view (bool, optional): Feature toggles controlling
            which sub-navigations appear for this project.

    Request body (PATCH):
        Any subset of the POST fields. Archived projects
        (``archived_at`` is set) reject all updates with HTTP 400.

    Response shape (list_detail / retrieve / create / partial_update):
        :class:`plane.app.serializers.ProjectListSerializer` output
        with annotated ``is_favorite``, ``member_role``, ``anchor``
        (deploy-board anchor), ``sort_order``, prefetched
        ``members_list``, and computed ``next_work_item_sequence``.

    Response shape (list):
        Lean ``.values(...)`` rows containing only the columns
        required by the workspace-home project list widget (``id``,
        ``name``, ``identifier``, ``sort_order``, ``logo_props``,
        ``member_role``, ``intake_count``, ``archived_at``,
        ``workspace``, ``cycle_view``, ``issue_views_view``,
        ``module_view``, ``page_view``, ``inbox_view``,
        ``guest_view_all_features``, ``project_lead``, ``network``,
        ``created_at``, ``updated_at``, ``created_by``,
        ``updated_by``).

    Permissions:
        Default :class:`plane.app.permissions.ProjectBasePermission`
        plus per-method ``@allow_permission`` decorators:

        * ``list`` / ``list_detail`` / ``retrieve`` --
          ``[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST]`` at
          ``level="WORKSPACE"`` (any active workspace member).
        * ``create`` -- ``[ROLE.ADMIN, ROLE.MEMBER]`` at
          ``level="WORKSPACE"`` (workspace guests cannot create).
        * ``partial_update`` / ``destroy`` -- inline permission
          check via ``WorkspaceMember`` + ``ProjectMember`` queries
          (workspace admin OR project admin).

    Webhook integration:
        ``webhook_event = "project"`` -- mutations are surfaced to
        workspace webhooks via the webhook delivery pipeline (tech
        spec section 5.2.10).

    Read replica:
        ``use_read_replica = True`` -- ``GET`` requests are routed
        through the read replica (writes always hit the primary).

    Queryset filter logic:
        Scoped to ``workspace.slug == kwargs["slug"]`` with
        ``workspace``, ``workspace.owner``, ``default_assignee``,
        ``project_lead`` eager-loaded, and annotated with the
        requesting user's ``is_favorite`` and ``member_role``, the
        deploy-board ``anchor`` (when published), and the user's
        per-project ``sort_order`` (from
        :class:`ProjectUserProperty`). Project members are
        prefetched into ``members_list`` (active, workspace-scoped).
        Returns ``.distinct()``.

    Role-aware filtering in ``list`` / ``list_detail``:
        * Workspace ``Guest`` -- only projects where they are an
          active ``ProjectMember``.
        * Workspace ``Member`` -- projects where they are an active
          member OR projects with ``network=2`` (public).
        * Workspace ``Admin`` -- all projects in the workspace.

    Side effects (POST / PATCH / DELETE):
        ``recent_visited_task``, ``model_activity``, and
        ``webhook_activity`` Celery tasks are dispatched via RabbitMQ
        (worker modules
        :mod:`plane.bgtasks.recent_visited_task`,
        :mod:`plane.bgtasks.issue_activities_task`, and
        :mod:`plane.bgtasks.webhook_task`).

    Cross-references:
        * Serializers: ``ProjectListSerializer``,
          ``ProjectSerializer``, ``DeployBoardSerializer`` in
          ``apps/api/plane/app/serializers/project.py``.
        * Models: ``Project``, ``ProjectMember``, ``ProjectIdentifier``,
          ``ProjectUserProperty``, ``ProjectFavorite`` in
          ``apps/api/plane/db/models/project.py``;
          ``DeployBoard`` in
          ``apps/api/plane/db/models/deploy_board.py``;
          ``WorkspaceMember`` in
          ``apps/api/plane/db/models/workspace.py``;
          ``UserFavorite`` in
          ``apps/api/plane/db/models/favorite.py``.
        * Permissions: ``ProjectBasePermission`` in
          ``apps/api/plane/app/permissions/project.py``;
          ``allow_permission`` decorator in
          ``apps/api/plane/app/permissions/base.py``.
        * Celery tasks:
          ``apps/api/plane/bgtasks/recent_visited_task.py``,
          ``apps/api/plane/bgtasks/issue_activities_task.py``,
          ``apps/api/plane/bgtasks/webhook_task.py`` (all queued via
          RabbitMQ).
        * URL registration:
          ``apps/api/plane/app/urls/project.py``.
    """

    serializer_class = ProjectListSerializer
    model = Project
    webhook_event = "project"
    use_read_replica = True

    def get_queryset(self):
        """Return the workspace project queryset with annotations and prefetched members.

        Annotates each row with the caller's ``is_favorite``, ``member_role``,
        the published deploy-board ``anchor``, and the per-user ``sort_order``;
        prefetches active project members into ``members_list``.
        """
        sort_order = ProjectUserProperty.objects.filter(
            user=self.request.user,
            project_id=OuterRef("pk"),
            workspace__slug=self.kwargs.get("slug"),
        ).values("sort_order")
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .select_related("workspace", "workspace__owner", "default_assignee", "project_lead")
            .annotate(
                is_favorite=Exists(
                    UserFavorite.objects.filter(
                        user=self.request.user,
                        entity_identifier=OuterRef("pk"),
                        entity_type="project",
                        project_id=OuterRef("pk"),
                    )
                )
            )
            .annotate(
                member_role=ProjectMember.objects.filter(
                    project_id=OuterRef("pk"),
                    member_id=self.request.user.id,
                    is_active=True,
                ).values("role")
            )
            .annotate(
                anchor=DeployBoard.objects.filter(
                    entity_name="project",
                    entity_identifier=OuterRef("pk"),
                    workspace__slug=self.kwargs.get("slug"),
                ).values("anchor")
            )
            .annotate(sort_order=Subquery(sort_order))
            .prefetch_related(
                Prefetch(
                    "project_projectmember",
                    queryset=ProjectMember.objects.filter(
                        workspace__slug=self.kwargs.get("slug"), is_active=True
                    ).select_related("member"),
                    to_attr="members_list",
                )
            )
            .distinct()
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list_detail(self, request, slug):
        """List projects (full serializer) with role-aware filtering and optional field subsetting.

        Supports cursor pagination via ``?per_page=`` + ``?cursor=`` and a
        ``?fields=`` comma-separated allowlist that narrows the serializer
        output.
        """
        fields = [field for field in request.GET.get("fields", "").split(",") if field]
        projects = self.get_queryset().order_by("sort_order", "name")
        if WorkspaceMember.objects.filter(
            member=request.user,
            workspace__slug=slug,
            is_active=True,
            role=ROLE.GUEST.value,
        ).exists():
            projects = projects.filter(
                project_projectmember__member=self.request.user,
                project_projectmember__is_active=True,
            )

        if WorkspaceMember.objects.filter(
            member=request.user,
            workspace__slug=slug,
            is_active=True,
            role=ROLE.MEMBER.value,
        ).exists():
            projects = projects.filter(
                Q(
                    project_projectmember__member=self.request.user,
                    project_projectmember__is_active=True,
                )
                | Q(network=2)
            )

        if request.GET.get("per_page", False) and request.GET.get("cursor", False):
            return self.paginate(
                order_by=request.GET.get("order_by", "-created_at"),
                request=request,
                queryset=(projects),
                on_results=lambda projects: ProjectListSerializer(projects, many=True).data,
            )

        projects = ProjectListSerializer(projects, many=True, fields=fields if fields else None).data
        return Response(projects, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug):
        """Return a lean ``.values(...)`` project list with role-aware filtering.

        Optimized for the workspace-home navigation widget; returns only the
        columns the widget renders rather than the full serializer payload.
        """
        sort_order = ProjectUserProperty.objects.filter(
            user=self.request.user,
            project_id=OuterRef("pk"),
            workspace__slug=self.kwargs.get("slug"),
        ).values("sort_order")

        projects = (
            Project.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .select_related("workspace", "workspace__owner", "default_assignee", "project_lead")
            .annotate(
                member_role=ProjectMember.objects.filter(
                    project_id=OuterRef("pk"),
                    member_id=self.request.user.id,
                    is_active=True,
                ).values("role")
            )
            .annotate(
                intake_count=Count(
                    "project_intakeissue",
                    filter=Q(
                        project_intakeissue__status=IntakeIssueStatus.PENDING.value,
                        project_intakeissue__deleted_at__isnull=True,
                    ),
                )
            )
            .annotate(inbox_view=F("intake_view"))
            .annotate(sort_order=Subquery(sort_order))
            .distinct()
        ).values(
            "id",
            "name",
            "identifier",
            "sort_order",
            "logo_props",
            "member_role",
            "intake_count",
            "archived_at",
            "workspace",
            "cycle_view",
            "issue_views_view",
            "module_view",
            "page_view",
            "inbox_view",
            "guest_view_all_features",
            "project_lead",
            "network",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        )

        if WorkspaceMember.objects.filter(
            member=request.user,
            workspace__slug=slug,
            is_active=True,
            role=ROLE.GUEST.value,
        ).exists():
            projects = projects.filter(
                project_projectmember__member=self.request.user,
                project_projectmember__is_active=True,
            )

        if WorkspaceMember.objects.filter(
            member=request.user,
            workspace__slug=slug,
            is_active=True,
            role=ROLE.MEMBER.value,
        ).exists():
            projects = projects.filter(
                Q(
                    project_projectmember__member=self.request.user,
                    project_projectmember__is_active=True,
                )
                | Q(network=2)
            )
        return Response(projects, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def retrieve(self, request, slug, pk):
        """Retrieve a single non-archived project with network-aware access gating.

        Non-members receive HTTP 403 for ``SECRET`` projects and HTTP 409 for
        public ones. Enqueues ``recent_visited_task`` (Celery via RabbitMQ) on
        success so the workspace home recents widget reflects the access.
        """
        project = self.get_queryset().filter(archived_at__isnull=True).filter(pk=pk).first()

        if project is None:
            return Response({"error": "Project does not exist"}, status=status.HTTP_404_NOT_FOUND)

        member_ids = [str(project_member.member_id) for project_member in project.members_list]

        if str(request.user.id) not in member_ids:
            if project.network == ProjectNetwork.SECRET.value:
                return Response(
                    {"error": "You do not have permission"},
                    status=status.HTTP_403_FORBIDDEN,
                )
            else:
                return Response(
                    {"error": "You are not a member of this project"},
                    status=status.HTTP_409_CONFLICT,
                )

        recent_visited_task.delay(
            slug=slug,
            project_id=pk,
            entity_name="project",
            entity_identifier=pk,
            user_id=request.user.id,
        )

        serializer = ProjectListSerializer(project)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def create(self, request, slug):
        """Create a project and seed its members, default states, and activity feed entry.

        The creator is added as :class:`ProjectMember` with
        ``role=ROLE.ADMIN.value``. If ``project_lead`` is supplied
        and differs from the creator, a second admin
        :class:`ProjectMember` is created. Default workflow states
        are seeded from ``DEFAULT_STATES`` so the project is
        immediately usable. A ``model_activity`` Celery task is
        enqueued (RabbitMQ) to record the create event for activity
        feeds and webhooks.
        """
        workspace = Workspace.objects.get(slug=slug)

        serializer = ProjectSerializer(data={**request.data}, context={"workspace_id": workspace.id})
        if serializer.is_valid():
            serializer.save()

            # Add the user as Administrator to the project
            _ = ProjectMember.objects.create(
                project_id=serializer.data["id"],
                member=request.user,
                role=ROLE.ADMIN.value,
            )

            if serializer.data["project_lead"] is not None and str(serializer.data["project_lead"]) != str(
                request.user.id
            ):
                ProjectMember.objects.create(
                    project_id=serializer.data["id"],
                    member_id=serializer.data["project_lead"],
                    role=ROLE.ADMIN.value,
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

            project = self.get_queryset().filter(pk=serializer.data["id"]).first()

            # Create the model activity
            model_activity.delay(
                model_name="project",
                model_id=str(project.id),
                requested_data=request.data,
                current_instance=None,
                actor_id=request.user.id,
                slug=slug,
                origin=base_host(request=request, is_app=True),
            )

            serializer = ProjectListSerializer(project)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def partial_update(self, request, slug, pk=None):
        """Partial update of a project with inline workspace/project admin gating; archived projects reject all updates.

        Uses an inline permission check (workspace admin OR project
        admin) instead of the ``@allow_permission`` decorator pattern
        used elsewhere; this is intentional. Toggling
        ``inbox_view=True`` lazily creates a default :class:`Intake`
        when none exists. Emits a ``model_activity`` Celery task
        (RabbitMQ) carrying the pre-edit serialized snapshot.
        """
        # try:
        is_workspace_admin = WorkspaceMember.objects.filter(
            member=request.user,
            workspace__slug=slug,
            is_active=True,
            role=ROLE.ADMIN.value,
        ).exists()

        is_project_admin = ProjectMember.objects.filter(
            member=request.user,
            workspace__slug=slug,
            project_id=pk,
            role=ROLE.ADMIN.value,
            is_active=True,
        ).exists()

        # Return error for if the user is neither workspace admin nor project admin
        if not is_project_admin and not is_workspace_admin:
            return Response(
                {"error": "You don't have the required permissions."},
                status=status.HTTP_403_FORBIDDEN,
            )

        workspace = Workspace.objects.get(slug=slug)

        project = Project.objects.get(pk=pk, workspace__slug=slug)
        intake_view = request.data.get("inbox_view", project.intake_view)
        current_instance = json.dumps(ProjectSerializer(project).data, cls=DjangoJSONEncoder)
        if project.archived_at:
            return Response(
                {"error": "Archived projects cannot be updated"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = ProjectSerializer(
            project,
            data={**request.data, "intake_view": intake_view},
            context={"workspace_id": workspace.id},
            partial=True,
        )

        if serializer.is_valid():
            serializer.save()
            if intake_view:
                intake = Intake.objects.filter(project=project, is_default=True).first()
                if not intake:
                    Intake.objects.create(
                        name=f"{project.name} Intake",
                        project=project,
                        is_default=True,
                    )

            project = self.get_queryset().filter(pk=serializer.data["id"]).first()

            model_activity.delay(
                model_name="project",
                model_id=str(project.id),
                requested_data=request.data,
                current_instance=current_instance,
                actor_id=request.user.id,
                slug=slug,
                origin=base_host(request=request, is_app=True),
            )
            serializer = ProjectListSerializer(project)
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def destroy(self, request, slug, pk):
        """Soft-delete a project (via the ``BaseModel`` cascade) with inline workspace/project admin gating.

        On success, emits a ``webhook_activity`` Celery task
        (RabbitMQ) with verb ``"deleted"`` and hard-deletes the
        project's :class:`DeployBoard` and :class:`UserFavorite`
        rows so stale references are cleared immediately.
        """
        if (
            WorkspaceMember.objects.filter(
                member=request.user,
                workspace__slug=slug,
                is_active=True,
                role=ROLE.ADMIN.value,
            ).exists()
            or ProjectMember.objects.filter(
                member=request.user,
                workspace__slug=slug,
                project_id=pk,
                role=ROLE.ADMIN.value,
                is_active=True,
            ).exists()
        ):
            project = Project.objects.get(pk=pk, workspace__slug=slug)
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
            # Delete the project members
            DeployBoard.objects.filter(project_id=pk, workspace__slug=slug).delete()

            # Delete the user favorite
            UserFavorite.objects.filter(project_id=pk, workspace__slug=slug).delete()

            return Response(status=status.HTTP_204_NO_CONTENT)
        else:
            return Response(
                {"error": "You don't have the required permissions."},
                status=status.HTTP_403_FORBIDDEN,
            )


class ProjectArchiveUnarchiveEndpoint(BaseAPIView):
    """Archive / unarchive a project by stamping or clearing ``archived_at``.

    HTTP methods + URL patterns:
        POST   /api/workspaces/<slug>/projects/<project_id>/archive/
        DELETE /api/workspaces/<slug>/projects/<project_id>/archive/

    Request body:
        None (the action is taken on the URL-identified project).

    Response shape (POST):
        ``{"archived_at": <timestamp-str>}`` on archive (HTTP 200).

    Response shape (DELETE):
        HTTP 204 with empty body on unarchive.

    Permissions:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER])`` on both
        ``post`` and ``delete`` -- workspace guests cannot archive
        or unarchive.

    Side effects:
        On archive, related :class:`UserFavorite` rows for this
        project are deleted so it disappears from favorite lists.

    Cross-references:
        * Models: ``Project`` in
          ``apps/api/plane/db/models/project.py``;
          ``UserFavorite`` in
          ``apps/api/plane/db/models/favorite.py``.
        * Permissions: ``allow_permission`` decorator in
          ``apps/api/plane/app/permissions/base.py``.
        * URL registration:
          ``apps/api/plane/app/urls/project.py``.
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id):
        """Archive the project by setting ``archived_at = timezone.now()`` and removing any user-favorite rows."""
        project = Project.objects.get(pk=project_id, workspace__slug=slug)
        project.archived_at = timezone.now()
        project.save()
        UserFavorite.objects.filter(workspace__slug=slug, project=project_id).delete()
        return Response({"archived_at": str(project.archived_at)}, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def delete(self, request, slug, project_id):
        """Unarchive the project by clearing ``archived_at = None``."""
        project = Project.objects.get(pk=project_id, workspace__slug=slug)
        project.archived_at = None
        project.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectIdentifierEndpoint(BaseAPIView):
    """Workspace-scoped project identifier (short-code) lookup and cleanup.

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/project-identifiers/
        DELETE /api/workspaces/<slug>/project-identifiers/

    Request body:
        - GET: None. ``name`` is supplied as a query parameter.
        - DELETE: ``{"name": str (required)}`` JSON body identifying the
          identifier row to delete (trimmed + uppercased).

    Query / body field (both methods):
        name (str, required): Proposed identifier; trimmed and
            uppercased before lookup.

    Response shape (GET):
        ``{"exists": int, "identifiers": [{"id", "name",
        "project"}, ...]}`` -- the ``exists`` count and the
        unbound-or-bound identifier rows.

    Response shape (DELETE):
        HTTP 204 on success, HTTP 400 if the identifier is still
        bound to an existing project.

    Permissions:
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER],
        level="WORKSPACE")`` on both methods -- workspace guests
        cannot probe or clean up identifiers.

    Use case:
        The web client calls ``GET`` during project creation to
        validate that the proposed identifier is unique within the
        workspace before issuing the actual project create. ``DELETE``
        cleans up identifier rows that were reserved but never bound
        to a created project; identifiers still in use cannot be
        deleted (HTTP 400).

    Cross-references:
        - Permissions: ``plane.app.permissions.allow_permission``.
        - Models: ``plane.db.models.ProjectIdentifier``, ``plane.db.models.Project``,
          ``plane.db.models.Workspace``.
        - URL registration: ``apps/api/plane/app/urls/project.py``.
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        """Return existence + bound-project information for a workspace project identifier.

        The ``?name=`` query parameter is trimmed and uppercased before
        lookup against :class:`ProjectIdentifier` rows scoped to the
        workspace.
        """
        name = request.GET.get("name", "").strip().upper()

        if name == "":
            return Response({"error": "Name is required"}, status=status.HTTP_400_BAD_REQUEST)

        exists = ProjectIdentifier.objects.filter(name=name, workspace__slug=slug).values("id", "name", "project")

        return Response({"exists": len(exists), "identifiers": exists}, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def delete(self, request, slug):
        """Delete an unbound :class:`ProjectIdentifier` row by name; identifiers still in use return HTTP 400."""
        name = request.data.get("name", "").strip().upper()

        if name == "":
            return Response({"error": "Name is required"}, status=status.HTTP_400_BAD_REQUEST)

        if Project.objects.filter(identifier=name, workspace__slug=slug).exists():
            return Response(
                {"error": "Cannot delete an identifier of an existing project"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ProjectIdentifier.objects.filter(name=name, workspace__slug=slug).delete()

        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectUserViewsEndpoint(BaseAPIView):
    """Persist per-user project preferences on the requester's :class:`ProjectMember` row.

    HTTP methods + URL patterns:
        POST /api/workspaces/<slug>/projects/<project_id>/project-views/

    Request body:
        view_props (JSON, optional): Per-user view configuration
            (current layout, filters, display settings).
        default_props (JSON, optional): Defaults applied when
            creating new entities in this project.
        preferences (JSON, optional): Other per-user toggles (e.g.
            collapsed sidebars).
        sort_order (float, optional): User-controlled project sort
            position in the workspace home navigation.

    Response:
        HTTP 204 on success; HTTP 403 if the requester is not an
        active :class:`ProjectMember`.

    Permissions:
        Inline check: the requesting user must be an active
        :class:`ProjectMember` of the target project. No
        ``@allow_permission`` decorator is applied because this
        endpoint operates on the requester's OWN membership row.

    Cross-references:
        * Models: ``Project``, ``ProjectMember`` in
          ``apps/api/plane/db/models/project.py``.
        * URL registration:
          ``apps/api/plane/app/urls/project.py``.
    """

    def post(self, request, slug, project_id):
        """Upsert the requester's per-project preferences on their :class:`ProjectMember` row.

        Persists ``view_props`` / ``default_props`` / ``preferences`` /
        ``sort_order`` from the request body; only the requester's own
        membership row is mutated.
        """
        project = Project.objects.get(pk=project_id, workspace__slug=slug)

        project_member = ProjectMember.objects.filter(member=request.user, project=project, is_active=True).first()

        if project_member is None:
            return Response({"error": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        view_props = project_member.view_props
        default_props = project_member.default_props
        preferences = project_member.preferences
        sort_order = project_member.sort_order

        project_member.view_props = request.data.get("view_props", view_props)
        project_member.default_props = request.data.get("default_props", default_props)
        project_member.preferences = request.data.get("preferences", preferences)
        project_member.sort_order = request.data.get("sort_order", sort_order)

        project_member.save()

        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectFavoritesViewSet(BaseViewSet):
    """User project favorites managed via :class:`plane.db.models.UserFavorite` rows.

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/user-favorite-projects/                 (``list``, inherited)
        POST   /api/workspaces/<slug>/user-favorite-projects/                 (``create``)
        DELETE /api/workspaces/<slug>/user-favorite-projects/<project_id>/    (``destroy``)

    Request body (POST):
        project (UUID, required): The project id to favorite.

    Response (POST / DELETE):
        HTTP 204 with empty body on success.

    Permissions:
        Default :class:`plane.app.permissions.ProjectBasePermission`
        (inherited). Each favorite row is scoped to
        ``user=request.user`` so favorites are strictly per-user.

    Storage shape:
        :class:`UserFavorite` rows with ``entity_type="project"``,
        ``entity_identifier=<project_id>``,
        ``project_id=<project_id>``, ``user=<request.user>``. Destroy
        performs a hard delete (``delete(soft=False)``) because
        favorite rows have no audit value once removed.

    Queryset filter logic:
        Scoped to ``workspace.slug == kwargs["slug"]`` and
        ``user=request.user`` with related ``project``,
        ``project.project_lead``, ``project.default_assignee``,
        ``workspace``, and ``workspace.owner`` eager-loaded.

    Cross-references:
        * Model: ``UserFavorite`` in
          ``apps/api/plane/db/models/favorite.py``;
          ``Project`` in ``apps/api/plane/db/models/project.py``.
        * Permissions: ``ProjectBasePermission`` in
          ``apps/api/plane/app/permissions/project.py``.
        * URL registration:
          ``apps/api/plane/app/urls/project.py``.
    """

    model = UserFavorite

    def get_queryset(self):
        """Return the requester's ``UserFavorite`` rows for the workspace, with project and workspace eager-loaded."""
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(user=self.request.user)
            .select_related("project", "project__project_lead", "project__default_assignee")
            .select_related("workspace", "workspace__owner")
        )

    def perform_create(self, serializer):
        """Bind the new favorite row to ``user=request.user`` before save."""
        serializer.save(user=self.request.user)

    def create(self, request, slug):
        """Create a :class:`UserFavorite` row for the requester's project favorite (``entity_type='project'``)."""
        _ = UserFavorite.objects.create(
            user=request.user,
            entity_type="project",
            entity_identifier=request.data.get("project"),
            project_id=request.data.get("project"),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    def destroy(self, request, slug, project_id):
        """Hard-delete (``delete(soft=False)``) the requester's project-favorite row."""
        project_favorite = UserFavorite.objects.get(
            entity_identifier=project_id,
            entity_type="project",
            project=project_id,
            user=request.user,
            workspace__slug=slug,
        )
        project_favorite.delete(soft=False)
        return Response(status=status.HTTP_204_NO_CONTENT)


class DeployBoardViewSet(BaseViewSet):
    """Publish a project as a public deploy board (anonymous-readable surface lives in :mod:`plane.space`).

    HTTP methods + URL patterns:
        GET    /api/workspaces/<slug>/projects/<project_id>/project-deploy-boards/       (``list``)
        POST   /api/workspaces/<slug>/projects/<project_id>/project-deploy-boards/       (``create`` -- upsert)
        GET    /api/workspaces/<slug>/projects/<project_id>/project-deploy-boards/<pk>/  (``retrieve``, inherited)
        PATCH  /api/workspaces/<slug>/projects/<project_id>/project-deploy-boards/<pk>/  (``partial_update``, inherited)
        DELETE /api/workspaces/<slug>/projects/<project_id>/project-deploy-boards/<pk>/  (``destroy``, inherited)

    Request body (POST -- effectively upsert via ``get_or_create``):
        is_comments_enabled (bool, optional, default=False): Whether
            anonymous viewers can leave comments on issues in the
            published board.
        is_reactions_enabled (bool, optional, default=False): Whether
            anonymous viewers can react to issues.
        is_votes_enabled (bool, optional, default=False): Whether
            anonymous viewers can vote on issues.
        intake (UUID | None, optional, default=None): Optional
            :class:`Intake` allowing anonymous viewers to submit
            issues.
        views (JSON, optional): Layout visibility map
            ``{"list": bool, "kanban": bool, "calendar": bool,
            "gantt": bool, "spreadsheet": bool}``; defaults to all
            layouts enabled.

    Response shape:
        :class:`plane.app.serializers.DeployBoardSerializer` output.

    Permissions:
        ``permission_classes = [ProjectMemberPermission]`` -- declared on
        the class attribute (see
        :file:`apps/api/plane/app/views/project/base.py`). Defined in
        :class:`plane.app.permissions.project.ProjectMemberPermission`.
        Any active project member can manage the deploy board (the
        anonymous-readable surface itself is served separately by
        :mod:`plane.space`).

    Cross-references:
        - Permissions: ``plane.app.permissions.ProjectMemberPermission``.
        - Serializers: ``plane.app.serializers.DeployBoardSerializer``.
        - Models: ``plane.db.models.DeployBoard``, ``plane.db.models.Project``,
          ``plane.db.models.Intake``.
        - URL registration: ``apps/api/plane/app/urls/project.py``.
    """

    permission_classes = [ProjectMemberPermission]
    serializer_class = DeployBoardSerializer
    model = DeployBoard

    def list(self, request, slug, project_id):
        """Return the project's single :class:`DeployBoard` row.

        Matches on ``entity_name='project'`` for the URL-bound project, or
        returns an empty serializer payload if the project has not been
        published yet.
        """
        project_deploy_board = DeployBoard.objects.filter(
            entity_name="project", entity_identifier=project_id, workspace__slug=slug
        ).first()

        serializer = DeployBoardSerializer(project_deploy_board)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def create(self, request, slug, project_id):
        """Upsert the project's :class:`DeployBoard` row with anonymous-viewer feature flags.

        Uses ``DeployBoard.objects.get_or_create`` keyed by
        ``entity_name='project'`` so re-calling this endpoint reconfigures
        the existing board rather than creating a duplicate.
        """
        comments = request.data.get("is_comments_enabled", False)
        reactions = request.data.get("is_reactions_enabled", False)
        intake = request.data.get("intake", None)
        votes = request.data.get("is_votes_enabled", False)
        views = request.data.get(
            "views",
            {
                "list": True,
                "kanban": True,
                "calendar": True,
                "gantt": True,
                "spreadsheet": True,
            },
        )

        project_deploy_board, _ = DeployBoard.objects.get_or_create(
            entity_name="project", entity_identifier=project_id, project_id=project_id
        )
        project_deploy_board.intake = intake
        project_deploy_board.view_props = views
        project_deploy_board.is_votes_enabled = votes
        project_deploy_board.is_comments_enabled = comments
        project_deploy_board.is_reactions_enabled = reactions

        project_deploy_board.save()

        serializer = DeployBoardSerializer(project_deploy_board)
        return Response(serializer.data, status=status.HTTP_200_OK)
