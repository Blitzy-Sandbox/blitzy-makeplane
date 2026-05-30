# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Invitation-to-membership reconciliation for Plane authentication flows.

Provides :func:`process_workspace_project_invitations`, the routine called
by the post-auth workflow hook immediately after a user signs in or signs
up. It converts any accepted :class:`WorkspaceMemberInvite` and
:class:`ProjectMemberInvite` rows targeting the user's email into durable
:class:`WorkspaceMember` and :class:`ProjectMember` records, then deletes
the consumed invitations.

Async infrastructure notes:

* The module enqueues a ``user_joined_workspace`` analytics event via
  :meth:`track_event.delay`, which routes through **Celery + RabbitMQ**
  (Celery is the task framework; RabbitMQ is the broker). It is NOT a
  Redis-based queue.
* The module invalidates Redis-backed workspace-member API cache entries
  via :func:`invalidate_cache_directly`. Redis is used in this project
  for caching and session storage only -- never for task queueing.

Migrator startup contract: the module reads the invite and membership
tables at request time and assumes the ``migrator`` container has already
advanced the database to the target schema revision before the API
service started.
"""

# Django imports
from django.utils import timezone

# Module imports
from plane.db.models import (
    ProjectMember,
    ProjectMemberInvite,
    WorkspaceMember,
    WorkspaceMemberInvite,
)
from plane.utils.cache import invalidate_cache_directly
from plane.bgtasks.event_tracking_task import track_event
from plane.utils.analytics_events import USER_JOINED_WORKSPACE


def process_workspace_project_invitations(user):
    """Convert accepted workspace and project invitations into durable memberships.

    For the given ``user``, queries accepted
    :class:`WorkspaceMemberInvite` and :class:`ProjectMemberInvite` rows
    matching their email address and materializes them into durable
    :class:`WorkspaceMember` and :class:`ProjectMember` records. The
    consumed invitation rows are deleted at the end of the routine.

    Side effects (in source order):

      1. Queries ``WorkspaceMemberInvite.objects.filter(email=user.email,
         accepted=True)`` and bulk-creates a :class:`WorkspaceMember` for
         each invite with ``ignore_conflicts=True`` (so re-runs are
         idempotent against the unique constraint on
         ``workspace_id, member``).
      2. For each accepted workspace invite:
           * Invalidates the Redis-backed workspace-member API cache via
             :func:`invalidate_cache_directly` at the path
             ``/api/workspaces/<slug>/members/`` so the next member-list
             read does not return a stale snapshot. (Redis here is
             caching only -- never used for task queueing.)
           * Enqueues a ``USER_JOINED_WORKSPACE`` analytics event via
             :meth:`track_event.delay`. This routes through
             **Celery + RabbitMQ** (Celery is the task framework;
             RabbitMQ is the broker) -- NOT through Redis. The event
             payload carries ``user_id``, ``workspace_id``,
             ``workspace_slug``, ``role``, and the ISO-formatted
             ``joined_at`` timestamp.
      3. Queries ``ProjectMemberInvite.objects.filter(email=user.email,
         accepted=True)`` and, for each invite, bulk-creates BOTH:
           * A :class:`WorkspaceMember` (the user must be a workspace
             member to be a project member) with the role *normalized*
             to either the original role if it is 5 (Guest) or 15
             (Member), otherwise coerced to 15 (Member). This
             deliberately downgrades Admin (20) invites so that
             arriving via a project invite cannot escalate to workspace
             Admin. (See ``ROLE_CHOICES`` in
             ``plane.db.models.workspace``: 20=Admin, 15=Member,
             5=Guest.)
           * A :class:`ProjectMember` with the same normalized role.
         Both bulk-creates use ``ignore_conflicts=True`` to remain
         idempotent against existing membership rows.
      4. Deletes the consumed ``workspace_member_invites`` and
         ``project_member_invites`` querysets so the same invitations
         are never re-processed.

    Idempotency: the routine is idempotent for the membership writes
    (``ignore_conflicts=True`` on both bulk-creates and the terminal
    invite deletion clears the trigger), but the analytics emission via
    :meth:`track_event.delay` is **not** idempotent -- re-running the
    routine after fresh invites are inserted will emit duplicate
    ``USER_JOINED_WORKSPACE`` events. In practice the routine is invoked
    exactly once per authentication completion via
    :func:`plane.authentication.utils.user_auth_workflow.post_user_auth_workflow`,
    which is the only call site.

    Args:
        user: The authenticated :class:`plane.db.models.User` instance
            whose invitations are being reconciled.

    Returns:
        None. All side effects are performed against the database, the
        Redis cache, and the Celery + RabbitMQ analytics pipeline.
    """
    # Check if user has any accepted invites for workspace and add them to workspace
    workspace_member_invites = WorkspaceMemberInvite.objects.filter(email=user.email, accepted=True)

    WorkspaceMember.objects.bulk_create(
        [
            WorkspaceMember(
                workspace_id=workspace_member_invite.workspace_id,
                member=user,
                role=workspace_member_invite.role,
            )
            for workspace_member_invite in workspace_member_invites
        ],
        ignore_conflicts=True,
    )

    for workspace_member_invite in workspace_member_invites:
        invalidate_cache_directly(
            path=f"/api/workspaces/{str(workspace_member_invite.workspace.slug)}/members/",
            url_params=False,
            user=False,
            multiple=True,
        )
        track_event.delay(
            user_id=user.id,
            event_name=USER_JOINED_WORKSPACE,
            slug=workspace_member_invite.workspace.slug,
            event_properties={
                "user_id": user.id,
                "workspace_id": workspace_member_invite.workspace.id,
                "workspace_slug": workspace_member_invite.workspace.slug,
                "role": workspace_member_invite.role,
                "joined_at": str(timezone.now().isoformat()),
            },
        )

    # Check if user has any project invites
    project_member_invites = ProjectMemberInvite.objects.filter(email=user.email, accepted=True)

    # Add user to workspace
    WorkspaceMember.objects.bulk_create(
        [
            WorkspaceMember(
                workspace_id=project_member_invite.workspace_id,
                role=(project_member_invite.role if project_member_invite.role in [5, 15] else 15),
                member=user,
                created_by_id=project_member_invite.created_by_id,
            )
            for project_member_invite in project_member_invites
        ],
        ignore_conflicts=True,
    )

    # Now add the users to project
    ProjectMember.objects.bulk_create(
        [
            ProjectMember(
                workspace_id=project_member_invite.workspace_id,
                role=(project_member_invite.role if project_member_invite.role in [5, 15] else 15),
                member=user,
                created_by_id=project_member_invite.created_by_id,
            )
            for project_member_invite in project_member_invites
        ],
        ignore_conflicts=True,
    )

    # Delete all the invites
    workspace_member_invites.delete()
    project_member_invites.delete()
