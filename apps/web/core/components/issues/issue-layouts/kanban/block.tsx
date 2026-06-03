/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Individual Kanban issue card — outer draggable/droppable shell + inner content renderer.
 *
 * Module structure (two co-located components):
 *   - `KanbanIssueDetailsBlock` (internal, not exported) — renders the card body: identifier badge,
 *     hover-revealed quick-actions menu, title with tooltip, properties row, and (epic mode only)
 *     the sub-issue stats line.
 *   - `KanbanIssueBlock` (exported) — the outer shell: resolves the issue from the store, builds
 *     the work-item link, attaches Pragmatic DnD draggable + drop-target, manages drag-over /
 *     dragging local state, and defers the inner content via `RenderIfVisible`.
 *
 * MobX stores read (in `KanbanIssueBlock`):
 *   - `useProject()` exposes `getProjectIdentifierById` for resolving the project prefix used in
 *     the work-item URL.
 *   - `useIssueDetail(EPICS | ISSUES)` exposes `getIsIssuePeeked` for highlighting the card when
 *     its peek-overview is open.
 *   - `useKanbanView()` exposes `setIsDragging` so the global drag-to-delete drop zone in
 *     `base-kanban-root.tsx` knows when a drag is active.
 *
 * Hook-driven derived behavior:
 *   - `useIssuePeekOverviewRedirection(isEpic)` exposes `handleRedirection`, which routes the click
 *     either to peek mode or full navigation based on user preference + platform.
 *   - `usePlatformOS()` exposes `isMobile` controlling tooltip behavior and hover-only menu visibility.
 *   - `useOutsideClickDetector(cardRef, ...)` removes the post-drop highlight class when the user
 *     clicks outside the card (cleanup of `HIGHLIGHT_CLASS` injected by `highlightIssueOnDrop`).
 *
 * Side effects (registered via `useEffect`):
 *   1. Pragmatic DnD `draggable` registration on the card DOM node:
 *      - `canDrag` returns `isDragAllowed = canDragIssuesInCurrentGrouping && !issue?.tempId && canEditIssueProperties`.
 *      - `onDragStart` sets BOTH local `isCurrentBlockDragging` and global `setIsKanbanDragging(true)`.
 *      - `onDrop` clears both flags.
 *   2. Pragmatic DnD `dropTargetForElements` registration on the SAME card DOM node — enables
 *     same-column reordering. `canDrop` rejects self-drops and respects `canDropOverIssue`.
 *
 * Side effects (other):
 *   - Clicking the card calls `handleIssuePeekOverview` → `handleRedirection(workspaceSlug, issue, isMobile)`
 *     which navigates or opens peek view.
 *   - Mousedown drag-start emits a warning toast via `setToast` when drag is NOT allowed (informs the
 *     user why the issue cannot be moved — read-only or non-draggable grouping).
 *
 * Render-disabling rules (the WHY):
 *   - `if (!issue) return null;` — the store may not yet have hydrated the id (optimistic insertions,
 *     pagination races). Returning null avoids rendering an empty/broken card.
 *   - `disabled={!!issue?.tempId}` on `ControlLink` — temporary IDs indicate a pending optimistic
 *     create that has no real route yet; clicking it would navigate to a non-existent URL.
 *
 * Z-index management (the WHY):
 *   - `z-[1]` is applied while `isCurrentBlockDragging` so the drag-image of the source card
 *     does not get visually overlapped by sibling cards during the drag operation.
 *
 * Inner `RenderIfVisible` (lazy mount):
 *   - The inner `KanbanIssueDetailsBlock` is wrapped in `RenderIfVisible` with `defaultHeight="100px"`
 *     so off-screen cards render only a 100px placeholder until scrolled into view, preserving
 *     scroll-anchor heights.
 *   - `shouldRenderByDefault` is propagated from the parent `KanbanIssueBlocksList` (true for the
 *     first 11 cards in each column).
 *
 * Consumers:
 *   - `./blocks-list.tsx` — instantiates one `KanbanIssueBlock` per issue id.
 */

import type { MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane helpers
import { MoreHorizontal } from "lucide-react";
import { useOutsideClickDetector } from "@plane/hooks";
// types
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import type { TIssue, IIssueDisplayProperties, IIssueMap } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// ui
import { ControlLink, DropIndicator } from "@plane/ui";
import { cn, generateWorkItemLink } from "@plane/utils";
// components
import RenderIfVisible from "@/components/core/render-if-visible-HOC";
import { HIGHLIGHT_CLASS, getIssueBlockId } from "@/components/issues/issue-layouts/utils";
// helpers
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useKanbanView } from "@/hooks/store/use-kanban-view";
import { useProject } from "@/hooks/store/use-project";
import useIssuePeekOverviewRedirection from "@/hooks/use-issue-peek-overview-redirection";
import { usePlatformOS } from "@/hooks/use-platform-os";
// plane web components
import { IssueIdentifier } from "@/plane-web/components/issues/issue-details/issue-identifier";
// local components
import { IssueStats } from "@/plane-web/components/issues/issue-layouts/issue-stats";
import type { TRenderQuickActions } from "../list/list-view-types";
import { IssueProperties } from "../properties/all-properties";
import { WithDisplayPropertiesHOC } from "../properties/with-display-properties-HOC";

/**
 * Props for the outer `KanbanIssueBlock` shell.
 *
 * `draggableId` is the composite id `<issueId>__<groupId>__<sub_group_id>` built in
 * `blocks-list.tsx`; it ensures multi-column rendering of the same issue (e.g. multi-label) yields
 * a unique DnD identity per location.
 */
interface IssueBlockProps {
  issueId: string;
  groupId: string;
  subGroupId: string;
  issuesMap: IIssueMap;
  displayProperties: IIssueDisplayProperties | undefined;
  draggableId: string;
  canDropOverIssue: boolean;
  canDragIssuesInCurrentGrouping: boolean;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  quickActions: TRenderQuickActions;
  canEditProperties: (projectId: string | undefined) => boolean;
  scrollableContainerRef?: MutableRefObject<HTMLDivElement | null>;
  shouldRenderByDefault?: boolean;
  isEpic?: boolean;
}

/**
 * Props for the internal `KanbanIssueDetailsBlock` content renderer.
 *
 * `cardRef` is forwarded so the quick-action menu can use it as the popper anchor.
 */
interface IssueDetailsBlockProps {
  cardRef: React.RefObject<HTMLElement>;
  issue: TIssue;
  displayProperties: IIssueDisplayProperties | undefined;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  quickActions: TRenderQuickActions;
  isReadOnly: boolean;
  isEpic?: boolean;
}

/**
 * Internal content renderer for a single Kanban card.
 *
 * Renders the issue identifier, hover-revealed quick-action menu, title (with tooltip), inline
 * properties row, and (epic mode) the sub-issue stats line gated by the
 * `display_properties.sub_issue_count` filter via `WithDisplayPropertiesHOC`.
 */
const KanbanIssueDetailsBlock = observer(function KanbanIssueDetailsBlock(props: IssueDetailsBlockProps) {
  const { cardRef, issue, updateIssue, quickActions, isReadOnly, displayProperties, isEpic = false } = props;
  // refs
  const menuActionRef = useRef<HTMLDivElement | null>(null);
  // states
  const [isMenuActive, setIsMenuActive] = useState(false);
  // hooks
  const { isMobile } = usePlatformOS();

  const customActionButton = (
    <div
      ref={menuActionRef}
      className={`flex h-full w-full cursor-pointer items-center rounded-sm p-1 text-placeholder hover:bg-layer-1 ${
        isMenuActive ? "bg-layer-1 text-primary" : "text-secondary"
      }`}
      onClick={() => setIsMenuActive(!isMenuActive)}
    >
      <MoreHorizontal className="h-3.5 w-3.5" />
    </div>
  );

  // derived values
  const subIssueCount = issue?.sub_issues_count ?? 0;

  const handleEventPropagation = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  useOutsideClickDetector(menuActionRef, () => setIsMenuActive(false));

  return (
    <>
      <div className="relative">
        {issue.project_id && (
          <IssueIdentifier
            issueId={issue.id}
            projectId={issue.project_id}
            size="xs"
            variant="tertiary"
            displayProperties={displayProperties}
          />
        )}
        <div
          className={cn("absolute -top-1 right-0", {
            "hidden group-hover/kanban-block:block": !isMobile,
            "!block": isMenuActive,
          })}
          onClick={handleEventPropagation}
        >
          {quickActions({
            issue,
            parentRef: cardRef,
            customActionButton,
          })}
        </div>
      </div>

      <Tooltip tooltipContent={issue.name} isMobile={isMobile} renderByDefault={false}>
        <div className="line-clamp-1 w-full text-body-sm-medium text-primary">
          <span>{issue.name}</span>
        </div>
      </Tooltip>

      <IssueProperties
        className="flex flex-wrap items-center gap-2 pt-1.5 whitespace-nowrap text-tertiary"
        issue={issue}
        displayProperties={displayProperties}
        activeLayout="Kanban"
        updateIssue={updateIssue}
        isReadOnly={isReadOnly}
        isEpic={isEpic}
      />

      {isEpic && displayProperties && (
        <WithDisplayPropertiesHOC
          displayProperties={displayProperties}
          displayPropertyKey="sub_issue_count"
          shouldRenderProperty={(properties) => !!properties.sub_issue_count && !!subIssueCount}
        >
          <IssueStats issueId={issue.id} className="mt-2 font-medium text-tertiary" />
        </WithDisplayPropertiesHOC>
      )}
    </>
  );
});

/** Outer Kanban card shell with DnD + lazy mount; see the module-level JSDoc for full semantics. */
export const KanbanIssueBlock = observer(function KanbanIssueBlock(props: IssueBlockProps) {
  const {
    issueId,
    groupId,
    subGroupId,
    issuesMap,
    displayProperties,
    canDropOverIssue,
    canDragIssuesInCurrentGrouping,
    updateIssue,
    quickActions,
    canEditProperties,
    scrollableContainerRef,
    shouldRenderByDefault,
    isEpic = false,
  } = props;

  const cardRef = useRef<HTMLAnchorElement | null>(null);
  // router
  const { workspaceSlug: routerWorkspaceSlug } = useParams();
  const workspaceSlug = routerWorkspaceSlug?.toString();
  // hooks
  const { getProjectIdentifierById } = useProject();
  const { getIsIssuePeeked } = useIssueDetail(isEpic ? EIssueServiceType.EPICS : EIssueServiceType.ISSUES);
  const { handleRedirection } = useIssuePeekOverviewRedirection(isEpic);
  const { isMobile } = usePlatformOS();

  // handlers
  const handleIssuePeekOverview = (issue: TIssue) => handleRedirection(workspaceSlug, issue, isMobile);

  const issue = issuesMap[issueId];

  const { setIsDragging: setIsKanbanDragging } = useKanbanView();

  const [isDraggingOverBlock, setIsDraggingOverBlock] = useState(false);
  const [isCurrentBlockDragging, setIsCurrentBlockDragging] = useState(false);

  const canEditIssueProperties = canEditProperties(issue?.project_id ?? undefined);

  const isDragAllowed = canDragIssuesInCurrentGrouping && !issue?.tempId && canEditIssueProperties;
  const projectIdentifier = getProjectIdentifierById(issue?.project_id);

  const workItemLink = generateWorkItemLink({
    workspaceSlug,
    projectId: issue?.project_id,
    issueId,
    projectIdentifier,
    sequenceId: issue?.sequence_id,
    isEpic,
    isArchived: !!issue?.archived_at,
  });

  useOutsideClickDetector(cardRef, () => {
    cardRef?.current?.classList?.remove(HIGHLIGHT_CLASS);
  });

  // Make Issue block both as as Draggable and,
  // as a DropTarget for other issues being dragged to get the location of drop
  useEffect(() => {
    const element = cardRef.current;

    if (!element) return;

    return combine(
      draggable({
        element,
        dragHandle: element,
        canDrag: () => isDragAllowed,
        getInitialData: () => ({ id: issue?.id, type: "ISSUE" }),
        onDragStart: () => {
          setIsCurrentBlockDragging(true);
          setIsKanbanDragging(true);
        },
        onDrop: () => {
          setIsKanbanDragging(false);
          setIsCurrentBlockDragging(false);
        },
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => source?.data?.id !== issue?.id && canDropOverIssue,
        getData: () => ({ id: issue?.id, type: "ISSUE" }),
        onDragEnter: () => {
          setIsDraggingOverBlock(true);
        },
        onDragLeave: () => {
          setIsDraggingOverBlock(false);
        },
        onDrop: () => {
          setIsDraggingOverBlock(false);
        },
      })
    );
  }, [cardRef?.current, issue?.id, isDragAllowed, canDropOverIssue, setIsCurrentBlockDragging, setIsDraggingOverBlock]);

  if (!issue) return null;

  return (
    <>
      <DropIndicator isVisible={!isCurrentBlockDragging && isDraggingOverBlock} />
      <div
        id={`issue-${issueId}`}
        // make Z-index higher at the beginning of drag, to have a issue drag image of issue block without any overlaps
        className={cn("group/kanban-block relative mb-2", { "z-[1]": isCurrentBlockDragging })}
        onDragStart={() => {
          if (isDragAllowed) setIsCurrentBlockDragging(true);
          else {
            setToast({
              type: TOAST_TYPE.WARNING,
              title: "Cannot move work item",
              message: !canEditIssueProperties
                ? "You are not allowed to move this work item"
                : "Drag and drop is disabled for the current grouping",
            });
          }
        }}
      >
        <ControlLink
          id={getIssueBlockId(issueId, groupId, subGroupId)}
          href={workItemLink}
          ref={cardRef}
          className={cn(
            "block w-full rounded-lg border border-subtle bg-layer-2 p-3 text-13 shadow-raised-100 outline-[0.5px] outline-transparent transition-all hover:border-strong hover:shadow-raised-200",
            { "hover:cursor-pointer": isDragAllowed },
            { "border border-accent-strong hover:border-accent-strong": getIsIssuePeeked(issue.id) },
            { "z-[100] bg-layer-1": isCurrentBlockDragging }
          )}
          onClick={() => handleIssuePeekOverview(issue)}
          disabled={!!issue?.tempId}
        >
          <RenderIfVisible
            classNames="space-y-2"
            root={scrollableContainerRef}
            defaultHeight="100px"
            horizontalOffset={100}
            verticalOffset={200}
            defaultValue={shouldRenderByDefault}
          >
            <KanbanIssueDetailsBlock
              cardRef={cardRef}
              issue={issue}
              displayProperties={displayProperties}
              updateIssue={updateIssue}
              quickActions={quickActions}
              isReadOnly={!canEditIssueProperties}
              isEpic={isEpic}
            />
          </RenderIfVisible>
        </ControlLink>
      </div>
    </>
  );
});
