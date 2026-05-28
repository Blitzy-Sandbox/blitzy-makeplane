/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue-level emoji reaction component for the issue detail content area.
 *
 * Rendered purpose: a Propel `EmojiReactionPicker` wrapping an `EmojiReactionGroup` that renders
 * every existing reaction on a single work item as a tappable chip and exposes an "Add reaction"
 * picker. Bound to the issue-reaction sub-store so the chip group re-renders as other users react
 * in real time.
 *
 * Props (TIssueReaction — exported):
 *   - workspaceSlug (string, required): scopes the create/remove reaction mutations
 *   - projectId (string, required): scopes the create/remove reaction mutations
 *   - issueId (string, required): the work item whose reactions are managed
 *   - currentUser (IUser, required): used to compute `reactionsByUser(issueId, currentUser.id)` and
 *     to authorize the remove mutation (the API requires the actor id)
 *   - disabled (boolean, optional, default=false): suppresses both the "Add reaction" affordance
 *     and direct-chip click handling while preserving display of the existing reaction group
 *   - className (string, optional, default=""): wrapper class overrides composed through `cn` with
 *     the baseline `"relative mt-4"` utilities
 *
 * MobX stores read (via React-context store hooks):
 *   - `useIssueDetail()` —
 *       reaction.getReactionsByIssueId(issueId): the `Record<emojiCode, reactionId[]>` bucket map
 *       reaction.reactionsByUser(issueId, userId): the current user's reactions on this issue
 *       reaction.getReactionById(reactionId): resolves a stored reaction's actor/display_name
 *       createReaction / removeReaction: mutation actions
 *   - `useMember()` — `getUserDetails(actorId)` for resolving each reaction's actor display name
 *     (falls back to the stored `display_name` when the member is not in the loaded member set)
 *
 * Side effects:
 *   - Persistence routes through `IssueReactionStore` → `IssueReactionService.createIssueReaction`
 *     / `.deleteIssueReaction` → `apps/api`'s `IssueReactionViewSet` (POST and DELETE on
 *     `/workspaces/<slug>/projects/<id>/issues/<issue_id>/reactions/`).
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
 *   - `issueReactionOperations.react` implements toggle semantics: when the current user has
 *     already reacted with the given code-point string it calls `remove`; otherwise `create`. This
 *     keeps the chip behavior idempotent from the user's perspective.
 *   - `reactions: EmojiReactionType[]` is `useMemo`-derived from `reactionIds` and `userReactions`
 *     so the chip group's identity is stable across renders unless the underlying buckets change.
 *   - Field validation in `create`/`remove` throws "Missing fields" when any of `workspaceSlug`,
 *     `projectId`, `issueId` (and `currentUser.id` for `remove`) is falsy — the throw is caught
 *     locally and surfaced as an error toast. Preserve this guard exactly.
 *   - When `disabled` is true, the early-return in `handleReactionClick` suppresses chip clicks but
 *     `EmojiReactionGroup.showAddButton={!disabled}` also hides the add-reaction button so the
 *     existing reaction group continues to render in a strictly read-only mode.
 *
 * Consumers: rendered by `../main-content.tsx` (`IssueDetailRoot` main body) and by
 * the peek-overview body beneath the work-item description.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import { stringToEmoji } from "@plane/propel/emoji-icon-picker";
import { EmojiReactionGroup, EmojiReactionPicker } from "@plane/propel/emoji-reaction";
import type { EmojiReactionType } from "@plane/propel/emoji-reaction";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IUser } from "@plane/types";
// hooks
// ui
import { cn } from "@plane/utils";
// helpers
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useMember } from "@/hooks/store/use-member";
// types

export type TIssueReaction = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  currentUser: IUser;
  disabled?: boolean;
  className?: string;
};

export const IssueReaction = observer(function IssueReaction(props: TIssueReaction) {
  const { workspaceSlug, projectId, issueId, currentUser, disabled = false, className = "" } = props;
  // state
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  // hooks
  const {
    reaction: { getReactionsByIssueId, reactionsByUser, getReactionById },
    createReaction,
    removeReaction,
  } = useIssueDetail();
  const { getUserDetails } = useMember();

  const reactionIds = getReactionsByIssueId(issueId);
  const userReactions = reactionsByUser(issueId, currentUser.id).map((r) => r.reaction);

  const issueReactionOperations = useMemo(
    () => ({
      create: async (reaction: string) => {
        try {
          if (!workspaceSlug || !projectId || !issueId) throw new Error("Missing fields");
          await createReaction(workspaceSlug, projectId, issueId, reaction);
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
          if (!workspaceSlug || !projectId || !issueId || !currentUser?.id) throw new Error("Missing fields");
          await removeReaction(workspaceSlug, projectId, issueId, reaction, currentUser.id);
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
        if (userReactions.includes(reaction)) await issueReactionOperations.remove(reaction);
        else await issueReactionOperations.create(reaction);
      },
    }),
    [workspaceSlug, projectId, issueId, currentUser, createReaction, removeReaction, userReactions]
  );

  const getReactionUsers = (reaction: string): string[] => {
    const reactionUsers = (reactionIds?.[reaction] || [])
      .map((reactionId) => {
        const reactionDetails = getReactionById(reactionId);
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
    issueReactionOperations.react(reactionString);
  };

  const handleEmojiSelect = (emoji: string) => {
    // emoji is already in decimal string format from EmojiReactionPicker
    issueReactionOperations.react(emoji);
  };

  return (
    <div className={cn("relative mt-4", className)}>
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
