/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Display-filters dropdown orchestrator.
 *
 * Rendered purpose: composes the per-section sub-components (group-by, sub-group-by, order-by,
 * display-properties, extra-options) into a single panel, gating each section's visibility against
 * the `layoutDisplayFiltersOptions` schema so layouts only surface display filters they support.
 *
 * Props (`Props`):
 *   - `displayFilters` (`IIssueDisplayFilterOptions | undefined`, required): current display-filter
 *     state (`group_by`, `sub_group_by`, `order_by`, `layout`, etc.)
 *   - `displayProperties` (`IIssueDisplayProperties`, required): per-card-visibility map
 *     (`assignee`, `due_date`, `labels`, etc.)
 *   - `handleDisplayFiltersUpdate` (`(partial: Partial<IIssueDisplayFilterOptions>) => void`,
 *     required): partial-update callback. Parent persists via
 *     `issuesFilter.updateFilters(workspaceSlug, projectId, EIssueFilterType.DISPLAY_FILTERS,
 *     <partial>)`.
 *   - `handleDisplayPropertiesUpdate`
 *     (`(partial: Partial<IIssueDisplayProperties>) => void`, required): partial-update callback.
 *     Parent persists via `EIssueFilterType.DISPLAY_PROPERTIES`.
 *   - `layoutDisplayFiltersOptions` (`ILayoutDisplayFiltersOptions | undefined`, required): the
 *     schema that gates which display filters / display properties / extra options the active layout
 *     supports. Sourced from `ISSUE_DISPLAY_FILTERS_BY_PAGE` in `@plane/constants`.
 *   - `ignoreGroupedFilters` (`Partial<TIssueGroupByOptions>[]`, optional): group-by keys to hide
 *     (e.g. when the page already filters by that key).
 *   - `cycleViewDisabled` (`boolean`, optional, default `false`): hide cycle-based group-by.
 *   - `moduleViewDisabled` (`boolean`, optional, default `false`): hide module-based group-by.
 *   - `isEpic` (`boolean`, optional, default `false`): toggle epic-aware copy.
 *
 * MobX stores read: none directly — pure orchestration; delegates persistence to caller.
 *
 * Side effects: none. Section callbacks invoke `handleDisplayFiltersUpdate` /
 * `handleDisplayPropertiesUpdate`; persistence and any follow-on re-fetching are the parent's
 * responsibility. No router navigation.
 */

import React from "react";
import { isEmpty } from "lodash-es";
import { observer } from "mobx-react";
import type {
  IIssueDisplayFilterOptions,
  IIssueDisplayProperties,
  ILayoutDisplayFiltersOptions,
  TIssueGroupByOptions,
} from "@plane/types";
// components
import {
  FilterDisplayProperties,
  FilterExtraOptions,
  FilterGroupBy,
  FilterOrderBy,
  FilterSubGroupBy,
} from "@/components/issues/issue-layouts/filters";

type Props = {
  displayFilters: IIssueDisplayFilterOptions | undefined;
  displayProperties: IIssueDisplayProperties;
  handleDisplayFiltersUpdate: (updatedDisplayFilter: Partial<IIssueDisplayFilterOptions>) => void;
  handleDisplayPropertiesUpdate: (updatedDisplayProperties: Partial<IIssueDisplayProperties>) => void;
  layoutDisplayFiltersOptions: ILayoutDisplayFiltersOptions | undefined;
  ignoreGroupedFilters?: Partial<TIssueGroupByOptions>[];
  cycleViewDisabled?: boolean;
  moduleViewDisabled?: boolean;
  isEpic?: boolean;
};

export const DisplayFiltersSelection = observer(function DisplayFiltersSelection(props: Props) {
  const {
    displayFilters,
    displayProperties,
    handleDisplayFiltersUpdate,
    handleDisplayPropertiesUpdate,
    layoutDisplayFiltersOptions,
    ignoreGroupedFilters = [],
    cycleViewDisabled = false,
    moduleViewDisabled = false,
    isEpic = false,
  } = props;

  /**
   * Section visibility predicate: each display filter is rendered ONLY when
   * `layoutDisplayFiltersOptions.<section>` lists its key. Different layouts surface different
   * subsets (e.g. Spreadsheet hides sub-group-by; Calendar hides order-by) — the gate prevents the
   * dropdown from rendering controls that would not affect the active layout.
   */
  const isDisplayFilterEnabled = (displayFilter: keyof IIssueDisplayFilterOptions) =>
    Object.keys(layoutDisplayFiltersOptions?.display_filters ?? {}).includes(displayFilter);

  const computedIgnoreGroupedFilters: Partial<TIssueGroupByOptions>[] = [];
  if (cycleViewDisabled) {
    ignoreGroupedFilters.push("cycle");
  }
  if (moduleViewDisabled) {
    ignoreGroupedFilters.push("module");
  }

  return (
    <div className="vertical-scrollbar relative scrollbar-sm h-full w-full divide-y divide-subtle-1 overflow-hidden overflow-y-auto px-2.5">
      {/* display properties */}
      {layoutDisplayFiltersOptions?.display_properties && layoutDisplayFiltersOptions.display_properties.length > 0 && (
        <div className="py-2">
          <FilterDisplayProperties
            displayProperties={displayProperties}
            displayPropertiesToRender={layoutDisplayFiltersOptions.display_properties}
            handleUpdate={handleDisplayPropertiesUpdate}
            cycleViewDisabled={cycleViewDisabled}
            moduleViewDisabled={moduleViewDisabled}
            isEpic={isEpic}
          />
        </div>
      )}

      {/* group by */}
      {isDisplayFilterEnabled("group_by") && (
        <div className="py-2">
          <FilterGroupBy
            displayFilters={displayFilters}
            groupByOptions={layoutDisplayFiltersOptions?.display_filters.group_by ?? []}
            handleUpdate={(val) =>
              handleDisplayFiltersUpdate({
                group_by: val,
              })
            }
            ignoreGroupedFilters={[...ignoreGroupedFilters, ...computedIgnoreGroupedFilters]}
          />
        </div>
      )}

      {/* sub-group by */}
      {isDisplayFilterEnabled("sub_group_by") &&
        displayFilters?.group_by !== null &&
        displayFilters?.layout === "kanban" && (
          <div className="py-2">
            <FilterSubGroupBy
              displayFilters={displayFilters}
              handleUpdate={(val) =>
                handleDisplayFiltersUpdate({
                  sub_group_by: val,
                })
              }
              subGroupByOptions={layoutDisplayFiltersOptions?.display_filters.sub_group_by ?? []}
              ignoreGroupedFilters={[...ignoreGroupedFilters, ...computedIgnoreGroupedFilters]}
            />
          </div>
        )}

      {/* order by */}
      {isDisplayFilterEnabled("order_by") && !isEmpty(layoutDisplayFiltersOptions?.display_filters?.order_by) && (
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

      {/* Options */}
      {layoutDisplayFiltersOptions?.extra_options.access && (
        <div className="py-2">
          <FilterExtraOptions
            selectedExtraOptions={{
              show_empty_groups: displayFilters?.show_empty_groups ?? true,
              sub_issue: displayFilters?.sub_issue ?? true,
            }}
            handleUpdate={(key, val) =>
              handleDisplayFiltersUpdate({
                [key]: val,
              })
            }
            enabledExtraOptions={layoutDisplayFiltersOptions?.extra_options.values}
          />
        </div>
      )}
    </div>
  );
});
