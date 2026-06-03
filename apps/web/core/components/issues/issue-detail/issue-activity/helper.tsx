/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue-detail comment & reaction operations factory.
 *
 * Composes store hooks from issue-detail / project / member / editor-asset / user with i18n,
 * clipboard, and toast utilities into the memoized `TCommentsOperations` contract consumed by the
 * `CommentCreate` / `CommentCard` components and the activity timeline. The single exported hook
 * (`useWorkItemCommentOperations`) returns a stable operations object that handles the entire
 * comment lifecycle: deep-link copying, CRUD (create / update / remove), attachment upload &
 * duplication, reaction CRUD with toggle semantics, reaction grouping, and user display formatting.
 *
 * Architectural notes:
 *   - This module is the boundary between the MobX issue-detail store and the comment UI surfaces;
 *     it does NOT introduce any new state of its own — every method routes through `useIssueDetail`,
 *     `useEditorAsset`, `useMember`, etc.
 *   - The contract is `TCommentsOperations` (sourced from `@plane/types`) — the same type
 *     consumed by every comment-aware UI component in the issue-detail subtree, so callers can be
 *     swapped between work-item, epic, and worklog contexts without changing prop signatures.
 *   - All async methods catch errors and emit a localized toast via `setToast` — the contract
 *     consumers therefore do NOT need their own error handling for the happy/typical failure paths.
 *   - The `react` method toggles a reaction by checking the user's current reaction set
 *     (`userReactions(commentId)`) and routing to `addCommentReaction` / `deleteCommentReaction`
 *     accordingly; this prevents double-add and silent-fail on remove.
 *
 * Side effects in returned ops:
 *   - `copyCommentLink(commentId)`: clipboard write of `${workItemLink}#comment-<id>` + success/error toast
 *   - `createComment(data)`: POST to issue-comment endpoint (via store action) + success/error toast
 *   - `updateComment(commentId, data)`: PATCH to issue-comment endpoint + success/error toast
 *   - `removeComment(commentId)`: DELETE issue-comment endpoint + success/error toast
 *   - `uploadCommentAsset(blockId, file, commentId?)`: POST asset (EFileAssetType.COMMENT_DESCRIPTION)
 *     via `uploadEditorAsset` — throws (no toast here; the editor UI surfaces this)
 *   - `duplicateCommentAsset(assetId, commentId)`: POST asset-duplication endpoint via
 *     `duplicateEditorAsset` — throws on failure
 *   - `addCommentReaction(commentId, reaction)` / `deleteCommentReaction(commentId, reaction)`:
 *     POST/DELETE comment-reaction endpoints + success/error toast
 *   - `react(commentId, reactionEmoji, userReactions)`: dispatches add or delete based on whether
 *     the emoji is already in the user's reactions array
 *   - `reactionIds(commentId)`: pure read from `commentReaction.getCommentReactionsByCommentId`
 *   - `userReactions(commentId)`: pure read from `commentReaction.commentReactionsByUser` mapped to
 *     the reaction emoji strings
 *   - `getReactionUsers(reaction, reactionIds)`: pure compose — resolves each reactor's
 *     `display_name` via `getCommentReactionById` + `getUserDetails`, then formats the resulting
 *     list with `formatTextList` (e.g., "Alice, Bob, and Charlie")
 */

import { useMemo } from "react";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EFileAssetType } from "@plane/types";
import type { TCommentsOperations } from "@plane/types";
import { copyUrlToClipboard, formatTextList, generateWorkItemLink } from "@plane/utils";
import { useEditorAsset } from "@/hooks/store/use-editor-asset";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
import { useUser } from "@/hooks/store/user";

/**
 * Builds the stable `TCommentsOperations` contract for a given (workspaceSlug, projectId, issueId).
 *
 * Parameters:
 *   - workspaceSlug (string | undefined): scopes every comment / reaction / asset mutation; ops
 *     short-circuit (with no toast) when undefined
 *   - projectId (string | undefined): scopes every comment / reaction / asset mutation
 *   - issueId (string | undefined): the work item whose comments are managed
 *
 * Returns: `TCommentsOperations` (memoized so the reference is stable across renders when the three
 * scope args and the underlying store actions are unchanged).
 *
 * Side effects: see the module-level JSDoc — every async method emits a localized success/error
 * toast on completion; clipboard writes use the system clipboard.
 *
 * MobX stores read:
 *   - `useIssueDetail()` — `createComment`, `updateComment`, `removeComment`,
 *     `createCommentReaction`, `removeCommentReaction`, `commentReaction.{getCommentReactionsByCommentId,
 *     commentReactionsByUser, getCommentReactionById}`, `issue.getIssueById`
 *   - `useProject()` — `getProjectById` (used by `copyCommentLink` to build the work-item URL)
 *   - `useMember()` — `getUserDetails` (used by `getReactionUsers` for display-name resolution)
 *   - `useEditorAsset()` — `uploadEditorAsset`, `duplicateEditorAsset` (asset upload / duplication)
 *   - `useUser()` — `currentUser` for the reactor identity in `deleteCommentReaction` and for the
 *     `userReactions` filter
 */
export const useWorkItemCommentOperations = (
  workspaceSlug: string | undefined,
  projectId: string | undefined,
  issueId: string | undefined
): TCommentsOperations => {
  // store hooks
  const {
    commentReaction: { getCommentReactionsByCommentId, commentReactionsByUser, getCommentReactionById },
    createComment,
    updateComment,
    removeComment,
    createCommentReaction,
    removeCommentReaction,
    issue: { getIssueById },
  } = useIssueDetail();
  const { getProjectById } = useProject();
  const { getUserDetails } = useMember();
  const { uploadEditorAsset, duplicateEditorAsset } = useEditorAsset();
  const { data: currentUser } = useUser();
  // derived values
  const issueDetails = issueId ? getIssueById(issueId) : undefined;
  const projectDetails = projectId ? getProjectById(projectId) : undefined;
  // translation
  const { t } = useTranslation();

  const operations: TCommentsOperations = useMemo(() => {
    // Define operations object with all methods
    const ops: TCommentsOperations = {
      copyCommentLink: (id) => {
        if (!workspaceSlug || !issueDetails) return;
        try {
          const workItemLink = generateWorkItemLink({
            workspaceSlug,
            projectId: issueDetails.project_id,
            issueId,
            projectIdentifier: projectDetails?.identifier,
            sequenceId: issueDetails.sequence_id,
          });
          const commentLink = `${workItemLink}#comment-${id}`;
          copyUrlToClipboard(commentLink).then(() => {
            setToast({
              title: t("common.success"),
              type: TOAST_TYPE.SUCCESS,
              message: t("issue.comments.copy_link.success"),
            });
          });
        } catch (error) {
          console.error("Error in copying comment link:", error);
          setToast({
            title: t("common.error.label"),
            type: TOAST_TYPE.ERROR,
            message: t("issue.comments.copy_link.error"),
          });
        }
      },
      createComment: async (data) => {
        try {
          if (!workspaceSlug || !projectId || !issueId) throw new Error("Missing fields");
          const comment = await createComment(workspaceSlug, projectId, issueId, data);
          setToast({
            title: t("common.success"),
            type: TOAST_TYPE.SUCCESS,
            message: t("issue.comments.create.success"),
          });
          return comment;
        } catch {
          setToast({
            title: t("common.error.label"),
            type: TOAST_TYPE.ERROR,
            message: t("issue.comments.create.error"),
          });
        }
      },
      updateComment: async (commentId, data) => {
        try {
          if (!workspaceSlug || !projectId || !issueId) throw new Error("Missing fields");
          await updateComment(workspaceSlug, projectId, issueId, commentId, data);
          setToast({
            title: t("common.success"),
            type: TOAST_TYPE.SUCCESS,
            message: t("issue.comments.update.success"),
          });
        } catch {
          setToast({
            title: t("common.error.label"),
            type: TOAST_TYPE.ERROR,
            message: t("issue.comments.update.error"),
          });
        }
      },
      removeComment: async (commentId) => {
        try {
          if (!workspaceSlug || !projectId || !issueId) throw new Error("Missing fields");
          await removeComment(workspaceSlug, projectId, issueId, commentId);
          setToast({
            title: t("common.success"),
            type: TOAST_TYPE.SUCCESS,
            message: t("issue.comments.remove.success"),
          });
        } catch {
          setToast({
            title: t("common.error.label"),
            type: TOAST_TYPE.ERROR,
            message: t("issue.comments.remove.error"),
          });
        }
      },
      uploadCommentAsset: async (blockId, file, commentId) => {
        try {
          if (!workspaceSlug || !projectId) throw new Error("Missing fields");
          const res = await uploadEditorAsset({
            blockId,
            data: {
              entity_identifier: commentId ?? "",
              entity_type: EFileAssetType.COMMENT_DESCRIPTION,
            },
            file,
            projectId,
            workspaceSlug,
          });
          return res;
        } catch (error) {
          console.log("Error in uploading comment asset:", error);
          throw new Error(t("issue.comments.upload.error"));
        }
      },
      duplicateCommentAsset: async (assetId, commentId) => {
        try {
          if (!workspaceSlug || !projectId) throw new Error("Missing fields");
          const res = await duplicateEditorAsset({
            assetId,
            entityId: commentId || undefined,
            entityType: EFileAssetType.COMMENT_DESCRIPTION,
            projectId,
            workspaceSlug,
          });
          return res;
        } catch {
          throw new Error("Asset duplication failed. Please try again later.");
        }
      },
      addCommentReaction: async (commentId, reaction) => {
        try {
          if (!workspaceSlug || !projectId || !commentId) throw new Error("Missing fields");
          await createCommentReaction(workspaceSlug, projectId, commentId, reaction);
          setToast({
            title: "Success!",
            type: TOAST_TYPE.SUCCESS,
            message: "Reaction created successfully",
          });
        } catch {
          setToast({
            title: "Error!",
            type: TOAST_TYPE.ERROR,
            message: "Reaction creation failed",
          });
        }
      },
      deleteCommentReaction: async (commentId, reaction) => {
        try {
          if (!workspaceSlug || !projectId || !commentId || !currentUser?.id) throw new Error("Missing fields");
          removeCommentReaction(workspaceSlug, projectId, commentId, reaction, currentUser.id);
          setToast({
            title: "Success!",
            type: TOAST_TYPE.SUCCESS,
            message: "Reaction removed successfully",
          });
        } catch {
          setToast({
            title: "Error!",
            type: TOAST_TYPE.ERROR,
            message: "Reaction remove failed",
          });
        }
      },
      react: async (commentId, reactionEmoji, userReactions) => {
        if (userReactions.includes(reactionEmoji)) await ops.deleteCommentReaction(commentId, reactionEmoji);
        else await ops.addCommentReaction(commentId, reactionEmoji);
      },
      reactionIds: (commentId) => getCommentReactionsByCommentId(commentId),
      userReactions: (commentId) =>
        currentUser ? commentReactionsByUser(commentId, currentUser?.id).map((r) => r.reaction) : [],
      getReactionUsers: (reaction, reactionIds) => {
        const reactionUsers = (reactionIds?.[reaction] || [])
          .map((reactionId) => {
            const reactionDetails = getCommentReactionById(reactionId);
            return reactionDetails ? getUserDetails(reactionDetails.actor)?.display_name : null;
          })
          .filter((displayName): displayName is string => !!displayName);
        const formattedUsers = formatTextList(reactionUsers);
        return formattedUsers;
      },
    };
    return ops;
  }, [workspaceSlug, projectId, issueId, createComment, updateComment, uploadEditorAsset, removeComment]);

  return operations;
};
