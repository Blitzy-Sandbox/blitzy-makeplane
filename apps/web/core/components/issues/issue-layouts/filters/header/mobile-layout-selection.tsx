/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Mobile-optimised layout switcher for the issue layout header.
 *
 * Rendered purpose: renders a compact `CustomMenu` dropdown whose trigger shows the icon of the
 * currently-active layout and a chevron; tapping the trigger opens a menu of the enabled layouts
 * and selecting one invokes `onChange`. Functionally equivalent to `LayoutSelection` but uses a
 * dropdown affordance that fits narrow viewports.
 *
 * Props (inline object type):
 *   - `layouts` (`EIssueLayoutTypes[]`, required): subset of layout keys to render. Filtered against
 *     the canonical `ISSUE_LAYOUTS` catalog from `@plane/constants`.
 *   - `onChange` (`(layout: EIssueLayoutTypes) => void`, required): invoked when the user selects a
 *     menu item. The parent route root persists the selection via
 *     `issuesFilter.updateFilters(workspaceSlug, projectId, EIssueFilterType.DISPLAY_FILTERS,
 *     { layout })`.
 *   - `activeLayout` (`EIssueLayoutTypes`, optional): the currently-active layout key; when present
 *     its icon is shown inside the menu's trigger button. Omitted on first render before the filter
 *     store has hydrated.
 *   - `isMobile` (`boolean`, optional): declared on the props type but not consumed inside this
 *     component — retained for caller-side parity with `LayoutSelection`'s sibling API.
 *
 * MobX stores read: none. `usePlatformOS()` is NOT used here — mobile-specific affordances are
 * handled inside the `CustomMenu` design-system primitive.
 *
 * Side effects: none directly. Menu-item click invokes `onChange`; persistence and any follow-on
 * re-fetching is the parent's responsibility. No router navigation.
 */
import { ISSUE_LAYOUTS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { ChevronDownIcon } from "@plane/propel/icons";
import type { EIssueLayoutTypes } from "@plane/types";
import { CustomMenu } from "@plane/ui";
import { IssueLayoutIcon } from "../../layout-icon";

export function MobileLayoutSelection({
  layouts,
  onChange,
  activeLayout,
}: {
  layouts: EIssueLayoutTypes[];
  onChange: (layout: EIssueLayoutTypes) => void;
  activeLayout?: EIssueLayoutTypes;
  isMobile?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <CustomMenu
      maxHeight={"md"}
      className="flex flex-grow justify-center text-13 text-secondary"
      placement="bottom-start"
      customButton={
        <Button variant="secondary" className="relative px-2">
          {activeLayout && (
            <IssueLayoutIcon layout={activeLayout} size={14} strokeWidth={2} className={`h-3.5 w-3.5`} />
          )}
          <ChevronDownIcon className="my-auto size-3 text-secondary" strokeWidth={2} />
        </Button>
      }
      customButtonClassName="flex flex-grow justify-center text-secondary text-13"
      closeOnSelect
    >
      {ISSUE_LAYOUTS.filter((l) => layouts.includes(l.key)).map((layout, index) => (
        <CustomMenu.MenuItem
          key={index}
          onClick={() => {
            onChange(layout.key);
          }}
          className="flex items-center gap-2"
        >
          <IssueLayoutIcon layout={layout.key} className="h-3 w-3" />
          <div className="text-tertiary">{t(layout.i18n_label)}</div>
        </CustomMenu.MenuItem>
      ))}
    </CustomMenu>
  );
}
