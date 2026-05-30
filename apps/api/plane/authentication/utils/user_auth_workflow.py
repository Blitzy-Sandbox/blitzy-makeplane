# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Post-authentication workflow hook for Plane.

Thin coordination layer invoked immediately after a user is successfully
authenticated (sign-in or sign-up). Its sole responsibility is to delegate
to :func:`plane.authentication.utils.workspace_project_join.process_workspace_project_invitations`
so that any pending workspace and project invitations the user has already
accepted are reconciled into durable membership records (with the associated
cache invalidation and analytics emission performed by the delegate).

This module exists as a separate hook so that the authentication views never
import the invitation-processing code path directly; the indirection keeps
auth flows decoupled from the invitation reconciliation implementation.
"""

from .workspace_project_join import process_workspace_project_invitations


def post_user_auth_workflow(user, is_signup, request):
    """Run post-authentication side effects for a freshly authenticated user.

    Currently delegates entirely to
    :func:`plane.authentication.utils.workspace_project_join.process_workspace_project_invitations`,
    converting any of the user's accepted invitations into durable
    workspace/project memberships. The ``is_signup`` and ``request``
    parameters are accepted but not consumed by the current implementation;
    they are kept as call-site contract so callers in the authentication
    views (sign-in, sign-up, OAuth callbacks, magic-link, etc.) can invoke
    this hook uniformly without conditional argument construction.

    Args:
        user: The :class:`plane.db.models.User` instance that has just
            completed authentication.
        is_signup (bool): Truthy when this invocation follows a sign-up
            flow rather than a sign-in flow. Currently unused; preserved
            as part of the post-auth pipeline contract.
        request: The Django/DRF request object that initiated the auth
            flow. Currently unused; preserved as part of the post-auth
            pipeline contract.

    Returns:
        None. Side effects (DB writes, cache invalidation, Celery task
        enqueueing) are produced by the delegate.
    """
    process_workspace_project_invitations(user=user)
