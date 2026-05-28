/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `SubIssueDisplayFilters` — dropdown UI for configuring how the sub-issues list is displayed: which display properties are visible,
 * how rows are grouped, and how they are ordered. Renders only when the supplied layout options enable display filters; renders the
 * order-by section only when the layout exposes order-by options.
 *
 * Props (TSubIssueDisplayFiltersProps):
 *   - displayProperties (IIssueDisplayProperties, required): Current display-property selection bag (e.g. show/hide labels, assignee).
 *   - displayFilters (IIssueDisplayFilterOptions, required): Current group-by/order-by selection bag.
 *   - handleDisplayFiltersUpdate ((updatedDisplayFilter: Partial<IIssueDisplayFilterOptions>) => void, required): Callback invoked when a display-filter section changes — forwarded to `FilterGroupBy` and `FilterOrderBy`. The parent (`SubWorkItemTitleActions`) dispatches the actual MobX action.
 *   - handleDisplayPropertiesUpdate ((updatedDisplayProperties: Partial<IIssueDisplayProperties>) => void, required): Callback invoked when a display-property toggle flips — forwarded to `FilterDisplayProperties`.
 *   - layoutDisplayFiltersOptions (ILayoutDisplayFiltersOptions | undefined, required): Layout-specific option set sourced from `ISSUE_DISPLAY_FILTERS_BY_PAGE["sub_work_items"].layoutOptions.list`; gates the entire render and each sub-section.
 *   - isEpic (boolean, optional, default `false`): Forwarded to `FilterDisplayProperties` so epic-only display properties are surfaced/hidden correctly.
 *
 * MobX stores read:
 *   - NONE directly — this component is presentational. It re-renders when its `displayProperties` / `displayFilters` props change, and the parent owns the store wiring.
 *
 * Side effects:
 *   - None directly — invokes the supplied `handleDisplay*Update` callbacks; the parent maps those to MobX actions on `subIssues.filters`.
 *   - No service calls, no toasts, no navigation.
 *   - The `bg-accent-primary/20` highlight + dot indicator on the trigger is purely visual feedback driven by `isFilterApplied = isDisplayFiltersApplied({ displayProperties, displayFilters })`.
 */

import { useMemo } from "react";
import { isEmpty } from "lodash-es";
import { observer } from "mobx-react";
import { SlidersHorizontal } from "lucide-react";
// plane imports
import type { IIssueDisplayFilterOptions, ILayoutDisplayFiltersOptions, IIssueDisplayProperties } from "@plane/types";
import { cn } from "@plane/utils";
// components
import {
  FilterDisplayProperties,
  FilterGroupBy,
  FilterOrderBy,
  FiltersDropdown,
} from "@/components/issues/issue-layouts/filters";
import { isDisplayFiltersApplied } from "@/components/issues/issue-layouts/utils";
type TSubIssueDisplayFiltersProps = {
  displayProperties: IIssueDisplayProperties;
  displayFilters: IIssueDisplayFilterOptions;
  handleDisplayFiltersUpdate: (updatedDisplayFilter: Partial<IIssueDisplayFilterOptions>) => void;
  handleDisplayPropertiesUpdate: (updatedDisplayProperties: Partial<IIssueDisplayProperties>) => void;
  layoutDisplayFiltersOptions: ILayoutDisplayFiltersOptions | undefined;
  isEpic?: boolean;
};

export const SubIssueDisplayFilters = observer(function SubIssueDisplayFilters(props: TSubIssueDisplayFiltersProps) {
  const {
    isEpic = false,
    displayProperties,
    layoutDisplayFiltersOptions,
    handleDisplayPropertiesUpdate,
    handleDisplayFiltersUpdate,
    displayFilters,
  } = props;

  const isFilterApplied = useMemo(
    () => isDisplayFiltersApplied({ displayProperties, displayFilters }),
    [displayProperties, displayFilters]
  );

  return (
    <>
      {layoutDisplayFiltersOptions?.display_filters && layoutDisplayFiltersOptions?.display_properties.length > 0 && (
        <FiltersDropdown
          placement="bottom-end"
          menuButton={
            <div
              className={cn(
                "relative rounded-sm p-1 transition-all duration-200",
                isFilterApplied && "bg-accent-primary/20"
              )}
            >
              {isFilterApplied && <span className="absolute -top-1 -right-1 rounded-full bg-accent-primary p-1" />}
              <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
            </div>
          }
        >
          <div className="vertical-scrollbar relative scrollbar-sm h-full max-h-[25rem] w-full divide-y divide-subtle-1 overflow-hidden overflow-y-auto px-2.5 text-left">
            {/* display properties */}
            <div className="py-2">
              <FilterDisplayProperties
                displayProperties={displayProperties}
                displayPropertiesToRender={layoutDisplayFiltersOptions.display_properties}
                handleUpdate={handleDisplayPropertiesUpdate}
                isEpic={isEpic}
              />
            </div>

            {/* group by */}
            <div className="py-2">
              <FilterGroupBy
                displayFilters={displayFilters}
                groupByOptions={layoutDisplayFiltersOptions?.display_filters.group_by ?? []}
                handleUpdate={(val) =>
                  handleDisplayFiltersUpdate({
                    group_by: val,
                  })
                }
                ignoreGroupedFilters={[]}
              />
            </div>

            {/* order by */}
            {!isEmpty(layoutDisplayFiltersOptions?.display_filters?.order_by) && (
              <div className="py-2">
                <FilterOrderBy
                  selectedOrderBy={displayFilters?.order_by}
                  handleUpdate={(val) =>
                    handleDisplayFiltersUpdate({
                      order_by: val,
                    })
                  }
                  orderByOptions={layoutDisplayFiltersOptions?.display_filters.order_by ?? []}
                />
              </div>
            )}
          </div>
        </FiltersDropdown>
      )}
    </>
  );
});
