/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue filter operators, page-level filter registries, layout-aware filter
 * options, and activity feed filter helpers consumed by issue filter UIs in
 * `apps/web/core/components/issues/**` and `apps/web/core/store/issue/**`.
 */

import type {
  IIssueFilterOptions,
  ILayoutDisplayFiltersOptions,
  TIssueActivityComment,
  TWorkItemFilterProperty,
} from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
import type { TIssueFilterPriorityObject } from "./common";
import { ISSUE_DISPLAY_PROPERTIES_KEYS, SUB_ISSUES_DISPLAY_PROPERTIES_KEYS } from "./common";

import type { TIssueLayout } from "./layout";

/**
 * Narrow sidebar quick-filter key union (priority/state/labels).
 * Consumers: sidebar quick-filter chips in `apps/web/core/components/issues/filters/**`.
 */
export type TIssueFilterKeys = "priority" | "state" | "labels";

/**
 * Inverse of `EIssueGroupByToServerOptions` in `./common.ts` — maps persisted server group-by tokens back to UI filter keys.
 * Consumers: group-by deserializers in `apps/web/core/store/issue/**`.
 */
export enum EServerGroupByToFilterOptions {
  "state_id" = "state",
  "priority" = "priority",
  "labels__id" = "labels",
  "state__group" = "state_group",
  "assignees__id" = "assignees",
  "cycle_id" = "cycle",
  "issue_module__module_id" = "module",
  "target_date" = "target_date",
  "project_id" = "project",
  "created_by" = "created_by",
}

/**
 * Persistence bucket discriminator (rich filters, display filters, display properties, kanban-only state) whose values mirror per-user filter API column names — DO NOT rename.
 * Consumers: filter persistence in `apps/web/core/store/issue/**` and filter UIs in `apps/web/core/components/issues/filters/**`.
 */
export enum EIssueFilterType {
  FILTERS = "rich_filters",
  DISPLAY_FILTERS = "display_filters",
  DISPLAY_PROPERTIES = "display_properties",
  KANBAN_FILTERS = "kanban_filters",
}

/**
 * Subset of `EIssueFilterType` accepting PATCH-style partial updates; excludes `FILTERS`, which are replaced atomically.
 * Consumers: filter update reducers in `apps/web/core/store/issue/**`.
 */
export type TSupportedFilterTypeForUpdate =
  | EIssueFilterType.DISPLAY_FILTERS
  | EIssueFilterType.DISPLAY_PROPERTIES
  | EIssueFilterType.KANBAN_FILTERS;

/**
 * Per-layout sidebar quick-filter allowlist; every layout currently exposes the same `[priority, state, labels]` triplet.
 * Consumers: filter sidebars in `apps/web/core/components/issues/issue-layouts/**`.
 */
export const ISSUE_DISPLAY_FILTERS_BY_LAYOUT: {
  [key in TIssueLayout]: Record<"filters", TIssueFilterKeys[]>;
} = {
  list: {
    filters: ["priority", "state", "labels"],
  },
  kanban: {
    filters: ["priority", "state", "labels"],
  },
  calendar: {
    filters: ["priority", "state", "labels"],
  },
  spreadsheet: {
    filters: ["priority", "state", "labels"],
  },
  gantt: {
    filters: ["priority", "state", "labels"],
  },
};

/**
 * Priority filter pill catalog pairing each cross-stack priority `key` (mirroring `Issue.priority` choices in `apps/api/plane/db/models/issue.py`) with its i18n label, Tailwind classes, and Material Symbols icon.
 * Consumers: priority pills and badges in `apps/web/core/components/issues/filters/**` and `apps/web/core/components/issues/**`.
 */
export const ISSUE_PRIORITY_FILTERS: TIssueFilterPriorityObject[] = [
  {
    key: "urgent",
    titleTranslationKey: "issue.priority.urgent",
    className: "bg-layer-2 text-priority-urgent border-strong",
    icon: "error",
  },
  {
    key: "high",
    titleTranslationKey: "issue.priority.high",
    className: "bg-layer-2 text-priority-high border-strong",
    icon: "signal_cellular_alt",
  },
  {
    key: "medium",
    titleTranslationKey: "issue.priority.medium",
    className: "bg-layer-2 text-priority-medium border-strong",
    icon: "signal_cellular_alt_2_bar",
  },
  {
    key: "low",
    titleTranslationKey: "issue.priority.low",
    className: "bg-layer-2 text-priority-low border-strong",
    icon: "signal_cellular_alt_1_bar",
  },
  {
    key: "none",
    titleTranslationKey: "common.none",
    className: "bg-layer-2 text-priority-none border-strong",
    icon: "block",
  },
];

/**
 * Per-layout filter/display options shape keyed by layout name to its `ILayoutDisplayFiltersOptions`.
 * Consumers: page-aware filter config in `apps/web/core/components/issues/filters/**`.
 */
export type TFiltersLayoutOptions = {
  [layoutType: string]: ILayoutDisplayFiltersOptions;
};

/**
 * Page-level filter configuration shape pairing allowed filter keys with per-layout options.
 * Consumers: page filter builders in `apps/web/core/components/issues/filters/**`.
 */
export type TFilterPropertiesByPageType = {
  filters: TWorkItemFilterProperty[];
  layoutOptions: TFiltersLayoutOptions;
};

/**
 * Top-level registry shape mapping each page type to its filter configuration.
 * Consumers: page-aware filter resolvers in `apps/web/core/components/issues/filters/**`.
 */
export type TIssueFiltersToDisplayByPageType = {
  [pageType: string]: TFilterPropertiesByPageType;
};

/**
 * Source-of-truth page-keyed filter registry (`profile_issues`, `archived_issues`, `my_issues`, `issues`, `sub_work_items`) declaring allowed filter keys plus per-layout display properties/filters/extra options.
 * Consumers: page-aware filter and column-visibility menus in `apps/web/core/components/issues/filters/**` and `apps/web/core/components/issues/issue-layouts/**`.
 */
export const ISSUE_DISPLAY_FILTERS_BY_PAGE: TIssueFiltersToDisplayByPageType = {
  profile_issues: {
    filters: ["priority", "state_group", "label_id", "start_date", "target_date"],
    layoutOptions: {
      list: {
        display_properties: ISSUE_DISPLAY_PROPERTIES_KEYS,
        display_filters: {
          group_by: ["state_detail.group", "priority", "project", "labels", null],
          order_by: ["sort_order", "-created_at", "-updated_at", "start_date", "-priority"],
          type: ["active", "backlog"],
        },
        extra_options: {
          access: true,
          values: ["show_empty_groups", "sub_issue"],
        },
      },
      kanban: {
        display_properties: ISSUE_DISPLAY_PROPERTIES_KEYS,
        display_filters: {
          group_by: ["state_detail.group", "priority", "project", "labels"],
          order_by: ["sort_order", "-created_at", "-updated_at", "start_date", "-priority"],
          type: ["active", "backlog"],
        },
        extra_options: {
          access: true,
          values: ["show_empty_groups"],
        },
      },
    },
  },
  archived_issues: {
    filters: [
      "priority",
      "state_group",
      "state_id",
      "cycle_id",
      "module_id",
      "assignee_id",
      "created_by_id",
      "label_id",
      "start_date",
      "target_date",
    ],
    layoutOptions: {
      list: {
        display_properties: ISSUE_DISPLAY_PROPERTIES_KEYS,
        display_filters: {
          group_by: ["state", "cycle", "module", "priority", "labels", "assignees", "created_by", null],
          order_by: ["sort_order", "-created_at", "-updated_at", "start_date", "-priority"],
          type: ["active", "backlog"],
        },
        extra_options: {
          access: true,
          values: ["show_empty_groups"],
        },
      },
    },
  },
  my_issues: {
    filters: [
      "priority",
      "state_group",
      "label_id",
      "assignee_id",
      "created_by_id",
      "subscriber_id",
      "project_id",
      "start_date",
      "target_date",
    ],
    layoutOptions: {
      spreadsheet: {
        display_properties: ISSUE_DISPLAY_PROPERTIES_KEYS,
        display_filters: {
          order_by: [],
          type: ["active", "backlog"],
        },
        extra_options: {
          access: true,
          values: ["sub_issue"],
        },
      },
      list: {
        display_properties: ISSUE_DISPLAY_PROPERTIES_KEYS,
        display_filters: {
          type: ["active", "backlog"],
        },
        extra_options: {
          access: false,
          values: [],
        },
      },
    },
  },
  issues: {
    filters: [
      "priority",
      "state_group",
      "state_id",
      "cycle_id",
      "module_id",
      "assignee_id",
      "mention_id",
      "created_by_id",
      "label_id",
      "start_date",
      "target_date",
    ],
    layoutOptions: {
      list: {
        display_properties: ISSUE_DISPLAY_PROPERTIES_KEYS,
        display_filters: {
          group_by: ["state", "priority", "cycle", "module", "labels", "assignees", "created_by", null],
          order_by: ["sort_order", "-created_at", "-updated_at", "start_date", "-priority", "target_date"],
          type: ["active", "backlog"],
        },
        extra_options: {
          access: true,
          values: ["show_empty_groups", "sub_issue"],
        },
      },
      kanban: {
        display_properties: ISSUE_DISPLAY_PROPERTIES_KEYS,
        display_filters: {
          group_by: ["state", "priority", "cycle", "module", "labels", "assignees", "created_by"],
          sub_group_by: ["state", "priority", "cycle", "module", "labels", "assignees", "created_by", null],
          order_by: ["sort_order", "-created_at", "-updated_at", "start_date", "-priority", "target_date"],
          type: ["active", "backlog"],
        },
        extra_options: {
          access: true,
          values: ["show_empty_groups", "sub_issue"],
        },
      },
      calendar: {
        display_properties: ["key", "issue_type"],
        display_filters: {
          type: ["active", "backlog"],
        },
        extra_options: {
          access: true,
          values: ["sub_issue"],
        },
      },
      spreadsheet: {
        display_properties: ISSUE_DISPLAY_PROPERTIES_KEYS,
        display_filters: {
          order_by: ["sort_order", "-created_at", "-updated_at", "start_date", "-priority"],
          type: ["active", "backlog"],
        },
        extra_options: {
          access: true,
          values: ["sub_issue"],
        },
      },
      gantt_chart: {
        display_properties: ["key", "issue_type"],
        display_filters: {
          order_by: ["sort_order", "-created_at", "-updated_at", "start_date", "-priority"],
          type: ["active", "backlog"],
        },
        extra_options: {
          access: true,
          values: ["sub_issue"],
        },
      },
    },
  },
  sub_work_items: {
    filters: ["priority", "state_id", "assignee_id", "start_date", "target_date"],
    layoutOptions: {
      list: {
        display_properties: SUB_ISSUES_DISPLAY_PROPERTIES_KEYS,
        display_filters: {
          order_by: ["-created_at", "-updated_at", "start_date", "-priority"],
          group_by: ["state", "priority", "assignees", null],
        },
        extra_options: {
          access: true,
          values: ["sub_issue"],
        },
      },
    },
  },
};

/**
 * Maps each `EIssuesStoreType` to its page-type filter registry (currently `PROJECT` → `issues`); extend as new stores adopt rich filters.
 * Consumers: filter resolution in `apps/web/core/store/issue/**`.
 */
export const ISSUE_STORE_TO_FILTERS_MAP: Partial<Record<EIssuesStoreType, TFilterPropertiesByPageType>> = {
  [EIssuesStoreType.PROJECT]: ISSUE_DISPLAY_FILTERS_BY_PAGE.issues,
};

/**
 * Tighter sub-work-item filter allowlist for work-item pages (priority/state/issue_type/assignees/dates only).
 * Consumers: sub-work-item filter strip in `apps/web/core/components/issues/issue-detail/**`.
 */
export const SUB_WORK_ITEM_AVAILABLE_FILTERS_FOR_WORK_ITEM_PAGE: (keyof IIssueFilterOptions)[] = [
  "priority",
  "state",
  "issue_type",
  "assignees",
  "start_date",
  "target_date",
];

/**
 * Activity feed filter buckets (ACTIVITY, COMMENT, STATE, ASSIGNEE, DEFAULT) — `DEFAULT` is implicit/always-preserved while the rest are user-toggleable in the activity panel.
 * Consumers: activity panel filter chips in `apps/web/core/components/issues/issue-detail/**`.
 */
export enum EActivityFilterType {
  ACTIVITY = "ACTIVITY",
  COMMENT = "COMMENT",
  STATE = "STATE",
  ASSIGNEE = "ASSIGNEE",
  DEFAULT = "DEFAULT",
}

/**
 * Alias for `EActivityFilterType` value type — convenience reuse in helpers and maps.
 */
export type TActivityFilters = EActivityFilterType;

/**
 * User-facing activity filter keys — excludes the implicit `DEFAULT` category,
 * which is never user-toggleable (always preserved by `filterActivityOnSelectedFilters`).
 */
export type TActivityFilterOptionsKey = Exclude<TActivityFilters, EActivityFilterType.DEFAULT>;

/**
 * i18n label registry per activity filter type driving the activity filter menu labels.
 * Consumers: activity filter menu in `apps/web/core/components/issues/issue-detail/**`.
 */
export const ACTIVITY_FILTER_TYPE_OPTIONS: Record<TActivityFilterOptionsKey, { labelTranslationKey: string }> = {
  [EActivityFilterType.ACTIVITY]: {
    labelTranslationKey: "common.updates",
  },
  [EActivityFilterType.COMMENT]: {
    labelTranslationKey: "common.comments",
  },
  [EActivityFilterType.STATE]: {
    labelTranslationKey: "common.state",
  },
  [EActivityFilterType.ASSIGNEE]: {
    labelTranslationKey: "common.assignee",
  },
};

/**
 * Activity filter chip shape pairing filter key with translation key, selection state, and click handler.
 * Consumers: activity filter chips in `apps/web/core/components/issues/issue-detail/**`.
 */
export type TActivityFilterOption = {
  key: TActivityFilters;
  labelTranslationKey: string;
  isSelected: boolean;
  onClick: () => void;
};

/**
 * Default activity filter selection on first render — every user-toggleable bucket pre-selected so the feed shows the full stream.
 * Consumers: activity panel initial filter state in `apps/web/core/components/issues/issue-detail/**`.
 */
export const defaultActivityFilters: TActivityFilters[] = [
  EActivityFilterType.ACTIVITY,
  EActivityFilterType.COMMENT,
  EActivityFilterType.STATE,
  EActivityFilterType.ASSIGNEE,
];

/**
 * Returns activity items matching the selected filter categories; `DEFAULT` entries are always retained so system-generated activity remains visible.
 * Consumers: activity panel rendering in `apps/web/core/components/issues/issue-detail/**`.
 */
export const filterActivityOnSelectedFilters = (
  activity: TIssueActivityComment[],
  filters: TActivityFilters[]
): TIssueActivityComment[] =>
  activity.filter((activity) => {
    if (activity.activity_type === EActivityFilterType.DEFAULT) return true;
    return filters.includes(activity.activity_type as TActivityFilters);
  });

/**
 * Feature flag gating the experimental issue-dependencies UI (blocked-by / blocking graphs); set `true` to surface dependency widgets.
 * Consumers: dependency components in `apps/web/core/components/issues/**`.
 */
export const ENABLE_ISSUE_DEPENDENCIES = false;

/**
 * Activity-type allowlist always rendered in the activity panel; `COMMENT` is excluded because comments are surfaced via a separate user toggle.
 * Consumers: activity panel renderer in `apps/web/core/components/issues/issue-detail/**`.
 */
export const BASE_ACTIVITY_FILTER_TYPES = [
  EActivityFilterType.ACTIVITY,
  EActivityFilterType.STATE,
  EActivityFilterType.ASSIGNEE,
  EActivityFilterType.DEFAULT,
];
