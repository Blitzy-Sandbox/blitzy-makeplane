# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Post-login redirect destination resolver for Plane.

Provides :func:`get_redirection_path`, the single decision point that maps
an authenticated user to a frontend route after sign-in/sign-up. Resolution
consults the user's :class:`plane.db.models.Profile`, the
:class:`plane.db.models.Workspace` membership state, and any pending
:class:`plane.db.models.WorkspaceMemberInvite` rows.

Migrator startup contract (per AAP §0.2.2): this module reads schema-bound
state at request time and therefore assumes the ``migrator`` container has
already advanced the database to the target schema revision before any API
service starts; the function does not guard against missing tables or
columns.
"""

from plane.db.models import Profile, Workspace, WorkspaceMemberInvite


def get_redirection_path(user):
    """Resolve the frontend route to redirect ``user`` to after authentication.

    Picks the first applicable destination in this fixed priority order:

      1. ``"onboarding"`` — if the user's :class:`Profile` is not yet
         marked ``is_onboarded``. The :class:`Profile` row is created
         on-the-fly via :meth:`get_or_create` if it does not yet exist;
         this is the function's only persistence side effect.
      2. ``"<workspace_slug>"`` — if ``profile.last_workspace_id`` points
         at a workspace where the user has an active
         :class:`WorkspaceMember` row. The slug is the destination.
      3. ``"<fallback_workspace_slug>"`` — otherwise the slug of the
         earliest-created workspace where the user has an active
         :class:`WorkspaceMember` row.
      4. ``"invitations"`` — if the user has any
         :class:`WorkspaceMemberInvite` rows matching their email
         address (the filter is on email only; pending and accepted
         invites both count).
      5. ``"create-workspace"`` — the terminal fallback when none of the
         above apply.

    Args:
        user: The authenticated :class:`plane.db.models.User` instance
            whose post-auth landing route is being resolved.

    Returns:
        str: A frontend route token — either a literal route name
        (``"onboarding"``, ``"invitations"``, ``"create-workspace"``) or
        a workspace slug to be interpreted as ``"/<slug>/"``.
    """
    # Handle redirections
    profile, _ = Profile.objects.get_or_create(user=user)

    # Redirect to onboarding if the user is not onboarded yet
    if not profile.is_onboarded:
        return "onboarding"

    # Redirect to the last workspace if the user has last workspace
    if (
        profile.last_workspace_id
        and Workspace.objects.filter(
            pk=profile.last_workspace_id,
            workspace_member__member_id=user.id,
            workspace_member__is_active=True,
        ).exists()
    ):
        workspace = Workspace.objects.filter(
            pk=profile.last_workspace_id,
            workspace_member__member_id=user.id,
            workspace_member__is_active=True,
        ).first()
        return f"{workspace.slug}"

    fallback_workspace = (
        Workspace.objects.filter(workspace_member__member_id=user.id, workspace_member__is_active=True)
        .order_by("created_at")
        .first()
    )
    # Redirect to fallback workspace
    if fallback_workspace:
        return f"{fallback_workspace.slug}"

    # Redirect to invitations if the user has unaccepted invitations
    if WorkspaceMemberInvite.objects.filter(email=user.email).count():
        return "invitations"

    # Redirect the user to create workspace
    return "create-workspace"
