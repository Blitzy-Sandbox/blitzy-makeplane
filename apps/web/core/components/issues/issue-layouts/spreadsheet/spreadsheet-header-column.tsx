/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Per-property header `<th>` wrapper for the spreadsheet layout.
 *
 * Rendered purpose: wraps each property column's header in a focusable, sort-aware `<th>`. It (a)
 * gates rendering through `WithDisplayPropertiesHOC` + `shouldRenderColumn(property)` so the column
 * appears only when the property is enabled AND `shouldRenderColumn` returns true, and (b) delegates
 * the actual interactive sort menu to the nested `<HeaderColumn>` from the local `columns/` subfolder.
 * The wrapper also restores focus to the `<th>` after the sort menu closes (`onClose` callback).
 *
 * Props (Props):
 *   - displayProperties (IIssueDisplayProperties, required): the active property visibility map;
 *     forwarded to `WithDisplayPropertiesHOC` for property gating
 *   - property (keyof IIssueDisplayProperties, required): the property key for this column
 *   - isEstimateEnabled (boolean, required): part of the shared header prop contract; not consumed
 *     directly by this wrapper but kept for parity with sibling props
 *   - displayFilters (IIssueDisplayFilterOptions, required): the active sort / display filter state
 *     forwarded into `<HeaderColumn>` for sort-indicator + sort-menu rendering
 *   - handleDisplayFilterUpdate ((data) => void, required): callback to persist sort changes from
 *     the header menu
 *   - isEpic (boolean, optional, default=false): forwarded into `<HeaderColumn>` for epic-aware
 *     labelling
 *
 * MobX stores read: none — pure prop-driven wrapper.
 *
 * Side effects:
 *   - On `onClose` of the header sort menu, calls `tableHeaderCellRef.current?.focus()` to restore
 *     focus to the `<th>` element (imperative DOM focus management — required so keyboard users
 *     are not stranded after dismissing the menu).
 *
 * Derived state / conditional rendering (the WHY):
 *   - `shouldRenderProperty` is derived from `shouldRenderColumn(property)` and passed to
 *     `WithDisplayPropertiesHOC` as the `shouldRenderProperty` predicate. This keeps property
 *     visibility logic centralised in the helper (display-properties gate is layered with
 *     property-specific gates such as "do not render `created_by` in workspace contexts").
 *
 * Consumers:
 *   - `./spreadsheet-header.tsx` — instantiated once per property in `spreadsheetColumnsList`.
 */

import { useRef } from "react";
//types
import { observer } from "mobx-react";
import type { IIssueDisplayFilterOptions, IIssueDisplayProperties } from "@plane/types";
//components
import { shouldRenderColumn } from "@/helpers/issue-filter.helper";
import { WithDisplayPropertiesHOC } from "../properties/with-display-properties-HOC";
import { HeaderColumn } from "./columns/header-column";

/** Props for `SpreadsheetHeaderColumn`. */
interface Props {
  displayProperties: IIssueDisplayProperties;
  property: keyof IIssueDisplayProperties;
  isEstimateEnabled: boolean;
  displayFilters: IIssueDisplayFilterOptions;
  handleDisplayFilterUpdate: (data: Partial<IIssueDisplayFilterOptions>) => void;
  isEpic?: boolean;
}
/** Per-property header `<th>` wrapper; see the module-level JSDoc for full semantics. */
export const SpreadsheetHeaderColumn = observer(function SpreadsheetHeaderColumn(props: Props) {
  const { displayProperties, displayFilters, property, handleDisplayFilterUpdate, isEpic = false } = props;

  //hooks
  const tableHeaderCellRef = useRef<HTMLTableCellElement | null>(null);

  const shouldRenderProperty = shouldRenderColumn(property);

  return (
    <WithDisplayPropertiesHOC
      displayProperties={displayProperties}
      displayPropertyKey={property}
      shouldRenderProperty={() => shouldRenderProperty}
    >
      <th
        className="h-11 min-w-36 items-center border border-t-0 border-b-0 border-subtle bg-layer-1 py-1 text-13 font-medium"
        ref={tableHeaderCellRef}
        tabIndex={0}
      >
        <HeaderColumn
          displayFilters={displayFilters}
          handleDisplayFilterUpdate={handleDisplayFilterUpdate}
          property={property}
          onClose={() => {
            tableHeaderCellRef?.current?.focus();
          }}
          isEpic={isEpic}
        />
      </th>
    </WithDisplayPropertiesHOC>
  );
});
