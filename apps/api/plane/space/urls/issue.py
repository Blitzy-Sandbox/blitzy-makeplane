# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URL patterns for issue interaction features on public space (deploy board) boards.

Declares anchor-scoped, UUID-driven routes that expose issue retrieval,
comments, reactions, and votes on published deploy boards to anonymous
visitors via five public viewsets / endpoints:

- ``workspace-project-boards`` -- ``anchor/<str:anchor>/issues/<uuid:issue_id>/``
  bound to ``IssueRetrievePublicEndpoint.as_view()``.
- ``issue-comments-project-board`` (collection / detail) --
  ``anchor/<str:anchor>/issues/<uuid:issue_id>/comments/`` and
  ``.../comments/<uuid:pk>/`` via
  ``IssueCommentPublicViewSet.as_view({"get": "list", "post": "create"})`` and
  ``{"get": "retrieve", "patch": "partial_update", "delete": "destroy"}``.
- ``issue-reactions-project-board`` (collection / detail) --
  ``anchor/<str:anchor>/issues/<uuid:issue_id>/reactions/`` and
  ``.../reactions/<str:reaction_code>/`` via
  ``IssueReactionPublicViewSet.as_view({"get": "list", "post": "create"})`` and
  ``{"delete": "destroy"}``.
- ``comment-reactions-project-board`` (collection / detail) --
  ``anchor/<str:anchor>/comments/<uuid:comment_id>/reactions/`` and
  ``.../reactions/<str:reaction_code>/`` via
  ``CommentReactionPublicViewSet.as_view({"get": "list", "post": "create"})`` and
  ``{"delete": "destroy"}``.
- ``issue-vote-project-board`` --
  ``anchor/<str:anchor>/issues/<uuid:issue_id>/votes/`` via
  ``IssueVotePublicViewSet.as_view({"get": "list", "post": "create", "delete": "destroy"})``.

These patterns belong to the anonymous public read surface aggregated by
``plane.space.urls`` and mounted under ``api/public/``.
"""

from django.urls import path


from plane.space.views import (
    IssueRetrievePublicEndpoint,
    IssueCommentPublicViewSet,
    IssueReactionPublicViewSet,
    CommentReactionPublicViewSet,
    IssueVotePublicViewSet,
)

urlpatterns = [
    path(
        "anchor/<str:anchor>/issues/<uuid:issue_id>/",
        IssueRetrievePublicEndpoint.as_view(),
        name="workspace-project-boards",
    ),
    path(
        "anchor/<str:anchor>/issues/<uuid:issue_id>/comments/",
        IssueCommentPublicViewSet.as_view({"get": "list", "post": "create"}),
        name="issue-comments-project-board",
    ),
    path(
        "anchor/<str:anchor>/issues/<uuid:issue_id>/comments/<uuid:pk>/",
        IssueCommentPublicViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
        name="issue-comments-project-board",
    ),
    path(
        "anchor/<str:anchor>/issues/<uuid:issue_id>/reactions/",
        IssueReactionPublicViewSet.as_view({"get": "list", "post": "create"}),
        name="issue-reactions-project-board",
    ),
    path(
        "anchor/<str:anchor>/issues/<uuid:issue_id>/reactions/<str:reaction_code>/",
        IssueReactionPublicViewSet.as_view({"delete": "destroy"}),
        name="issue-reactions-project-board",
    ),
    path(
        "anchor/<str:anchor>/comments/<uuid:comment_id>/reactions/",
        CommentReactionPublicViewSet.as_view({"get": "list", "post": "create"}),
        name="comment-reactions-project-board",
    ),
    path(
        "anchor/<str:anchor>/comments/<uuid:comment_id>/reactions/<str:reaction_code>/",
        CommentReactionPublicViewSet.as_view({"delete": "destroy"}),
        name="comment-reactions-project-board",
    ),
    path(
        "anchor/<str:anchor>/issues/<uuid:issue_id>/votes/",
        IssueVotePublicViewSet.as_view({"get": "list", "post": "create", "delete": "destroy"}),
        name="issue-vote-project-board",
    ),
]
