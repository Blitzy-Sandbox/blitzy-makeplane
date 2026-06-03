/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Stateful wrapper around a single issue card on the calendar. Resolves the
 * issue from the issue-detail store, installs Atlaskit draggable behavior,
 * tracks transient drag state, and clears the post-drop highlight on outside
 * clicks.
 *
 * Props (Props type, L20):
 *   - issueId (required) — id resolved against useIssueDetail().issue.
 *   - quickActions — forwarded to CalendarIssueBlock.
 *   - isDragDisabled — AND-gated with canEditProperties(project_id) to
 *     determine if draggable is registered.
 *   - canEditProperties — per-issue edit gate; blocks drag when false.
 *   - isEpic — switches the wrapped block into epic mode.
 *
 * Stores read:
 *   - useIssueDetail().issue.getIssueById(issueId).
 *
 * Side effects:
 *   - Registers @atlaskit/pragmatic-drag-and-drop draggable on the rendered
 *     ControlLink with getInitialData = { id, date: target_date }.
 *   - Clears HIGHLIGHT_CLASS from the block on outside click via
 *     @plane/hooks useOutsideClickDetector.
 *
 * Consumers:
 *   - ./issue-blocks.tsx (CalendarIssueBlocks).
 */

import React, { useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { observer } from "mobx-react";
// plane helpers
import { useOutsideClickDetector } from "@plane/hooks";
// components
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import type { TRenderQuickActions } from "../list/list-view-types";
import { HIGHLIGHT_CLASS } from "../utils";
import { CalendarIssueBlock } from "./issue-block";
// types

type Props = {
  issueId: string;
  quickActions: TRenderQuickActions;
  isDragDisabled: boolean;
  isEpic?: boolean;
  canEditProperties: (projectId: string | undefined) => boolean;
};

/** Resolves a calendar issue, installs Atlaskit draggable, and renders {@link CalendarIssueBlock}. */
export const CalendarIssueBlockRoot = observer(function CalendarIssueBlockRoot(props: Props) {
  const { issueId, quickActions, isDragDisabled, isEpic = false, canEditProperties } = props;

  const issueRef = useRef<HTMLAnchorElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const {
    issue: { getIssueById },
  } = useIssueDetail();

  const issue = getIssueById(issueId);

  const canDrag = !isDragDisabled && canEditProperties(issue?.project_id ?? undefined);

  useEffect(() => {
    const element = issueRef.current;

    if (!element) return;

    return combine(
      draggable({
        element,
        canDrag: () => canDrag,
        getInitialData: () => ({ id: issue?.id, date: issue?.target_date }),
        onDragStart: () => {
          setIsDragging(true);
        },
        onDrop: () => {
          setIsDragging(false);
        },
      })
    );
  }, [issueRef?.current, issue, canDrag]);

  useOutsideClickDetector(issueRef, () => {
    issueRef?.current?.classList?.remove(HIGHLIGHT_CLASS);
  });

  if (!issue) return null;

  return (
    <CalendarIssueBlock
      isDragging={isDragging}
      issue={issue}
      quickActions={quickActions}
      ref={issueRef}
      isEpic={isEpic}
    />
  );
});
