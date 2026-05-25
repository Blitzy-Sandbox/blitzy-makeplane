/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { EIssueLayoutTypes } from "@plane/types";

/**
 * String-union of supported issue layout names (lowercase). Distinct from the
 * `EIssueLayoutTypes` enum imported from `@plane/types` — `TIssueLayout` is the
 * literal-string form used by site-facing surfaces (`apps/space`) that don't
 * import the enum runtime.
 *
 * Consumers: `apps/space/**` (Plane Publish public site) and the
 * `SITES_ISSUE_LAYOUTS` catalog below.
 */
export type TIssueLayout = "list" | "kanban" | "calendar" | "spreadsheet" | "gantt";

/**
 * Contract for the full issue layout metadata map — keyed by `EIssueLayoutTypes`
 * enum value, each entry exposes its `key`, an `i18n_title` (page title) and
 * `i18n_label` (compact layout-switcher label).
 *
 * Consumers: `ISSUE_LAYOUT_MAP` (this file).
 */
export type TIssueLayoutMap = Record<
  EIssueLayoutTypes,
  {
    key: EIssueLayoutTypes;
    i18n_title: string;
    i18n_label: string;
  }
>;

/**
 * Layout catalog for the public Plane Publish site (`apps/space`) — exposes only
 * `list` and `kanban` because the public site does not implement
 * calendar/spreadsheet/gantt layouts. Each entry pairs the layout name with a
 * `lucide-react` icon name and an i18n key for the switcher label.
 *
 * Consumers: `apps/space/**` public-site issue layout switcher components.
 */
export const SITES_ISSUE_LAYOUTS: {
  key: TIssueLayout;
  titleTranslationKey: string;
  icon: string;
}[] = [
  {
    key: "list",
    icon: "List",
    titleTranslationKey: "issue.layouts.list",
  },
  {
    key: "kanban",
    icon: "Kanban",
    titleTranslationKey: "issue.layouts.kanban",
  },
];

/**
 * Full issue layout metadata map for the main app (`apps/web`) — covers all
 * five layout types. Each entry binds an `EIssueLayoutTypes` enum value to its
 * page-title and compact-label i18n keys.
 *
 * Layout purposes and components:
 * - LIST: vertical list view → `apps/web/core/components/issues/issue-layouts/list/**`
 * - KANBAN: grouped column board → `apps/web/core/components/issues/issue-layouts/kanban/**`
 * - CALENDAR: month-grid by due date → `apps/web/core/components/issues/issue-layouts/calendar/**`
 * - SPREADSHEET: virtualized data table with sortable columns → `apps/web/core/components/issues/issue-layouts/spreadsheet/**`
 * - GANTT: timeline/dependency view → `apps/web/core/components/issues/issue-layouts/gantt/**`
 *
 * Consumers: `apps/web/core/components/issues/issue-layouts/**` layout switcher
 * and per-layout root components; `apps/web/core/components/issues/filters/**`
 * for layout-aware filter/display-property menus.
 */
export const ISSUE_LAYOUT_MAP: TIssueLayoutMap = {
  [EIssueLayoutTypes.LIST]: {
    key: EIssueLayoutTypes.LIST,
    i18n_title: "issue.layouts.title.list",
    i18n_label: "issue.layouts.list",
  },
  [EIssueLayoutTypes.KANBAN]: {
    key: EIssueLayoutTypes.KANBAN,
    i18n_title: "issue.layouts.title.kanban",
    i18n_label: "issue.layouts.kanban",
  },
  [EIssueLayoutTypes.CALENDAR]: {
    key: EIssueLayoutTypes.CALENDAR,
    i18n_title: "issue.layouts.title.calendar",
    i18n_label: "issue.layouts.calendar",
  },
  [EIssueLayoutTypes.SPREADSHEET]: {
    key: EIssueLayoutTypes.SPREADSHEET,
    i18n_title: "issue.layouts.title.spreadsheet",
    i18n_label: "issue.layouts.spreadsheet",
  },
  [EIssueLayoutTypes.GANTT]: {
    key: EIssueLayoutTypes.GANTT,
    i18n_title: "issue.layouts.title.gantt",
    i18n_label: "issue.layouts.gantt",
  },
};

/**
 * Array projection of `ISSUE_LAYOUT_MAP` via `Object.values(...)` — provides an
 * iteration-friendly form for `.map()`-based renderers like the layout switcher
 * toolbar. Order matches the insertion order of `ISSUE_LAYOUT_MAP`
 * (LIST → KANBAN → CALENDAR → SPREADSHEET → GANTT).
 *
 * Consumers: `apps/web/core/components/issues/issue-layouts/**` switcher
 * rendering and tests that iterate all layouts.
 */
export const ISSUE_LAYOUTS: {
  key: EIssueLayoutTypes;
  i18n_title: string;
  i18n_label: string;
}[] = Object.values(ISSUE_LAYOUT_MAP);
