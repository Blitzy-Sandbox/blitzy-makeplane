# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Project workflow-state CRUD and triage-state lookup endpoints.

Every issue in a project carries a foreign key to a :class:`plane.db.models.State`
row; states are project-scoped and partitioned into one of five user-visible
``StateGroup`` values -- ``backlog``, ``unstarted``, ``started``, ``completed``,
``cancelled`` -- plus an internal ``triage`` group that is hidden from the
main CRUD endpoint and exposed only via :class:`IntakeStateEndpoint`. States
are ordered within their group by the ``sequence`` float column, and exactly
one state per project may carry ``default=True``.

Exports two public view classes:

* :class:`StateViewSet` -- list / create / partial_update / destroy for the
  five non-triage groups, plus a ``mark_as_default`` action that flips the
  per-project default flag.
* :class:`IntakeStateEndpoint` -- read-only GET for the project's triage
  state (used by the intake / inbox workflow).
"""

# Python imports
from itertools import groupby
from collections import defaultdict

# Django imports
from django.db.utils import IntegrityError

# Third party imports
from rest_framework.response import Response
from rest_framework import status

# Module imports
from .. import BaseViewSet, BaseAPIView
from plane.app.serializers import StateSerializer
from plane.app.permissions import ROLE, allow_permission
from plane.db.models import State, Issue
from plane.utils.cache import invalidate_cache


class StateViewSet(BaseViewSet):
    """CRUD endpoint for project workflow states (non-triage).

    Resource managed:
        :class:`plane.db.models.State` rows in one of the five user-visible
        ``StateGroup`` values: ``backlog``, ``unstarted``, ``started``,
        ``completed``, ``cancelled``. The sixth group, ``triage``, is
        excluded by ``get_queryset`` and by every action's filter clause;
        triage-state reads are served by :class:`IntakeStateEndpoint`
        instead.

    HTTP methods + URL patterns (from ``plane.app.urls.state``):
        GET    /api/workspaces/<slug>/projects/<project_id>/states/
        POST   /api/workspaces/<slug>/projects/<project_id>/states/
        GET    /api/workspaces/<slug>/projects/<project_id>/states/<uuid:pk>/
        PATCH  /api/workspaces/<slug>/projects/<project_id>/states/<uuid:pk>/
        DELETE /api/workspaces/<slug>/projects/<project_id>/states/<uuid:pk>/
        POST   /api/workspaces/<slug>/projects/<project_id>/states/<uuid:pk>/mark-default/

    Request body (POST / PATCH):
        name (str, required): State display name; must be unique per project.
        color (str, required): Hex color string (e.g. ``"#60646C"``); stored
            on :class:`State.color`.
        group (str, required): One of ``"backlog"``, ``"unstarted"``,
            ``"started"``, ``"completed"``, ``"cancelled"``. The serializer
            rejects ``"triage"`` with HTTP 400 (see
            :meth:`plane.app.serializers.state.StateSerializer.validate`).
        description (str, optional): Free-form text; defaults to ``""``.
        sequence (float, optional): Ordering within the group; on insert,
            :meth:`State.save` auto-computes ``max(sequence) + 15000`` when
            omitted.

    Response shape (GET list / retrieve / POST / PATCH):
        :class:`plane.app.serializers.state.StateSerializer` payload with
        fields ``id``, ``project_id``, ``workspace_id``, ``name``, ``color``,
        ``group``, ``default``, ``description``, ``sequence``, plus a
        view-computed ``order`` (float in (0, 1]) when returned via
        :meth:`list`. ``workspace`` and ``project`` are read-only in the
        serializer.

    Response shape (GET list with ``?grouped=true``):
        A dict keyed by ``group`` whose values are lists of
        :class:`StateSerializer` payloads sorted by group name.

    Response shape (DELETE / mark_as_default):
        HTTP 204 No Content.

    Permissions:
        Class-level ``permission_classes`` is inherited from
        :class:`plane.app.views.base.BaseViewSet` as ``[IsAuthenticated]``;
        per-method role gating is applied via the
        :func:`plane.app.permissions.allow_permission` decorator:

        * ``create`` / ``destroy`` / ``mark_as_default`` -- ``[ROLE.ADMIN]``
        * ``list`` / ``partial_update`` -- ``[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST]``

        Workspace admins are implicitly granted access regardless of their
        project role (see :func:`allow_permission` fallback branch).

    Cache invalidation:
        ``create``, ``destroy``, and ``mark_as_default`` are wrapped in
        :func:`plane.utils.cache.invalidate_cache` against the path
        ``"workspaces/:slug/states/"`` (with URL kwargs substituted) so any
        cached list response for the workspace is evicted on every mutation.
        Redis here is used purely as a cache; task queueing for Plane
        flows through Celery + RabbitMQ.

    Queryset filter logic (``get_queryset``):
        Scopes to the URL's ``workspace.slug`` and ``project_id``, requires
        the requesting user to be an *active* project member of a non-archived
        project, excludes triage states, eager-loads ``project`` and
        ``workspace``, and applies ``.distinct()`` to dedupe the membership
        join.

    Cross-references:
        * Serializer: ``StateSerializer`` in
          ``apps/api/plane/app/serializers/state.py``.
        * Model: ``State``, ``StateGroup`` in
          ``apps/api/plane/db/models/state.py``.
        * Permissions: ``allow_permission`` decorator in
          ``apps/api/plane/app/permissions/base.py``.
        * Cache invalidation: ``invalidate_cache`` in
          ``apps/api/plane/utils/cache.py``.
        * URL registration:
          ``apps/api/plane/app/urls/state.py``.
    """

    serializer_class = StateSerializer
    model = State

    def get_queryset(self):
        """Return non-triage states scoped to the URL workspace/project for active members of unarchived projects.

        Filters in order: ``workspace__slug = kwargs["slug"]`` ->
        ``project_id = kwargs["project_id"]`` -> requesting user is an
        active :class:`ProjectMember` of a non-archived project ->
        ``is_triage = False``. Eager-loads ``project`` and ``workspace``
        via ``select_related`` and applies ``.distinct()`` to dedupe the
        membership join.
        """
        return self.filter_queryset(
            super()
            .get_queryset()
            .filter(workspace__slug=self.kwargs.get("slug"))
            .filter(project_id=self.kwargs.get("project_id"))
            .filter(
                project__project_projectmember__member=self.request.user,
                project__project_projectmember__is_active=True,
                project__archived_at__isnull=True,
            )
            .filter(is_triage=False)
            .select_related("project")
            .select_related("workspace")
            .distinct()
        )

    @invalidate_cache(path="workspaces/:slug/states/", url_params=True, user=False)
    @allow_permission([ROLE.ADMIN])
    def create(self, request, slug, project_id):
        """Create a new project state and return the serialized record.

        Admin-only. Validates the payload with
        :class:`StateSerializer` (which rejects ``group="triage"``),
        persists with ``project_id`` bound from the URL, and translates
        the ``IntegrityError`` raised on duplicate ``(name, project)``
        into a friendly HTTP 400 ``{"name": "The state name is already
        taken"}`` response.
        """
        try:
            serializer = StateSerializer(data=request.data)
            if serializer.is_valid():
                serializer.save(project_id=project_id)
                return Response(serializer.data, status=status.HTTP_200_OK)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError as e:
            if "already exists" in str(e):
                return Response(
                    {"name": "The state name is already taken"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def partial_update(self, request, slug, project_id, pk):
        """Apply a partial update to the state identified by ``pk`` within the URL's workspace and project.

        Admin / Member / Guest. Fetches the state directly (bypassing
        ``get_queryset`` so triage states cannot be PATCHed here either,
        because the ``StateSerializer.validate`` guard rejects
        ``group="triage"``) and runs a partial-update serializer save.
        Duplicate-name ``IntegrityError`` is translated to HTTP 400
        ``{"name": "The state name is already taken"}``.
        """
        try:
            state = State.objects.get(pk=pk, project_id=project_id, workspace__slug=slug)
            serializer = StateSerializer(state, data=request.data, partial=True)
            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data, status=status.HTTP_200_OK)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError as e:
            if "already exists" in str(e):
                return Response(
                    {"name": "The state name is already taken"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def list(self, request, slug, project_id):
        """List non-triage states for the scoped project, with per-group ordering and optional grouping.

        Admin / Member / Guest. Serializes :meth:`get_queryset`, then
        annotates each state with a view-computed ``order`` field
        (``index / count`` per group, so ``order`` is a normalized
        position in ``(0, 1]``). When the request supplies
        ``?grouped=true``, the response is a dict keyed by ``group`` with
        states sorted by ``group`` name; otherwise the response is a flat
        list. ``order`` is **not** persisted -- it is recomputed every
        request.
        """
        states = StateSerializer(self.get_queryset(), many=True).data

        grouped_states = defaultdict(list)
        for state in states:
            grouped_states[state["group"]].append(state)

        for group, group_states in grouped_states.items():
            count = len(group_states)

            for index, state in enumerate(group_states, start=1):
                state["order"] = index / count

        grouped = request.GET.get("grouped", False)

        if grouped == "true":
            state_dict = {}
            for key, value in groupby(
                sorted(states, key=lambda state: state["group"]),
                lambda state: state.get("group"),
            ):
                state_dict[str(key)] = list(value)
            return Response(state_dict, status=status.HTTP_200_OK)

        return Response(states, status=status.HTTP_200_OK)

    @invalidate_cache(path="workspaces/:slug/states/", url_params=True, user=False)
    @allow_permission([ROLE.ADMIN])
    def mark_as_default(self, request, slug, project_id, pk):
        """Atomically swap the per-project default state to the one identified by ``pk``.

        Admin-only. Clears ``default=True`` on every state in the scoped
        workspace/project and then sets ``default=True`` on the target
        ``pk`` in a separate UPDATE. The two updates are NOT wrapped in
        a transaction -- a concurrent failure between the two statements
        could leave the project with zero defaults; this is the
        historical behavior and is intentionally preserved.
        """
        # Select all the states which are marked as default
        _ = State.objects.filter(workspace__slug=slug, project_id=project_id, default=True).update(default=False)
        _ = State.objects.filter(workspace__slug=slug, project_id=project_id, pk=pk).update(default=True)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @invalidate_cache(path="workspaces/:slug/states/", url_params=True, user=False)
    @allow_permission([ROLE.ADMIN])
    def destroy(self, request, slug, project_id, pk):
        """Delete a non-triage, non-default, issue-free state.

        Admin-only. Three guard clauses, in order:

        1. The target must be a non-triage state in the URL's
           workspace/project (``is_triage=False`` is hard-coded into the
           lookup so calling destroy on a triage ``pk`` raises
           ``DoesNotExist`` -> HTTP 404).
        2. ``state.default`` must be False -- the project's default
           cannot be deleted (HTTP 400 ``{"error": "Default state cannot
           be deleted"}``).
        3. No :class:`plane.db.models.Issue` may reference this state --
           if any exist, HTTP 400 ``{"error": "The state is not empty,
           only empty states can be deleted"}``. This is an O(1)
           ``EXISTS`` check, not an O(n) count.

        On success, hard-deletes the row and returns HTTP 204.
        """
        state = State.objects.get(is_triage=False, pk=pk, project_id=project_id, workspace__slug=slug)

        if state.default:
            return Response(
                {"error": "Default state cannot be deleted"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check for any issues in the state
        issue_exist = Issue.objects.filter(state=pk).exists()

        if issue_exist:
            return Response(
                {"error": "The state is not empty, only empty states can be deleted"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        state.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class IntakeStateEndpoint(BaseAPIView):
    """Read-only lookup for the project's triage state.

    Resource managed:
        The single :class:`plane.db.models.State` row with
        ``group="triage"`` for the scoped project. Triage states are
        seeded automatically when a project's intake feature is enabled
        and are intentionally invisible to :class:`StateViewSet`'s CRUD
        endpoints.

    HTTP methods + URL pattern:
        GET /api/workspaces/<slug>/projects/<project_id>/intake-state/

    Request body:
        None.

    Response shape:
        On success: :class:`StateSerializer` payload for the triage state.
        On miss:    HTTP 404 ``{"error": "Triage state not found"}``.

    Permissions:
        Class-level ``permission_classes`` is inherited from
        :class:`plane.app.views.base.BaseAPIView` as ``[IsAuthenticated]``;
        the ``get`` method additionally gates via
        ``@allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])`` so
        every project member can read the triage state.

    Queryset:
        ``State.triage_objects`` (the
        :class:`plane.db.models.state.TriageStateManager`) implicitly
        filters ``group=triage`` so this endpoint cannot accidentally
        return a non-triage state.

    Cross-references:
        * Serializer: ``StateSerializer`` in
          ``apps/api/plane/app/serializers/state.py``.
        * Model: ``State`` (``triage_objects`` manager) in
          ``apps/api/plane/db/models/state.py``.
        * Permissions: ``allow_permission`` decorator in
          ``apps/api/plane/app/permissions/base.py``.
        * URL registration:
          ``apps/api/plane/app/urls/state.py``.
    """

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        """Return the project's triage state, or HTTP 404 if none is provisioned yet.

        Uses the ``State.triage_objects`` manager (which filters
        ``group="triage"``) so non-triage states cannot leak through this
        endpoint even if a workspace has misconfigured rows.
        """
        state = State.triage_objects.filter(workspace__slug=slug, project_id=project_id).first()
        if not state:
            return Response(
                {"error": "Triage state not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(StateSerializer(state).data, status=status.HTTP_200_OK)
