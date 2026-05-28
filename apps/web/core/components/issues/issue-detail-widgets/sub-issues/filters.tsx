/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `SubIssueFilters` — searchable dropdown that filters the sub-issues list by priority, state-group, state, project,
 * work-item type, assignees, start date, and target date. Each section is gated by membership in `availableFilters`,
 * which is supplied by the parent (`SubWorkItemTitleActions`) from the `SUB_WORK_ITEM_AVAILABLE_FILTERS_FOR_WORK_ITEM_PAGE`
 * constant. A local search query narrows the visible options inside each section.
 *
 * Props (TSubIssueFiltersProps):
 *   - handleFiltersUpdate ((key, value) => void, required): Callback invoked when any section's selection changes; the parent maps the call to a MobX action on `subIssues.filters`.
 *   - filters (IIssueFilterOptions, required): Current applied-filter bag; each section reads its own slot (`filters.priority`, `filters.state`, etc.) and the trigger reads the whole bag to compute `isFilterApplied`.
 *   - memberIds (string[] | undefined, required): Project member ids supplied to `FilterAssignees`; undefined falls back to "no members" inside the dropdown.
 *   - states (IState[], optional): Project states supplied to `FilterState`; undefined hides project-specific state options.
 *   - availableFilters ((keyof IIssueFilterOptions)[], required): The set of filter keys this dropdown should show; sourced from `@plane/constants` (`SUB_WORK_ITEM_AVAILABLE_FILTERS_FOR_WORK_ITEM_PAGE`).
 *
 * MobX stores read:
 *   - NONE directly — this component is presentational and `observer`-wrapped only because its child filter primitives are observers and the wrapper keeps it harmless in MobX update batches.
 *
 * Side effects:
 *   - None directly — invokes `handleFiltersUpdate(key, value)` callback; the parent maps each call to `updateSubWorkItemFilters(EIssueFilterType.FILTERS, { [key]: value }, parentId)` on the `subIssues.filters` slice.
 *   - The trigger's `bg-accent-primary/20` background + dot indicator are visual feedback driven by `isFilterApplied = isFiltersApplied(filters)`.
 *   - The local `filtersSearchQuery` state is component-local; it does NOT mutate any store and resets on unmount.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import { ListFilter } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { SearchIcon, CloseIcon } from "@plane/propel/icons";
import type { IIssueFilterOptions, IState } from "@plane/types";
import { cn } from "@plane/utils";
import {
  FilterAssignees,
  FilterDueDate,
  FilterPriority,
  FilterProjects,
  FiltersDropdown,
  FilterStartDate,
  FilterState,
  FilterStateGroup,
} from "@/components/issues/issue-layouts/filters";
import { isFiltersApplied } from "@/components/issues/issue-layouts/utils";
import { FilterIssueTypes } from "@/plane-web/components/issues/filters/issue-types";
type TSubIssueFiltersProps = {
  handleFiltersUpdate: (key: keyof IIssueFilterOptions, value: string | string[]) => void;
  filters: IIssueFilterOptions;
  memberIds: string[] | undefined;
  states?: IState[];
  availableFilters: (keyof IIssueFilterOptions)[];
};

export const SubIssueFilters = observer(function SubIssueFilters(props: TSubIssueFiltersProps) {
  const { handleFiltersUpdate, filters, memberIds, states, availableFilters } = props;
  // plane hooks
  const { t } = useTranslation();
  // states
  const [filtersSearchQuery, setFiltersSearchQuery] = useState("");

  const isFilterEnabled = (filter: keyof IIssueFilterOptions) => !!availableFilters.includes(filter);

  const isFilterApplied = useMemo(() => isFiltersApplied(filters), [filters]);

  return (
    <>
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
            <ListFilter className="h-3.5 w-3.5 text-primary" />
          </div>
        }
      >
        <div className="flex max-h-[350px] flex-col overflow-hidden">
          <div className="bg-surface-1 p-2.5 pb-0">
            <div className="flex items-center gap-1.5 rounded-sm border-[0.5px] border-subtle bg-surface-2 px-1.5 py-1 text-11">
              <SearchIcon className="text-placeholder" width={12} height={12} strokeWidth={2} />
              <input
                type="text"
                className="w-full bg-surface-2 outline-none placeholder:text-placeholder"
                placeholder={t("common.search.label")}
                value={filtersSearchQuery}
                onChange={(e) => setFiltersSearchQuery(e.target.value)}
              />
              {filtersSearchQuery !== "" && (
                <button type="button" className="grid place-items-center" onClick={() => setFiltersSearchQuery("")}>
                  <CloseIcon className="text-tertiary" height={12} width={12} strokeWidth={2} />
                </button>
              )}
            </div>
          </div>
          <div className="vertical-scrollbar scrollbar-sm h-full w-full divide-y divide-subtle-1 overflow-y-auto px-2.5 text-left">
            {/* Priority */}
            {isFilterEnabled("priority") && (
              <div className="py-2">
                <FilterPriority
                  appliedFilters={filters.priority ?? null}
                  handleUpdate={(val) => handleFiltersUpdate("priority", val)}
                  searchQuery={filtersSearchQuery}
                />
              </div>
            )}

            {/* state group */}
            {isFilterEnabled("state_group") && (
              <div className="py-2">
                <FilterStateGroup
                  appliedFilters={filters.state_group ?? null}
                  handleUpdate={(val) => handleFiltersUpdate("state_group", val)}
                  searchQuery={filtersSearchQuery}
                />
              </div>
            )}

            {/* State */}
            {isFilterEnabled("state") && (
              <div className="py-2">
                <FilterState
                  appliedFilters={filters.state ?? null}
                  handleUpdate={(val) => handleFiltersUpdate("state", val)}
                  searchQuery={filtersSearchQuery}
                  states={states}
                />
              </div>
            )}

            {/* Projects */}
            {isFilterEnabled("project") && (
              <div className="py-2">
                <FilterProjects
                  appliedFilters={filters.project ?? null}
                  handleUpdate={(val) => handleFiltersUpdate("project", val)}
                  searchQuery={filtersSearchQuery}
                />
              </div>
            )}

            {/* work item types */}
            {isFilterEnabled("issue_type") && (
              <div className="py-2">
                <FilterIssueTypes
                  appliedFilters={filters.issue_type ?? null}
                  handleUpdate={(val) => handleFiltersUpdate("issue_type", val)}
                  searchQuery={filtersSearchQuery}
                />
              </div>
            )}

            {/* Assignees */}
            {isFilterEnabled("assignees") && (
              <div className="py-2">
                <FilterAssignees
                  appliedFilters={filters.assignees ?? null}
                  handleUpdate={(val) => handleFiltersUpdate("assignees", val)}
                  memberIds={memberIds}
                  searchQuery={filtersSearchQuery}
                />
              </div>
            )}

            {/* Start Date */}
            {isFilterEnabled("start_date") && (
              <div className="py-2">
                <FilterStartDate
                  appliedFilters={filters.start_date ?? null}
                  handleUpdate={(val) => handleFiltersUpdate("start_date", val)}
                  searchQuery={filtersSearchQuery}
                />
              </div>
            )}

            {/* Target Date */}
            {isFilterEnabled("target_date") && (
              <div className="py-2">
                <FilterDueDate
                  appliedFilters={filters.target_date ?? null}
                  handleUpdate={(val) => handleFiltersUpdate("target_date", val)}
                  searchQuery={filtersSearchQuery}
                />
              </div>
            )}
          </div>
        </div>
      </FiltersDropdown>
    </>
  );
});
