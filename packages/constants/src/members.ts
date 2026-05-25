/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// Member property constants - Single source of truth for member spreadsheet properties

/**
 * Sort-order key for the project members spreadsheet. The leading `-` denotes
 * descending order, mirroring DRF's `ordering=` query-parameter convention even
 * though the sort is applied client-side by `parseOrderKey` in the member store.
 *
 * Consumers: `apps/web/core/store/member/utils.ts` (`IMemberFilters.order_by`,
 * `parseOrderKey`) and `apps/web/core/components/project/member-header-column.tsx`
 * (column-header sort affordances).
 */
export type TMemberOrderByOptions =
  | "display_name"
  | "-display_name"
  | "full_name"
  | "-full_name"
  | "email"
  | "-email"
  | "joining_date"
  | "-joining_date"
  | "role"
  | "-role";

/**
 * Display-properties toggle map for the project members spreadsheet — drives
 * which member columns are shown in the table. Each boolean key maps 1:1 to a
 * column rendered by the member-header / member-row components.
 *
 * Consumers: `apps/web/core/components/project/member-header-column.tsx` keys
 * each column header off this interface; matches the row-rendering shape used
 * by the project members table.
 */
export interface IProjectMemberDisplayProperties {
  full_name: boolean;
  display_name: boolean;
  email: boolean;
  joining_date: boolean;
  role: boolean;
}

/**
 * Per-property metadata for member spreadsheet columns — pairs each
 * `IProjectMemberDisplayProperties` key with its i18n title, ascending and
 * descending sort keys/titles, lucide-react icon name, and whether sorting is
 * enabled. Single source of truth so column headers and sort affordances stay
 * in lockstep.
 *
 * Consumers: `apps/web/core/components/project/member-header-column.tsx` reads
 * the entry for the current column to render its icon, localized header label,
 * and ascending/descending sort buttons.
 */
export const MEMBER_PROPERTY_DETAILS: {
  [key in keyof IProjectMemberDisplayProperties]: {
    i18n_title: string;
    ascendingOrderKey: TMemberOrderByOptions;
    ascendingOrderTitle: string;
    descendingOrderKey: TMemberOrderByOptions;
    descendingOrderTitle: string;
    iconName: string;
    isSortingAllowed: boolean;
  };
} = {
  full_name: {
    i18n_title: "project_members.full_name",
    ascendingOrderKey: "full_name",
    ascendingOrderTitle: "A",
    descendingOrderKey: "-full_name",
    descendingOrderTitle: "Z",
    iconName: "User",
    isSortingAllowed: true,
  },
  display_name: {
    i18n_title: "project_members.display_name",
    ascendingOrderKey: "display_name",
    ascendingOrderTitle: "A",
    descendingOrderKey: "-display_name",
    descendingOrderTitle: "Z",
    iconName: "User",
    isSortingAllowed: true,
  },
  email: {
    i18n_title: "project_members.email",
    ascendingOrderKey: "email",
    ascendingOrderTitle: "A",
    descendingOrderKey: "-email",
    descendingOrderTitle: "Z",
    iconName: "Mail",
    isSortingAllowed: true,
  },
  joining_date: {
    i18n_title: "project_members.joining_date",
    ascendingOrderKey: "joining_date",
    ascendingOrderTitle: "Old",
    descendingOrderKey: "-joining_date",
    descendingOrderTitle: "New",
    iconName: "Calendar",
    isSortingAllowed: true,
  },
  role: {
    i18n_title: "project_members.role",
    ascendingOrderKey: "role",
    ascendingOrderTitle: "Guest",
    descendingOrderKey: "-role",
    descendingOrderTitle: "Admin",
    iconName: "Shield",
    isSortingAllowed: true,
  },
};
