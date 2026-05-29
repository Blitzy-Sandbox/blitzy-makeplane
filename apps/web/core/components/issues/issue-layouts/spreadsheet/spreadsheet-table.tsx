/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `<table>` shell for the spreadsheet issue layout.
 *
 * Rendered purpose: builds the actual HTML table shell combining `<SpreadsheetHeader>`, one
 * `<SpreadsheetIssueRow>` per issue id, and an optional `<tfoot>` infinite-scroll loader. It also
 * (a) applies a scroll-shadow style to the leading sticky column when the table is horizontally
 * scrolled, (b) handles spreadsheet keyboard navigation, and (c) wires the intersection observer
 * that triggers pagination as the user scrolls.
 *
 * Props (Props):
 *   - displayProperties (IIssueDisplayProperties, required): which columns to render in this table
 *   - displayFilters (IIssueDisplayFilterOptions, required): active sort / filter state passed to
 *     header for sort-indicator rendering
 *   - handleDisplayFilterUpdate ((data) => void, required): callback to persist display-filter
 *     changes from header sort menu
 *   - issueIds (string[], required): the flat list of issue ids; each becomes a top-level
 *     `<SpreadsheetIssueRow>`
 *   - isEstimateEnabled (boolean, required): when false, the estimate column is excluded from
 *     `displayPropertiesCount` (the loader skeleton width adjusts accordingly)
 *   - quickActions (TRenderQuickActions, required): per-row quick-action render-prop
 *   - updateIssue (mutator, required): inline-cell-edit mutator passed to every row
 *   - canEditProperties ((projectId) => boolean, required): per-project edit gate
 *   - portalElement (MutableRefObject<HTMLDivElement | null>, required): shared portal container
 *     for cell dropdowns
 *   - containerRef (MutableRefObject<HTMLTableElement | null>, required): the scrollable container
 *     element used by both the intersection observer and the scroll-shadow handler
 *   - canLoadMoreIssues (boolean, required): when true, render the `<tfoot>` skeleton + observer
 *   - loadMoreIssues (() => void, required): paginator callback invoked when the `<tfoot>`
 *     intersection target enters the viewport
 *   - spreadsheetColumnsList ((keyof IIssueDisplayProperties)[], required): the actual columns to
 *     render (already feature-flag-filtered by `SpreadsheetView`)
 *   - selectionHelpers (TSelectionHelper, required): bulk-selection helpers from `<MultipleSelectGroup>`
 *   - isEpic (boolean, optional, default=false): epic-mode flag forwarded into header + rows
 *
 * MobX stores read:
 *   - `useIssuesStore()` exposes `issues.getIssueLoader()` — checked to suspend the intersection
 *     observer while a paginate-next call is already in flight (prevents duplicate fetches).
 *
 * Side effects (imperative DOM operations — required by Directive 2):
 *   - `handleScroll` listener (attached on mount, removed on unmount) reads `containerRef.current.scrollLeft`
 *     and mutates the `boxShadow` style of every leading sticky `<th>` / `<td>` to produce a shadow
 *     when the user has scrolled horizontally. Direct DOM mutation is used INSTEAD OF re-rendering
 *     to keep large issue tables performant (re-rendering every row on each scroll event would be
 *     prohibitively expensive — preserved per the existing inline comment at line 77).
 *   - `useIntersectionObserver(containerRef, ... , loadMoreIssues, ...)` wires infinite scroll;
 *     suspended when `isPaginating` is true.
 *   - `useTableKeyboardNavigation()` returns a `onKeyDown` handler that implements arrow-key
 *     navigation across spreadsheet cells (focus-management is delegated to the hook).
 *
 * Derived state:
 *   - `displayPropertiesCount = getDisplayPropertiesCount(displayProperties, ignoreFieldsForCounting)`
 *     where `ignoreFieldsForCounting` always excludes `"key"` and additionally excludes `"estimate"`
 *     when the project has no estimate scale. This count is used solely to size the `<tfoot>` skeleton.
 *
 * Consumers:
 *   - `./spreadsheet-view.tsx` — the only consumer; this module is not exported via a barrel.
 */

import type { MutableRefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import type { IIssueDisplayFilterOptions, IIssueDisplayProperties, TIssue } from "@plane/types";
// components
import { SpreadsheetIssueRowLoader } from "@/components/ui/loader/layouts/spreadsheet-layout-loader";
// hooks
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useIssuesStore } from "@/hooks/use-issue-layout-store";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
import { useTableKeyboardNavigation } from "@/hooks/use-table-keyboard-navigation";
// local imports
import type { TRenderQuickActions } from "../list/list-view-types";
import { getDisplayPropertiesCount } from "../utils";
import { SpreadsheetIssueRow } from "./issue-row";
import { SpreadsheetHeader } from "./spreadsheet-header";

/** Props for `SpreadsheetTable`. */
type Props = {
  displayProperties: IIssueDisplayProperties;
  displayFilters: IIssueDisplayFilterOptions;
  handleDisplayFilterUpdate: (data: Partial<IIssueDisplayFilterOptions>) => void;
  issueIds: string[];
  isEstimateEnabled: boolean;
  quickActions: TRenderQuickActions;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  canEditProperties: (projectId: string | undefined) => boolean;
  portalElement: React.MutableRefObject<HTMLDivElement | null>;
  containerRef: MutableRefObject<HTMLTableElement | null>;
  canLoadMoreIssues: boolean;
  loadMoreIssues: () => void;
  spreadsheetColumnsList: (keyof IIssueDisplayProperties)[];
  selectionHelpers: TSelectionHelper;
  isEpic?: boolean;
};

/** Table shell for the spreadsheet layout; see the module-level JSDoc for full semantics. */
export const SpreadsheetTable = observer(function SpreadsheetTable(props: Props) {
  const {
    displayProperties,
    displayFilters,
    handleDisplayFilterUpdate,
    issueIds,
    isEstimateEnabled,
    portalElement,
    quickActions,
    updateIssue,
    canEditProperties,
    canLoadMoreIssues,
    containerRef,
    loadMoreIssues,
    spreadsheetColumnsList,
    selectionHelpers,
    isEpic = false,
  } = props;

  // states
  const isScrolled = useRef(false);
  const [intersectionElement, setIntersectionElement] = useState<HTMLTableSectionElement | null>(null);

  const {
    issues: { getIssueLoader },
  } = useIssuesStore();

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const scrollLeft = containerRef.current.scrollLeft;

    const columnShadow = "8px 22px 22px 10px rgba(0, 0, 0, 0.05)"; // shadow for regular columns
    const headerShadow = "8px -22px 22px 10px rgba(0, 0, 0, 0.05)"; // shadow for headers

    //The shadow styles are added this way to avoid re-render of all the rows of table, which could be costly
    if (scrollLeft > 0 !== isScrolled.current) {
      const firstColumns = containerRef.current.querySelectorAll("table tr td:first-child, th:first-child");

      for (let i = 0; i < firstColumns.length; i++) {
        const shadow = i === 0 ? headerShadow : columnShadow;
        if (scrollLeft > 0) {
          (firstColumns[i] as HTMLElement).style.boxShadow = shadow;
        } else {
          (firstColumns[i] as HTMLElement).style.boxShadow = "none";
        }
      }
      isScrolled.current = scrollLeft > 0;
    }
  }, [containerRef]);

  useEffect(() => {
    const currentContainerRef = containerRef.current;

    if (currentContainerRef) currentContainerRef.addEventListener("scroll", handleScroll);

    return () => {
      if (currentContainerRef) currentContainerRef.removeEventListener("scroll", handleScroll);
    };
  }, [handleScroll, containerRef]);

  const isPaginating = !!getIssueLoader();

  useIntersectionObserver(containerRef, isPaginating ? null : intersectionElement, loadMoreIssues, `100% 0% 100% 0%`);

  const handleKeyBoardNavigation = useTableKeyboardNavigation();

  const ignoreFieldsForCounting: (keyof IIssueDisplayProperties)[] = ["key"];
  if (!isEstimateEnabled) ignoreFieldsForCounting.push("estimate");
  const displayPropertiesCount = getDisplayPropertiesCount(displayProperties, ignoreFieldsForCounting);

  return (
    <table className="w-full overflow-y-auto bg-surface-1" onKeyDown={handleKeyBoardNavigation}>
      <SpreadsheetHeader
        displayProperties={displayProperties}
        displayFilters={displayFilters}
        handleDisplayFilterUpdate={handleDisplayFilterUpdate}
        canEditProperties={canEditProperties}
        isEstimateEnabled={isEstimateEnabled}
        spreadsheetColumnsList={spreadsheetColumnsList}
        selectionHelpers={selectionHelpers}
        isEpic={isEpic}
      />
      <tbody>
        {issueIds.map((id) => (
          <SpreadsheetIssueRow
            key={id}
            issueId={id}
            displayProperties={displayProperties}
            quickActions={quickActions}
            canEditProperties={canEditProperties}
            nestingLevel={0}
            isEstimateEnabled={isEstimateEnabled}
            updateIssue={updateIssue}
            portalElement={portalElement}
            containerRef={containerRef}
            isScrolled={isScrolled}
            spreadsheetColumnsList={spreadsheetColumnsList}
            selectionHelpers={selectionHelpers}
            isEpic={isEpic}
          />
        ))}
      </tbody>
      {canLoadMoreIssues && (
        <tfoot ref={setIntersectionElement}>
          {Array.from({ length: 3 }).map((_, index) => (
            <SpreadsheetIssueRowLoader key={index} columnCount={displayPropertiesCount} />
          ))}
        </tfoot>
      )}
    </table>
  );
});
