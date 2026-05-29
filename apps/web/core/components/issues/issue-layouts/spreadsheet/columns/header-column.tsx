/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Sortable column header control for the spreadsheet issue layout.
 *
 * Rendered purpose: renders the inner contents of a property header cell — the property icon,
 * localised property name, sort-direction indicator, and a chevron that opens a `CustomMenu` with
 * ascending / descending / clear-sort menu items. Persists the user's per-property sort choice in
 * localStorage so the UI restores the user's last sort selection across page reloads. Returns
 * `null` early when no `propertyDetails` entry exists for the property (defensive guard against
 * adding a property to `IIssueDisplayProperties` without registering it in
 * `SPREADSHEET_PROPERTY_DETAILS`).
 *
 * Props (Props):
 *   - property (keyof IIssueDisplayProperties, required): the property key whose header this
 *     renders; used as both the `SPREADSHEET_PROPERTY_DETAILS` lookup key and the localStorage
 *     value suffix
 *   - displayFilters (IIssueDisplayFilterOptions, required): the active sort state; specifically
 *     `displayFilters.order_by` is matched against `propertyDetails.ascendingOrderKey` /
 *     `descendingOrderKey` to render the correct direction indicator
 *   - handleDisplayFilterUpdate ((data) => void, required): callback to persist the new
 *     `order_by` choice (writes through to the issues-filter store and to the backend
 *     display-filter endpoint)
 *   - onClose (() => void, required): focus-restoration callback invoked when the menu closes;
 *     the parent `<SpreadsheetHeaderColumn>` uses this to restore focus to the `<th>` element
 *   - isEpic (boolean, optional, default=false): when true AND `property === "sub_issue_count"`,
 *     the header label reads "Work items" (sub-issues of an epic) instead of the default
 *     `propertyDetails.i18n_title`
 *
 * MobX stores read: none directly. Reads localStorage state via the `useLocalStorage` hook.
 *
 * Side effects:
 *   - `handleOrderBy(order, itemKey)` triple-effect: (1) invokes `handleDisplayFilterUpdate({ order_by })`
 *     to persist the sort choice, (2) writes `${order}_${itemKey}` into the
 *     `spreadsheetViewSorting` localStorage key (used to mark the active menu item), and
 *     (3) writes `itemKey` into `spreadsheetViewActiveSortingProperty` localStorage key OR
 *     clears it to empty string when the user picks the clear-sort `-created_at` option.
 *   - The localStorage writes persist the user's sort selection across page reloads so the
 *     sort indicator chevron renders correctly on the right property column even after a
 *     full-page refresh.
 *
 * Derived state / conditional rendering (the WHY for non-obvious patterns):
 *   - `SPREADSHEET_PROPERTY_DETAILS[property]` is a registry that maps each property key to its
 *     icon, i18n title, and the matching DRF backend `order_by` query parameter values
 *     (`ascendingOrderKey` / `descendingOrderKey`). The `-` prefix on a key (e.g. `-created_at`)
 *     encodes descending order in the DRF backend; this is why ascending / descending sort
 *     parameters are stored as separate sibling keys rather than computed via sign-flip.
 *   - The clear-sort menu item is conditionally rendered only when (a) there IS a previously
 *     selected sort, (b) the current sort is NOT already the default `-created_at`, AND
 *     (c) the selected sort matches THIS column. This prevents the "Clear sorting" item from
 *     appearing on columns the user hasn't actively sorted.
 *   - `clearSortOrder` semantics: clicking "Clear sorting" rebinds the sort back to the default
 *     `-created_at` (newest first) which is the implicit "no user sort" state of the spreadsheet.
 *   - When `property === "sub_issue_count" && isEpic`, the header label changes from the
 *     property's default i18n title to the epic-specific "Work items" label.
 *
 * Consumers:
 *   - `../spreadsheet-header-column.tsx` — the per-property `<th>` wrapper that handles focus
 *     restoration after this menu closes.
 */

//ui
import { ArrowDownWideNarrow, ArrowUpNarrowWide, CheckIcon, ChevronDownIcon, Eraser, MoveRight } from "lucide-react";
// constants
import { SPREADSHEET_PROPERTY_DETAILS } from "@plane/constants";
// i18n
import { useTranslation } from "@plane/i18n";
// types
import type { IIssueDisplayFilterOptions, IIssueDisplayProperties, TIssueOrderByOptions } from "@plane/types";
import { CustomMenu, Row } from "@plane/ui";
import useLocalStorage from "@/hooks/use-local-storage";
import { SpreadSheetPropertyIcon } from "../../utils";

/** Props for `HeaderColumn`. */
interface Props {
  property: keyof IIssueDisplayProperties;
  displayFilters: IIssueDisplayFilterOptions;
  handleDisplayFilterUpdate: (data: Partial<IIssueDisplayFilterOptions>) => void;
  onClose: () => void;
  isEpic?: boolean;
}

/** Sortable column header control; see the module-level JSDoc for full semantics. */
export function HeaderColumn(props: Props) {
  const { displayFilters, handleDisplayFilterUpdate, property, onClose, isEpic = false } = props;
  // i18n
  const { t } = useTranslation();
  const { storedValue: selectedMenuItem, setValue: setSelectedMenuItem } = useLocalStorage(
    "spreadsheetViewSorting",
    ""
  );
  const { storedValue: activeSortingProperty, setValue: setActiveSortingProperty } = useLocalStorage(
    "spreadsheetViewActiveSortingProperty",
    ""
  );
  const propertyDetails = SPREADSHEET_PROPERTY_DETAILS[property];

  const handleOrderBy = (order: TIssueOrderByOptions, itemKey: string) => {
    handleDisplayFilterUpdate({ order_by: order });

    setSelectedMenuItem(`${order}_${itemKey}`);
    setActiveSortingProperty(order === "-created_at" ? "" : itemKey);
  };

  if (!propertyDetails) return null;

  return (
    <CustomMenu
      customButtonClassName="clickable !w-full"
      customButtonTabIndex={-1}
      className="!w-full"
      customButton={
        <Row className="flex w-full cursor-pointer items-center justify-between gap-1.5 py-2 text-13 text-secondary hover:text-primary">
          <div className="flex items-center gap-1.5">
            {<SpreadSheetPropertyIcon iconKey={propertyDetails.icon} className="h-4 w-4 text-placeholder" />}
            {property === "sub_issue_count" && isEpic ? t("issue.label", { count: 2 }) : t(propertyDetails.i18n_title)}
          </div>
          <div className="ml-3 flex">
            {activeSortingProperty === property && (
              <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full">
                {propertyDetails.ascendingOrderKey === displayFilters.order_by ? (
                  <ArrowDownWideNarrow className="h-3 w-3" />
                ) : (
                  <ArrowUpNarrowWide className="h-3 w-3" />
                )}
              </div>
            )}
            <ChevronDownIcon className="h-3 w-3" aria-hidden="true" />
          </div>
        </Row>
      }
      onMenuClose={onClose}
      placement="bottom-start"
      closeOnSelect
    >
      <CustomMenu.MenuItem onClick={() => handleOrderBy(propertyDetails.ascendingOrderKey, property)}>
        <div
          className={`flex items-center justify-between gap-1.5 px-1 ${
            selectedMenuItem === `${propertyDetails.ascendingOrderKey}_${property}`
              ? "text-primary"
              : "text-secondary hover:text-primary"
          }`}
        >
          <div className="flex items-center gap-2">
            <ArrowDownWideNarrow className="h-3 w-3 stroke-[1.5]" />
            <span>{propertyDetails.ascendingOrderTitle}</span>
            <MoveRight className="h-3 w-3" />
            <span>{propertyDetails.descendingOrderTitle}</span>
          </div>

          {selectedMenuItem === `${propertyDetails.ascendingOrderKey}_${property}` && <CheckIcon className="h-3 w-3" />}
        </div>
      </CustomMenu.MenuItem>
      <CustomMenu.MenuItem onClick={() => handleOrderBy(propertyDetails.descendingOrderKey, property)}>
        <div
          className={`flex items-center justify-between gap-1.5 px-1 ${
            selectedMenuItem === `${propertyDetails.descendingOrderKey}_${property}`
              ? "text-primary"
              : "text-secondary hover:text-primary"
          }`}
        >
          <div className="flex items-center gap-2">
            <ArrowUpNarrowWide className="h-3 w-3 stroke-[1.5]" />
            <span>{propertyDetails.descendingOrderTitle}</span>
            <MoveRight className="h-3 w-3" />
            <span>{propertyDetails.ascendingOrderTitle}</span>
          </div>

          {selectedMenuItem === `${propertyDetails.descendingOrderKey}_${property}` && (
            <CheckIcon className="h-3 w-3" />
          )}
        </div>
      </CustomMenu.MenuItem>
      {selectedMenuItem &&
        selectedMenuItem !== "" &&
        displayFilters?.order_by !== "-created_at" &&
        selectedMenuItem.includes(property) && (
          <CustomMenu.MenuItem
            className={`mt-0.5 ${selectedMenuItem === `-created_at_${property}` ? "bg-layer-1" : ""}`}
            key={property}
            onClick={() => handleOrderBy("-created_at", property)}
          >
            <div className="flex items-center gap-2 px-1">
              <Eraser className="h-3 w-3" />
              <span>{t("common.actions.clear_sorting")}</span>
            </div>
          </CustomMenu.MenuItem>
        )}
    </CustomMenu>
  );
}
