/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Desktop layout switcher for the issue layout header.
 *
 * Rendered purpose: renders a row of icon buttons (one per `EIssueLayoutTypes` value present in
 * `layouts`) that the user clicks to switch the active issue presentation between list, kanban,
 * calendar, spreadsheet, and gantt layouts.
 *
 * Props (`Props`):
 *   - `layouts` (`EIssueLayoutTypes[]`, required): subset of layout keys to render. Different issue
 *     surfaces enable different subsets (e.g. workspace draft enables LIST + SPREADSHEET only;
 *     cycles/modules expose all five). Filtered against the canonical `ISSUE_LAYOUTS` catalog from
 *     `@plane/constants`.
 *   - `onChange` (`(layout: EIssueLayoutTypes) => void`, required): invoked when the user clicks a
 *     layout button whose key differs from `selectedLayout`. The parent route root persists the new
 *     layout via `issuesFilter.updateFilters(workspaceSlug, projectId, EIssueFilterType.DISPLAY_FILTERS,
 *     { layout })`.
 *   - `selectedLayout` (`EIssueLayoutTypes | undefined`, required): the currently-active layout key;
 *     used to visually mark the active button and to gate `handleOnChange`.
 *
 * MobX stores read:
 *   - `usePlatformOS()` -> `isMobile` flag, forwarded to `Tooltip` so tooltips can be enabled/disabled
 *     for mobile UAs. No issue / filter / user store is read here.
 *
 * Side effects: none directly. Click handlers only invoke `props.onChange`; persistence and any
 * follow-on re-fetching is the parent's responsibility. No router navigation.
 */
// plane imports
import { ISSUE_LAYOUTS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Tooltip } from "@plane/propel/tooltip";
import type { EIssueLayoutTypes } from "@plane/types";
import { cn } from "@plane/utils";
// components
import { IssueLayoutIcon } from "@/components/issues/issue-layouts/layout-icon";
// hooks
import { usePlatformOS } from "@/hooks/use-platform-os";

type Props = {
  layouts: EIssueLayoutTypes[];
  onChange: (layout: EIssueLayoutTypes) => void;
  selectedLayout: EIssueLayoutTypes | undefined;
};

export function LayoutSelection(props: Props) {
  const { layouts, onChange, selectedLayout } = props;
  const { isMobile } = usePlatformOS();
  const { t } = useTranslation();
  /**
   * Skips the `onChange` call when the user re-clicks the already-active layout button — prevents
   * redundant `EIssueFilterType.DISPLAY_FILTERS` writes that would re-trigger the parent's MobX
   * observers and any associated re-fetch.
   */
  const handleOnChange = (layoutKey: EIssueLayoutTypes) => {
    if (selectedLayout !== layoutKey) {
      onChange(layoutKey);
    }
  };

  return (
    <div className="flex items-center gap-1 rounded-md bg-layer-3 p-1">
      {ISSUE_LAYOUTS.filter((l) => layouts.includes(l.key)).map((layout) => (
        <Tooltip key={layout.key} tooltipContent={t(layout.i18n_title)} isMobile={isMobile}>
          <button
            type="button"
            className={cn(
              "group grid h-5.5 w-7 place-items-center overflow-hidden rounded-sm transition-all hover:bg-layer-transparent-hover",
              {
                "bg-layer-transparent-active hover:bg-layer-transparent-active": selectedLayout === layout.key,
              }
            )}
            onClick={() => handleOnChange(layout.key)}
          >
            <IssueLayoutIcon
              layout={layout.key}
              size={14}
              strokeWidth={2}
              className={`size-3.5 ${selectedLayout == layout.key ? "text-primary" : "text-secondary"}`}
            />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
