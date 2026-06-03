# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Serializers for intake-workflow payloads in the ``plane.space`` package.

Defines three DRF :class:`~rest_framework.serializers.ModelSerializer`
subclasses that shape intake submissions on the published deploy-board
surface (``plane.space``, mounted under ``api/public/``):

* :class:`IntakeIssueSerializer` -- full ``IntakeIssue`` payload with the
  nested ``issue_detail`` and ``project_detail`` read-only projections;
  ``project`` and ``workspace`` are write-protected so they cannot be
  rebound from the request body (ownership is resolved server-side from
  the deploy-board anchor in the URL).
* :class:`IntakeIssueLiteSerializer` -- compact, fully read-only intake
  projection used to embed intake status inside larger issue responses
  without N+1 fan-out across :class:`IntakeIssue` rows.
* :class:`IssueStateIntakeSerializer` -- ``Issue`` payload enriched with
  nested state, project, label, and assignee projections plus the intake
  bridge linkage (``bridge_id``) and a per-issue sub-issue count, designed
  for intake list endpoints that need to render one combined row per issue.

All three classes are READ-ORIENTED: no ``create``, ``update``, or
``validate*`` overrides are defined; the field declarations alone define
the response shape. Intake write orchestration (duplicate detection,
snooze, accept/decline) lives in the consuming view's HTTP method handlers
on the published-board surface, not in this module.

Because the published-board endpoints they are named for serve the
unauthenticated ``api/public/`` read surface, the write-protected
(``project``, ``workspace``) and fully read-only (lite) field choices
encode that security boundary: no anonymous caller may rebind intake
items across projects or workspaces through these serializers.

Module-relationship note:
    At the time of writing, none of the three classes defined here are
    imported by any other module in the codebase. The same class names
    exist in :mod:`plane.app.serializers.intake`, and the live view
    :class:`plane.space.views.intake.IntakeIssuePublicViewSet` resolves
    those names against ``plane.app.serializers`` rather than against
    this module. This file therefore acts as a parallel definition that
    mirrors the published-board package layout but is not on a live
    import path. The naming convention preserves the expected
    :mod:`plane.space.serializer.intake` namespace for callers that
    would route through the ``plane.space`` package rather than through
    ``plane.app``.
"""

# INTENT UNCLEAR: the three classes below are defined but not currently
# imported anywhere; the live published-board view resolves the same
# names from :mod:`plane.app.serializers.intake` instead. See the
# module-relationship note in the module docstring above for details.

# Third Party imports
from rest_framework import serializers

# Module imports
from .base import BaseSerializer
from .user import UserLiteSerializer
from .state import StateLiteSerializer
from .project import ProjectLiteSerializer
from .issue import IssueFlatSerializer, LabelLiteSerializer
from plane.db.models import Issue, IntakeIssue


class IntakeIssueSerializer(BaseSerializer):
    """Full ``IntakeIssue`` payload with nested issue and project projections.

    Serializes :class:`plane.db.models.IntakeIssue` with the entire field
    surface (``fields = "__all__"``) so intake callers can receive the
    complete intake record -- status, snooze deadline, duplicate linkage,
    source, and audit fields -- alongside two inlined read-only projections
    that save the client one round-trip per row.

    Nested read-only projections (computed at serialization time from the
    related foreign keys):
        * ``issue_detail`` -- :class:`plane.space.serializer.issue.IssueFlatSerializer`
          sourced from the ``issue`` FK; provides the flat issue identity,
          description, scheduling, priority, and draft state for rendering
          the intake row without a follow-up ``GET /issues/<id>/`` call.
        * ``project_detail`` -- :class:`plane.space.serializer.project.ProjectLiteSerializer`
          sourced from the ``project`` FK; provides the project display
          metadata (id, identifier, name, cover, icon, emoji) needed to
          render the published board header.

    Write-protected fields (``read_only_fields = ["project", "workspace"]``):
        ``project`` and ``workspace`` ownership is resolved server-side from
        the deploy-board anchor in the URL path on every request; accepting
        either field from the request body would let an anonymous caller
        rebind an intake item to a different project or workspace. They are
        therefore declared read-only at the serializer layer as a defense
        in depth on top of the view-layer permission checks.

    This serializer is READ-ORIENTED by construction; no ``create``,
    ``update``, or ``validate*`` overrides are defined here. Any intake
    write orchestration (duplicate detection, snooze handling,
    ``IntakeIssue`` row creation) is performed by the consuming view's
    HTTP method handlers, not by this serializer.

    Consumers:
        No module currently imports this class -- the live published-board
        view :class:`plane.space.views.intake.IntakeIssuePublicViewSet`
        resolves the same name against :mod:`plane.app.serializers.intake`
        instead. See the module-relationship note in the module docstring
        for the full picture; the class is preserved here on the
        ``plane.space.serializer.intake`` namespace for callers that
        would route through the ``plane.space`` package rather than
        through ``plane.app``.
    """

    issue_detail = IssueFlatSerializer(source="issue", read_only=True)
    project_detail = ProjectLiteSerializer(source="project", read_only=True)

    class Meta:
        """DRF :class:`ModelSerializer` binding to :class:`IntakeIssue` with project/workspace write-protected."""

        model = IntakeIssue
        fields = "__all__"
        read_only_fields = ["project", "workspace"]


class IntakeIssueLiteSerializer(BaseSerializer):
    """Compact ``IntakeIssue`` projection for embedding in larger payloads.

    Serializes :class:`plane.db.models.IntakeIssue` with a deliberately
    narrow, fully read-only field set so intake status can be inlined inside
    a parent issue payload without exposing the full intake record and
    without forcing the client to make a follow-up ``GET /intake-issues/``
    call per row.

    Fields exposed (all read-only via ``read_only_fields = fields``):
        * ``id`` -- stable key for client-side intake-row de-duplication.
        * ``status`` -- triage state (pending / accepted / declined /
          duplicate / snoozed) used to badge the issue row on the published
          board.
        * ``duplicate_to`` -- FK to the canonical ``Issue`` when ``status``
          flags this row as a duplicate; lets the UI link straight through.
        * ``snoozed_till`` -- the wake-up timestamp when ``status`` is
          snoozed; the UI uses it to hide rows until the deadline elapses.
        * ``source`` -- free-form text identifying the intake origin (form,
          email, API, etc.) for triage attribution.

    Fields intentionally NOT exposed: ``project`` / ``workspace`` ownership,
    audit timestamps, and the originating ``issue`` FK -- these are
    redundant when this projection is embedded inside an :class:`Issue`
    payload (the parent already carries them) and shipping them would
    cause payload bloat and N+1 read amplification on intake list responses.

    Consumers:
        * Embedded as ``issue_intake`` (``many=True``, ``read_only=True``)
          inside :class:`IssueStateIntakeSerializer` below to inline intake
          metadata on every row of the intake-issue listing endpoint.

    This is a READ-ONLY projection by construction; the lite shape exists
    solely to suppress N+1 over-fetching when the parent issue response
    needs to carry intake status. Intake writes flow through the full
    :class:`IntakeIssueSerializer` and its consuming view.
    """

    class Meta:
        """DRF :class:`ModelSerializer` binding the lite ``IntakeIssue`` projection; every listed field is read-only."""

        model = IntakeIssue
        fields = ["id", "status", "duplicate_to", "snoozed_till", "source"]
        read_only_fields = fields


class IssueStateIntakeSerializer(BaseSerializer):
    """``Issue`` payload enriched with state, project, labels, assignees, and intake linkage.

    Serializes :class:`plane.db.models.Issue` with the entire field surface
    (``fields = "__all__"``) plus seven read-only inlined extensions, so a
    single response can carry every cross-table fact the published board UI
    needs to render an intake row -- no follow-up calls required.

    Nested read-only projections (sourced from the related foreign keys):
        * ``state_detail`` -- :class:`plane.space.serializer.state.StateLiteSerializer`
          sourced from the ``state`` FK; inlines workflow-state identity
          (id, name, color, group) for the status pill on each row.
        * ``project_detail`` -- :class:`plane.space.serializer.project.ProjectLiteSerializer`
          sourced from the ``project`` FK; inlines project display metadata
          needed by the board header.
        * ``label_details`` -- :class:`plane.space.serializer.issue.LabelLiteSerializer`
          sourced from the ``labels`` M2M (``many=True``); inlines the
          ``(id, name, color)`` of every label attached to the issue.
        * ``assignee_details`` -- :class:`plane.space.serializer.user.UserLiteSerializer`
          sourced from the ``assignees`` M2M (``many=True``); inlines the
          narrow ``User`` projection (id, names, avatar, is_bot) per
          assignee while keeping email/PII off the anonymous surface.
        * ``issue_intake`` -- :class:`IntakeIssueLiteSerializer`
          (``many=True``); inlines every ``IntakeIssue`` row linked to this
          issue so the UI sees triage status, snooze deadline, and source
          alongside the issue payload.

    Read-only computed fields (NOT computed by this serializer -- expected
    to be annotated on the queryset by whichever view consumes this class):
        * ``sub_issues_count`` -- :class:`rest_framework.serializers.IntegerField`
          populated by an upstream ``.annotate(sub_issues_count=...)``
          counting child issues with ``parent=OuterRef("id")``. Reading
          this field on an instance NOT produced by an annotated queryset
          will fall through to the model attribute and raise
          :class:`AttributeError`; this serializer is tightly coupled to
          the queryset shape its caller passes in.
        * ``bridge_id`` -- :class:`rest_framework.serializers.UUIDField`
          populated by an upstream
          ``.annotate(bridge_id=F("issue_intake__id"))`` exposing the
          linking :class:`IntakeIssue` row id; lets the client jump from
          the issue back to the originating intake row without a follow-up
          join. Same queryset-coupling caveat as above.

    No ``read_only_fields`` is declared on ``Meta`` because every extension
    field above already passes ``read_only=True`` at the field declaration
    site, and the serializer is intended for read-only response shaping
    rather than for write paths.

    This serializer is READ-ONLY by construction; no ``create``/``update``
    overrides exist. Intake-flow mutations are performed by the consuming
    view's HTTP method handlers, not here.

    Consumers:
        No module currently imports this class -- the same-named
        :class:`IssueStateIntakeSerializer` in
        :mod:`plane.app.serializers.intake` is the one wired into the
        live published-board view
        :class:`plane.space.views.intake.IntakeIssuePublicViewSet`. See
        the module-relationship note in the module docstring for the
        full picture; the class is preserved here on the
        ``plane.space.serializer.intake`` namespace for callers that
        would route through the ``plane.space`` package rather than
        through ``plane.app``.
    """

    state_detail = StateLiteSerializer(read_only=True, source="state")
    project_detail = ProjectLiteSerializer(read_only=True, source="project")
    label_details = LabelLiteSerializer(read_only=True, source="labels", many=True)
    assignee_details = UserLiteSerializer(read_only=True, source="assignees", many=True)
    sub_issues_count = serializers.IntegerField(read_only=True)
    bridge_id = serializers.UUIDField(read_only=True)
    issue_intake = IntakeIssueLiteSerializer(read_only=True, many=True)

    class Meta:
        """Bind to :class:`Issue` exposing the full field surface for intake list payloads."""

        model = Issue
        fields = "__all__"
