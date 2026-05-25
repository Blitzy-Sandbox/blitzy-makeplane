/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue layout catalogs (list/kanban/calendar/spreadsheet/gantt) and the
 * `TIssueLayout` string union consumed by issue layout switchers and roots in
 * `apps/web/core/components/issues/issue-layouts/**` and `apps/space/**`.
 */

import { EIssueLayoutTypes } from "@plane/types";

/**
 * Lowercase literal-string union of layout names — used by site-facing surfaces that avoid the `EIssueLayoutTypes` enum runtime.
 * Consumers: `apps/space/**` (Plane Publish) and the `SITES_ISSUE_LAYOUTS` catalog below.
 */
export type TIssueLayout = "list" | "kanban" | "calendar" | "spreadsheet" | "gantt";

/**
 * Shape of the layout metadata map keyed by `EIssueLayoutTypes` with `key`, page-title `i18n_title`, and compact `i18n_label`.
 * Consumers: `ISSUE_LAYOUT_MAP` in this file.
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
 * Public Plane Publish site layout catalog exposing only `list` and `kanban` (calendar/spreadsheet/gantt are not implemented on the public site) with `lucide-react` icon name and i18n label per entry.
 * Consumers: public-site layout switcher components in `apps/space/**`.
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
 * Full `apps/web` layout metadata map covering all five layout types (LIST, KANBAN, CALENDAR, SPREADSHEET, GANTT), binding each `EIssueLayoutTypes` value to page-title and compact-label i18n keys.
 * Consumers: layout switcher and per-layout roots in `apps/web/core/components/issues/issue-layouts/**`, plus layout-aware filter menus in `apps/web/core/components/issues/filters/**`.
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
 * Iteration-friendly `Object.values(...)` projection of `ISSUE_LAYOUT_MAP` for `.map()`-based renderers, preserving insertion order (LIST → KANBAN → CALENDAR → SPREADSHEET → GANTT).
 * Consumers: switcher rendering in `apps/web/core/components/issues/issue-layouts/**`.
 */
export const ISSUE_LAYOUTS: {
  key: EIssueLayoutTypes;
  i18n_title: string;
  i18n_label: string;
}[] = Object.values(ISSUE_LAYOUT_MAP);
