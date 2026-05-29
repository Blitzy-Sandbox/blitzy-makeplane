/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Lightweight mapper that turns a list of issue ids into recursive `IssueBlockRoot` children.
 *
 * Rendered purpose: receives the array of issue ids for a single group from `ListGroup` and maps each
 * id to an `IssueBlockRoot`, forwarding shared row context (issue map, selection helpers, drag
 * permissions, update callbacks, display properties, epic flag). Tracks `isLastChild` so that the
 * recursive root can position the "drag below" indicator only for the last row in a group.
 *
 * Props (Props):
 *   - issueIds (TGroupedIssues | any, required): the array of issue ids to render — typed as any
 *     because callers also pass the runtime-grouped index shape
 *   - issuesMap (TIssueMap, required): forwarded to each block-root for issue lookup
 *   - groupId (string, required): the parent group's id, forwarded to each block-root for the
 *     composite DOM id and selection-helper scope
 *   - canEditProperties ((projectId) => boolean, required): per-project edit predicate
 *   - updateIssue (optional callback): issue update fn used by inline editors
 *   - quickActions (TRenderQuickActions, required): scope-specific quick-action renderer
 *   - displayProperties (IIssueDisplayProperties | undefined): column visibility flags
 *   - containerRef (MutableRefObject, required): the scroll container ref used by `RenderIfVisible`
 *     inside each block-root for virtualisation
 *   - isDragAllowed (boolean, required): forwarded; gates `draggable()` registration in each block
 *   - canDropOverIssue (boolean, required): forwarded; gates `dropTargetForElements` on each block-root
 *   - selectionHelpers (TSelectionHelper, required): multi-select context forwarded from `ListGroup`
 *   - isEpic (boolean, optional, default=false): forwarded; switches identifiers and links to epic mode
 *
 * MobX stores read: none directly — this is a pass-through mapper.
 *
 * Side effects: none — pure presentational mapping.
 *
 * Consumers: `list-group.tsx` (renders one `IssueBlocksList` per expanded group).
 */

import type { MutableRefObject } from "react";
// components
import type { TIssue, IIssueDisplayProperties, TIssueMap, TGroupedIssues } from "@plane/types";
// hooks
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
// types
import { IssueBlockRoot } from "./block-root";
import type { TRenderQuickActions } from "./list-view-types";

/** Props for `IssueBlocksList`. See the module-level JSDoc for full semantics. */
interface Props {
  issueIds: TGroupedIssues | any;
  issuesMap: TIssueMap;
  groupId: string;
  canEditProperties: (projectId: string | undefined) => boolean;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  quickActions: TRenderQuickActions;
  displayProperties: IIssueDisplayProperties | undefined;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  isDragAllowed: boolean;
  canDropOverIssue: boolean;
  selectionHelpers: TSelectionHelper;
  isEpic?: boolean;
}

/** Lightweight id-to-`IssueBlockRoot` mapper; see the module-level JSDoc for full semantics. */
export function IssueBlocksList(props: Props) {
  const {
    issueIds,
    issuesMap,
    groupId,
    updateIssue,
    quickActions,
    displayProperties,
    canEditProperties,
    containerRef,
    selectionHelpers,
    isDragAllowed,
    canDropOverIssue,
    isEpic = false,
  } = props;

  return (
    <div className="relative h-full w-full">
      {issueIds &&
        issueIds.length > 0 &&
        issueIds.map((issueId: string, index: number) => (
          <IssueBlockRoot
            key={issueId}
            issueId={issueId}
            issuesMap={issuesMap}
            updateIssue={updateIssue}
            quickActions={quickActions}
            canEditProperties={canEditProperties}
            displayProperties={displayProperties}
            nestingLevel={0}
            spacingLeft={0}
            containerRef={containerRef}
            selectionHelpers={selectionHelpers}
            groupId={groupId}
            isLastChild={index === issueIds.length - 1}
            isDragAllowed={isDragAllowed}
            canDropOverIssue={canDropOverIssue}
            isEpic={isEpic}
          />
        ))}
    </div>
  );
}
