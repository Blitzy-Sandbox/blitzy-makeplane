/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Recursive controller for a single issue row, including drop targets and sub-issue expansion.
 *
 * Rendered purpose: wraps a single `IssueBlock` with virtualization (`RenderIfVisible`), drop-target
 * registration (drag-instruction-aware), sub-issue expansion state, drag-over indicators (top vs.
 * bottom), an outside-click handler to clear the drop highlight, and recursive child rendering for
 * expanded sub-issues. Recursion happens by re-instantiating `IssueBlockRoot` for each sub-issue id
 * with `nestingLevel + 1` and `spacingLeft + 12` (the indent step).
 *
 * Props (Props):
 *   - issueId (string, required): id of the issue this row represents
 *   - issuesMap (TIssueMap, required): global issue lookup map; the issue is read at the start of render
 *   - updateIssue (optional callback): issue update fn forwarded to the inner block
 *   - quickActions (TRenderQuickActions, required): scope-specific quick-action renderer
 *   - canEditProperties ((projectId) => boolean, required): per-project edit predicate
 *   - displayProperties (IIssueDisplayProperties | undefined): column visibility flags
 *   - nestingLevel (number, required): zero for top-level rows; incremented per recursion step
 *   - spacingLeft (number, optional, default=14): left indent in pixels; incremented by 12 per
 *     recursion step to produce the visual sub-issue indent
 *   - containerRef (MutableRefObject, required): the scroll container ref used by `RenderIfVisible`
 *     to virtualize off-screen rows
 *   - selectionHelpers (TSelectionHelper, required): multi-select context forwarded to the inner block
 *   - groupId (string, required): the parent group id; used in `getIssueBlockId(issueId, groupId)`
 *     to produce the deterministic DOM id for highlight-on-drop
 *   - isDragAllowed (boolean, required): forwarded to the inner block
 *   - canDropOverIssue (boolean, required): when true, the row registers as a drop target; sub-issues
 *     are NEVER drop targets (nesting via list-drop is intentionally disabled — see `canDrop` predicate)
 *   - isParentIssueBeingDragged (boolean, optional, default=false): propagates parent drag state into
 *     the inner block so the sub-issue appears "dragging" alongside its parent
 *   - isLastChild (boolean, optional, default=false): controls the "last-in-group" hitbox mode for the
 *     pragmatic-DnD instruction extractor (lets users drop ABOVE or BELOW the last row)
 *   - shouldRenderByDefault (boolean, optional): forwarded to `RenderIfVisible` to force-render this
 *     row (e.g. when its parent is expanded, sub-issues should not be virtualized off)
 *   - isEpic (boolean, optional, default=false): switches the issue-detail store between issue and
 *     epic service types
 *
 * Local state:
 *   - `isExpanded` (boolean): toggles sub-issue rendering
 *   - `instruction` ("DRAG_OVER" | "DRAG_BELOW" | undefined): drag-over indicator state derived from
 *     `extractInstruction` on the pragmatic-DnD `self.data`
 *   - `isCurrentBlockDragging` (boolean): true while this row is being dragged (set by inner block's
 *     `onDragStart`/`onDrop`); propagated to recursive children via `isParentIssueBeingDragged`
 *
 * MobX stores read:
 *   - `usePlatformOS()` exposes `isMobile` used by `RenderIfVisible.shouldRecordHeights`
 *   - `useIssueDetail(isEpic ? EPICS : ISSUES)` exposes the `subIssues` store slice — `subIssuesByIssueId`
 *     returns the sub-issue ids currently loaded for this issue
 *
 * Side effects:
 *   - `useEffect` registers `dropTargetForElements` on `issueBlockRef.current` with
 *     `attachInstruction(..., { input, element, currentLevel: 0, indentPerLevel: 0, mode: isLastChild ?
 *     "last-in-group" : "standard" })`. The drop target updates the `instruction` state on each drag
 *     tick and clears it on drag-leave/drop. The `canDrop` predicate forbids dropping onto self,
 *     dropping into a sub-issue row, or dropping when `canDropOverIssue` is false.
 *   - `useOutsideClickDetector(issueBlockRef, ...)` removes the `HIGHLIGHT_CLASS` from the element
 *     when the user clicks anywhere outside the row, ending the post-drop highlight flash.
 *
 * Consumers: `blocks-list.tsx` (the per-group mapper) AND itself recursively for expanded sub-issues.
 */

import type { MutableRefObject } from "react";
import React, { useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { attachInstruction, extractInstruction } from "@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item";
import { observer } from "mobx-react";
// plane helpers
import { useOutsideClickDetector } from "@plane/hooks";
// types
import type { IIssueDisplayProperties, TIssue, TIssueMap } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// components
import { DropIndicator } from "@plane/ui";
import RenderIfVisible from "@/components/core/render-if-visible-HOC";
import { ListLoaderItemRow } from "@/components/ui/loader/layouts/list-layout-loader";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
import { usePlatformOS } from "@/hooks/use-platform-os";
// types
import { HIGHLIGHT_CLASS, getIssueBlockId, isIssueNew } from "../utils";
import { IssueBlock } from "./block";
import type { TRenderQuickActions } from "./list-view-types";

/** Props for `IssueBlockRoot`. See the module-level JSDoc for full semantics. */
type Props = {
  issueId: string;
  issuesMap: TIssueMap;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  quickActions: TRenderQuickActions;
  canEditProperties: (projectId: string | undefined) => boolean;
  displayProperties: IIssueDisplayProperties | undefined;
  nestingLevel: number;
  spacingLeft?: number;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  selectionHelpers: TSelectionHelper;
  groupId: string;
  isDragAllowed: boolean;
  canDropOverIssue: boolean;
  isParentIssueBeingDragged?: boolean;
  isLastChild?: boolean;
  shouldRenderByDefault?: boolean;
  isEpic?: boolean;
};

/** Recursive issue-row controller; see the module-level JSDoc for full semantics. */
export const IssueBlockRoot = observer(function IssueBlockRoot(props: Props) {
  const {
    issueId,
    issuesMap,
    groupId,
    updateIssue,
    quickActions,
    canEditProperties,
    displayProperties,
    nestingLevel,
    spacingLeft = 14,
    containerRef,
    isDragAllowed,
    canDropOverIssue,
    isParentIssueBeingDragged = false,
    isLastChild = false,
    selectionHelpers,
    shouldRenderByDefault,
    isEpic = false,
  } = props;
  // states
  const [isExpanded, setExpanded] = useState<boolean>(false);
  const [instruction, setInstruction] = useState<"DRAG_OVER" | "DRAG_BELOW" | undefined>(undefined);
  const [isCurrentBlockDragging, setIsCurrentBlockDragging] = useState(false);
  // ref
  const issueBlockRef = useRef<HTMLDivElement | null>(null);
  // hooks
  const { isMobile } = usePlatformOS();
  // store hooks
  const { subIssues: subIssuesStore } = useIssueDetail(isEpic ? EIssueServiceType.EPICS : EIssueServiceType.ISSUES);

  const isSubIssue = nestingLevel !== 0;

  useEffect(() => {
    const blockElement = issueBlockRef.current;

    if (!blockElement) return;

    return combine(
      dropTargetForElements({
        element: blockElement,
        canDrop: ({ source }) => source?.data?.id !== issueId && !isSubIssue && canDropOverIssue,
        getData: ({ input, element }) => {
          const data = { id: issueId, type: "ISSUE" };

          // attach instruction for last in list
          return attachInstruction(data, {
            input,
            element,
            currentLevel: 0,
            indentPerLevel: 0,
            mode: isLastChild ? "last-in-group" : "standard",
          });
        },
        onDrag: ({ self }) => {
          const extractedInstruction = extractInstruction(self?.data)?.type;
          // check if the highlight is to be shown above or below
          setInstruction(
            extractedInstruction
              ? extractedInstruction === "reorder-below" && isLastChild
                ? "DRAG_BELOW"
                : "DRAG_OVER"
              : undefined
          );
        },
        onDragLeave: () => {
          setInstruction(undefined);
        },
        onDrop: () => {
          setInstruction(undefined);
        },
      })
    );
  }, [issueId, isLastChild, issueBlockRef, isSubIssue, canDropOverIssue, setInstruction]);

  // HIGHLIGHT_CLASS is added imperatively by `highlightIssueOnDrop` in the parent drop handler; here we
  // listen for any click outside this row to remove the highlight, ending the post-drop visual flash.
  useOutsideClickDetector(issueBlockRef, () => {
    issueBlockRef?.current?.classList?.remove(HIGHLIGHT_CLASS);
  });

  if (!issueId || !issuesMap[issueId]?.created_at) return null;

  const subIssues = subIssuesStore.subIssuesByIssueId(issueId);
  return (
    <div className="relative" ref={issueBlockRef} id={getIssueBlockId(issueId, groupId)}>
      <DropIndicator classNames={"absolute top-0 z-[2]"} isVisible={instruction === "DRAG_OVER"} />
      <RenderIfVisible
        key={`${issueId}`}
        root={containerRef}
        classNames={`relative ${isLastChild && !isExpanded ? "" : "border-b border-b-subtle"}`}
        verticalOffset={100}
        defaultValue={shouldRenderByDefault || (issuesMap[issueId] ? isIssueNew(issuesMap[issueId]) : false)}
        placeholderChildren={<ListLoaderItemRow shouldAnimate={false} renderForPlaceHolder defaultPropertyCount={4} />}
        shouldRecordHeights={isMobile}
      >
        <IssueBlock
          issueId={issueId}
          issuesMap={issuesMap}
          groupId={groupId}
          updateIssue={updateIssue}
          quickActions={quickActions}
          canEditProperties={canEditProperties}
          displayProperties={displayProperties}
          isExpanded={isExpanded}
          setExpanded={setExpanded}
          nestingLevel={nestingLevel}
          spacingLeft={spacingLeft}
          selectionHelpers={selectionHelpers}
          canDrag={!isSubIssue && isDragAllowed}
          isCurrentBlockDragging={isParentIssueBeingDragged || isCurrentBlockDragging}
          setIsCurrentBlockDragging={setIsCurrentBlockDragging}
          isEpic={isEpic}
        />
      </RenderIfVisible>

      {/*
       * Recursive render: sub-issues are mounted only when expanded AND not in epic mode (epics use the
       * peek-overview surface for sub-issue navigation, not inline tree expansion). `shouldRenderByDefault={
       * isExpanded}` forces `RenderIfVisible` to skip virtualisation for these rows so the tree always
       * renders cohesively even when partially off-screen.
       */}
      {isExpanded &&
        !isEpic &&
        subIssues?.map((subIssueId) => (
          <IssueBlockRoot
            key={`${subIssueId}`}
            issueId={subIssueId}
            issuesMap={issuesMap}
            updateIssue={updateIssue}
            quickActions={quickActions}
            canEditProperties={canEditProperties}
            displayProperties={displayProperties}
            nestingLevel={nestingLevel + 1}
            spacingLeft={spacingLeft + 12}
            containerRef={containerRef}
            selectionHelpers={selectionHelpers}
            groupId={groupId}
            isDragAllowed={isDragAllowed}
            canDropOverIssue={canDropOverIssue}
            isParentIssueBeingDragged={isParentIssueBeingDragged || isCurrentBlockDragging}
            shouldRenderByDefault={isExpanded}
          />
        ))}
      {/*
       * DRAG_BELOW indicator: rendered only on the last row of a group so users can drop AFTER the last
       * issue (the standard mode only allows "reorder-above").
       */}
      {isLastChild && <DropIndicator classNames={"absolute z-[2]"} isVisible={instruction === "DRAG_BELOW"} />}
    </div>
  );
});
