/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Popover-based activity-type filter selector for the issue activity header.
 *
 * Rendered purpose: a tertiary `IconButton` (with the `ListFilter` lucide icon) that opens a
 * `PopoverMenu` of localized filter options. Each option row shows a small checkbox-like indicator
 * (filled with `CheckIcon` when selected) and a localized label; clicking a row invokes the
 * option's `onClick` callback (defined by the parent, typically a partial-selection toggle). A
 * small accent dot is overlaid on the trigger button whenever the selection is non-exhaustive
 * (fewer than all filter options are active), serving as a visual "filter active" hint.
 *
 * Props (TActivityFilter):
 *   - selectedFilters (TActivityFilters[], optional, default=[]): currently active filter ids;
 *     drives the trailing accent dot and per-row indicator state
 *   - filterOptions (TActivityFilterOption[], required): the full set of selectable options;
 *     each carries its own `key`, localized `labelTranslationKey`, `isSelected` flag, and
 *     `onClick` toggle callback supplied by the parent
 *
 * MobX stores read: none directly — wrapped in `observer` so that any of the `filterOptions`
 * entries' captured MobX-derived flags (built by the parent from the issue-detail store + local
 * state) trigger a re-render when they change.
 *
 * Side effects: none in this component itself; each row's `onClick` is the parent's responsibility
 * (typically delegates to `useLocalStorage("issue_activity_filters", ...)` in `./root.tsx`).
 *
 * Accessibility / interaction notes:
 *   - The trigger uses `IconButton variant="tertiary"` from `@plane/propel/icon-button` (provides
 *     focus + Enter/Space activation semantics).
 *   - Each filter row is a `div` with `onClick` and `cursor: pointer` styling — accessibility for
 *     keyboard users relies on `PopoverMenu`'s arrow-key / Escape behavior; the wrapping menu
 *     supplies the necessary roles.
 *   - The accent dot is purely visual ("filter active" indicator); the same information is
 *     announced via the menu's own state when opened.
 *
 * Derived state notes:
 *   - When all options are selected (`selectedFilters.length === filterOptions.length`) the accent
 *     dot is hidden — the convention is "no dot = nothing filtered out".
 *   - The single-active-filter case applies a slightly different background class
 *     (`bg-layer-1 text-placeholder`) on the indicator so the user cannot visually mistake the
 *     last remaining filter for "no filters" (the parent enforces "at least one filter is applied"
 *     in `./root.tsx`'s `toggleFilter`).
 *
 * Composition note: `./root.tsx` does NOT mount this component directly. The activity header
 * uses `ActivityFilterRoot` from `@/plane-web/components/issues/worklog/activity/filter-root`,
 * which composes this presentational primitive with the worklog-specific option list. Future
 * maintainers searching for the consumer should look at that filter-root wrapper, not `./root.tsx`.
 */

import { observer } from "mobx-react";
import { ListFilter } from "lucide-react";
// plane imports
import type { TActivityFilters, TActivityFilterOption } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { IconButton } from "@plane/propel/icon-button";
import { CheckIcon } from "@plane/propel/icons";
import { PopoverMenu } from "@plane/ui";
// helper
import { cn } from "@plane/utils";
// constants

type TActivityFilter = {
  selectedFilters: TActivityFilters[];
  filterOptions: TActivityFilterOption[];
};

export const ActivityFilter = observer(function ActivityFilter(props: TActivityFilter) {
  const { selectedFilters = [], filterOptions } = props;

  // hooks
  const { t } = useTranslation();

  return (
    <PopoverMenu
      buttonClassName="outline-none"
      button={
        <>
          <IconButton variant="tertiary" icon={ListFilter} />
          {selectedFilters.length < filterOptions.length && (
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-accent-primary" />
          )}
        </>
      }
      panelClassName="p-2 rounded-md border border-subtle bg-surface-1"
      data={filterOptions}
      keyExtractor={(item) => item.key}
      render={(item) => (
        <div
          key={item.key}
          className="flex cursor-pointer items-center gap-2 rounded-xs p-1 px-2 text-13 transition-all hover:bg-layer-1"
          onClick={item.onClick}
        >
          <div
            className={cn(
              "flex h-3 w-3 flex-shrink-0 items-center justify-center rounded-xs bg-surface-2 transition-all",
              {
                "bg-accent-primary text-on-color": item.isSelected,
                "bg-layer-1 text-placeholder": item.isSelected && selectedFilters.length === 1,
                "bg-surface-2": !item.isSelected,
              }
            )}
          >
            {item.isSelected && <CheckIcon className="h-2.5 w-2.5" />}
          </div>
          <div className={cn("whitespace-nowrap", item.isSelected ? "text-primary" : "text-secondary")}>
            {t(item.labelTranslationKey)}
          </div>
        </div>
      )}
    />
  );
});
