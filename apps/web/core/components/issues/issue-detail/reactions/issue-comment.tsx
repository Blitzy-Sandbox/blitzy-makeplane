/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Comment-level emoji reaction component for the issue detail activity timeline.
 *
 * Rendered purpose: a Propel `EmojiReactionPicker` wrapping an `EmojiReactionGroup` that renders
 * every existing reaction on a single issue comment as a tappable chip and exposes an "Add reaction"
 * picker. Bound to the comment reaction sub-store so the chip group re-renders as other users react
 * in real time.
 *
 * Props (TIssueCommentReaction — exported):
 *   - workspaceSlug (string, required): scopes the create/remove reaction mutations
 *   - projectId (string, required): scopes the create/remove reaction mutations
 *   - commentId (string, required): the issue comment whose reactions are managed
 *   - currentUser (IUser, required): used to compute `reactionsByUser(commentId, currentUser.id)`
 *     and to authorize the remove mutation (the API requires the actor id)
 *   - disabled (boolean, optional, default=false): suppresses both the "Add reaction" affordance
 *     and direct-chip click handling while preserving display of the existing reaction group
 *
 * MobX stores read (via React-context store hooks):
 *   - `useIssueDetail()` —
 *       commentReaction.getCommentReactionsByCommentId(commentId): the `Record<emojiCode, reactionId[]>` bucket map
 *       commentReaction.commentReactionsByUser(commentId, userId): the current user's reactions on this comment
 *       commentReaction.getCommentReactionById(reactionId): resolves a stored reaction's actor/display_name
 *       createCommentReaction / removeCommentReaction: mutation actions
 *   - `useMember()` — `getUserDetails(actorId)` for resolving each reaction's actor display name
 *     (falls back to the stored `display_name` when the member is not in the loaded member set)
 *
 * Side effects:
 *   - Persistence routes through `IssueCommentReactionStore` →
 *     `IssueReactionService.createIssueCommentReaction` / `.deleteIssueCommentReaction` →
 *     `apps/api`'s `CommentReactionViewSet` (POST and DELETE on
 *     `/workspaces/<slug>/projects/<id>/comments/<comment_id>/reactions/`).
 *   - Toast emissions via `setToast({ type: TOAST_TYPE.SUCCESS | TOAST_TYPE.ERROR })` after each
 *     create/remove attempt (success and failure paths both notify the user).
 *   - No router navigations and no direct API calls from this component (all I/O is mediated by the
 *     store actions).
 *
 * Imperative DOM / derived state notes:
 *   - The "decimal code-point string" emoji normalization in `handleReactionClick` exists because
 *     the backend stores the reaction key as the dash-joined decimal Unicode code points (e.g.,
 *     "128512" for 😀 or "129505-8205-129505" for compound glyphs), NOT the raw UTF-16 surrogate
 *     pair string. `EmojiReactionPicker` emits the already-normalized form, so `handleEmojiSelect`
 *     skips the conversion — this asymmetry IS the WHY of the two distinct handlers.
 *   - `issueCommentReactionOperations.react` implements toggle semantics: when the current user has
 *     already reacted with the given code-point string it calls `remove`; otherwise `create`. This
 *     keeps the chip behavior idempotent from the user's perspective.
 *   - `reactions: EmojiReactionType[]` is `useMemo`-derived from `reactionIds` and `userReactions`
 *     so the chip group's identity is stable across renders unless the underlying buckets change.
 *   - Field validation in `create`/`remove` throws "Missing fields" when any of `workspaceSlug`,
 *     `projectId`, `commentId` (and `currentUser.id` for `remove`) is falsy — the throw is caught
 *     locally and surfaced as an error toast. Preserve this guard exactly.
 *   - When `disabled` is true, the early-return in `handleReactionClick` suppresses chip clicks but
 *     the existing reaction group continues to render so observers can still see who reacted.
 *
 * Consumers: rendered inside the issue-activity timeline (`../issue-activity/*`) for
 * each comment row that supports reactions.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import { stringToEmoji } from "@plane/propel/emoji-icon-picker";
import { EmojiReactionGroup, EmojiReactionPicker } from "@plane/propel/emoji-reaction";
import type { EmojiReactionType } from "@plane/propel/emoji-reaction";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IUser } from "@plane/types";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useMember } from "@/hooks/store/use-member";

export type TIssueCommentReaction = {
  workspaceSlug: string;
  projectId: string;
  commentId: string;
  currentUser: IUser;
  disabled?: boolean;
};

export const IssueCommentReaction = observer(function IssueCommentReaction(props: TIssueCommentReaction) {
  const { workspaceSlug, projectId, commentId, currentUser, disabled = false } = props;
  // state
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  // hooks
  const {
    commentReaction: { getCommentReactionsByCommentId, commentReactionsByUser, getCommentReactionById },
    createCommentReaction,
    removeCommentReaction,
  } = useIssueDetail();
  const { getUserDetails } = useMember();

  const reactionIds = getCommentReactionsByCommentId(commentId);
  const userReactions = commentReactionsByUser(commentId, currentUser.id).map((r) => r.reaction);

  const issueCommentReactionOperations = useMemo(
    () => ({
      create: async (reaction: string) => {
        try {
          if (!workspaceSlug || !projectId || !commentId) throw new Error("Missing fields");
          await createCommentReaction(workspaceSlug, projectId, commentId, reaction);
          setToast({
            title: "Success!",
            type: TOAST_TYPE.SUCCESS,
            message: "Reaction created successfully",
          });
        } catch (_error) {
          setToast({
            title: "Error!",
            type: TOAST_TYPE.ERROR,
            message: "Reaction creation failed",
          });
        }
      },
      remove: async (reaction: string) => {
        try {
          if (!workspaceSlug || !projectId || !commentId || !currentUser?.id) throw new Error("Missing fields");
          removeCommentReaction(workspaceSlug, projectId, commentId, reaction, currentUser.id);
          setToast({
            title: "Success!",
            type: TOAST_TYPE.SUCCESS,
            message: "Reaction removed successfully",
          });
        } catch (_error) {
          setToast({
            title: "Error!",
            type: TOAST_TYPE.ERROR,
            message: "Reaction remove failed",
          });
        }
      },
      react: async (reaction: string) => {
        if (userReactions.includes(reaction)) await issueCommentReactionOperations.remove(reaction);
        else await issueCommentReactionOperations.create(reaction);
      },
    }),
    [workspaceSlug, projectId, commentId, currentUser, createCommentReaction, removeCommentReaction, userReactions]
  );

  const getReactionUsers = (reaction: string): string[] => {
    const reactionUsers = (reactionIds?.[reaction] || [])
      .map((reactionId) => {
        const reactionDetails = getCommentReactionById(reactionId);
        return reactionDetails
          ? getUserDetails(reactionDetails?.actor)?.display_name || reactionDetails?.display_name
          : null;
      })
      .filter((displayName): displayName is string => !!displayName);
    return reactionUsers;
  };

  // Transform reactions data to Propel EmojiReactionType format
  const reactions: EmojiReactionType[] = useMemo(() => {
    if (!reactionIds) return [];

    return Object.keys(reactionIds)
      .filter((reaction) => reactionIds[reaction]?.length > 0)
      .map((reaction) => ({
        emoji: stringToEmoji(reaction),
        count: reactionIds[reaction].length,
        reacted: userReactions.includes(reaction),
        users: getReactionUsers(reaction),
      }));
  }, [reactionIds, userReactions]);

  const handleReactionClick = (emoji: string) => {
    if (disabled) return;
    // Convert emoji back to decimal string format for the API
    const emojiCodePoints = Array.from(emoji).map((char) => char.codePointAt(0));
    const reactionString = emojiCodePoints.join("-");
    issueCommentReactionOperations.react(reactionString);
  };

  const handleEmojiSelect = (emoji: string) => {
    // emoji is already in decimal string format from EmojiReactionPicker
    issueCommentReactionOperations.react(emoji);
  };

  return (
    <div className="relative mt-4">
      <EmojiReactionPicker
        isOpen={isPickerOpen}
        handleToggle={setIsPickerOpen}
        onChange={handleEmojiSelect}
        disabled={disabled}
        label={
          <EmojiReactionGroup
            reactions={reactions}
            onReactionClick={handleReactionClick}
            showAddButton={!disabled}
            onAddReaction={() => setIsPickerOpen(true)}
          />
        }
        placement="bottom-start"
      />
    </div>
  );
});
