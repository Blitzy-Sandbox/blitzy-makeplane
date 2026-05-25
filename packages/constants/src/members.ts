/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Member spreadsheet column metadata and sidebar tracker element identifiers
 * consumed by `apps/web/core/components/{workspace,project}/settings/**` and
 * the project/workspace member MobX stores.
 */

// Member property constants - Single source of truth for member spreadsheet properties

/**
 * Project members spreadsheet sort key (DRF `-` prefix denotes descending) — sort is applied client-side by `parseOrderKey`.
 * Consumers: `apps/web/core/store/member/utils.ts` and column-header affordances in `apps/web/core/components/project/member-header-column.tsx`.
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
 * Toggle map driving column visibility in the project members table — each boolean key maps 1:1 to a header/row column.
 * Consumers: `apps/web/core/components/project/member-header-column.tsx` and the project members row renderer.
 */
export interface IProjectMemberDisplayProperties {
  full_name: boolean;
  display_name: boolean;
  email: boolean;
  joining_date: boolean;
  role: boolean;
}

/**
 * Per-column metadata (i18n title, asc/desc sort keys + titles, lucide-react icon, sort-enabled flag) keeping member spreadsheet headers and sort affordances in lockstep.
 * Consumers: `apps/web/core/components/project/member-header-column.tsx`.
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
