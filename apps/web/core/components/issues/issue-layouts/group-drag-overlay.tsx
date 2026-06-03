/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Drop-zone overlay for grouped layouts (Kanban / List groups).
 *
 * Rendered purpose: an absolutely-positioned `<div>` that becomes visible while an issue is being
 * dragged into a column. Shows one of three messages — workflow-disabled callout, drop-error
 * callout, or "Drop here to move {work item|epic}" with the readable `orderBy` label.
 *
 * Props (Props):
 *   - dragColumnOrientation ("justify-start" | "justify-center" | "justify-end", required): alignment
 *     of the overlay message within the column; List columns typically use start, Kanban columns use center
 *   - workflowDisabledSource (string, optional): when provided, the workflow-disabled overlay is rendered
 *     instead of the standard drop hint (the source string identifies the disallowed transition for the
 *     `WorkFlowDisabledOverlay`)
 *   - canOverlayBeVisible (boolean, required): caller-controlled gate for whether the overlay should appear
 *     even when `isDraggingOverColumn` is true (lets callers prevent the overlay during incompatible drag types)
 *   - isDropDisabled (boolean, required): when true, the overlay tints to the danger color and shows
 *     `dropErrorMessage`
 *   - dropErrorMessage (string, optional): the error caption rendered when the drop is disabled
 *   - orderBy (TIssueOrderByOptions | undefined, required): the current sort key; mapped via `ISSUE_ORDER_BY_OPTIONS`
 *     to a translated label that is displayed in the standard hint message
 *   - isDraggingOverColumn (boolean, required): set by the drag-and-drop monitor; combined with
 *     `canOverlayBeVisible` to compute final visibility
 *   - isEpic (boolean, optional, default=false): swaps the moved-entity copy between "work item" and "epic"
 *
 * MobX stores read: none — purely caller-driven state.
 *
 * Side effects: none — render-only.
 *
 * Imperative / derived state notes:
 *   - `messageContainerRef` is forwarded into `WorkFlowDisabledOverlay` so that the workflow callout can
 *     position itself within the overlay container.
 *   - `shouldOverlayBeVisible = isDraggingOverColumn && canOverlayBeVisible`; this is the final gate.
 *   - Tailwind `hidden` class is applied when the overlay should not be visible, keeping the element in
 *     the DOM for layout stability and avoiding remount churn during drag operations.
 */
import { useRef } from "react";
import { AlertCircle } from "lucide-react";
// plane imports
import { ISSUE_ORDER_BY_OPTIONS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { TIssueOrderByOptions } from "@plane/types";
// helpers
import { cn } from "@plane/utils";
// plane web imports
import { WorkFlowDisabledOverlay } from "@/plane-web/components/workflow";

/** Props for `GroupDragOverlay`. */
type Props = {
  dragColumnOrientation: "justify-start" | "justify-center" | "justify-end";
  workflowDisabledSource?: string;
  canOverlayBeVisible: boolean;
  isDropDisabled: boolean;
  dropErrorMessage?: string;
  orderBy: TIssueOrderByOptions | undefined;
  isDraggingOverColumn: boolean;
  isEpic?: boolean;
};

/** Drop-zone overlay for grouped layouts; see the module-level JSDoc for full semantics. */
export function GroupDragOverlay(props: Props) {
  const {
    dragColumnOrientation,
    canOverlayBeVisible,
    workflowDisabledSource,
    isDropDisabled,
    dropErrorMessage,
    orderBy,
    isDraggingOverColumn,
    isEpic = false,
  } = props;
  // hooks
  const { t } = useTranslation();
  // refs
  const messageContainerRef = useRef<HTMLDivElement>(null);

  const shouldOverlayBeVisible = isDraggingOverColumn && canOverlayBeVisible;
  const readableOrderBy = t(
    ISSUE_ORDER_BY_OPTIONS.find((orderByObj) => orderByObj.key === orderBy)?.titleTranslationKey || ""
  );

  return (
    <div
      ref={messageContainerRef}
      className={cn(
        `absolute top-0 left-0 h-full w-full items-center rounded-sm bg-layer-1/85 text-13 font-medium text-tertiary ${dragColumnOrientation}`,
        {
          "z-2 flex flex-col border-[1px] border-strong": shouldOverlayBeVisible,
          "bg-danger-subtle": workflowDisabledSource && isDropDisabled,
        },
        { hidden: !shouldOverlayBeVisible }
      )}
    >
      {workflowDisabledSource ? (
        <WorkFlowDisabledOverlay
          messageContainerRef={messageContainerRef}
          workflowDisabledSource={workflowDisabledSource}
          shouldOverlayBeVisible={shouldOverlayBeVisible}
        />
      ) : (
        <div
          className={cn("my-8 flex flex-col items-center rounded-sm p-3", {
            "text-secondary": shouldOverlayBeVisible,
            "text-danger-secondary": isDropDisabled,
          })}
        >
          {dropErrorMessage ? (
            <div className="flex items-center">
              <AlertCircle width={13} height={13} /> &nbsp;
              <span>{dropErrorMessage}</span>
            </div>
          ) : (
            <>
              {readableOrderBy && (
                <span>
                  {t("issue.layouts.ordered_by_label")} <span className="font-semibold">{t(readableOrderBy)}</span>.
                </span>
              )}
              <span>{t("entity.drop_here_to_move", { entity: isEpic ? "epic" : "work item" })}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
