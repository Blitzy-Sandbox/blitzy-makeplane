/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
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
 * Issue filter sidebar key — narrow union of the three filters surfaced in the
 * sidebar quick-filter menu (priority/state/labels).
 *
 * Consumers: `apps/web/core/components/issues/filters/**` sidebar quick-filter chips.
 */
export type TIssueFilterKeys = "priority" | "state" | "labels";

/**
 * Inverse map: server-side group-by tokens → client-facing filter keys. The
 * inverse of `EIssueGroupByToServerOptions` in `./common.ts` — used when reading a
 * persisted group-by string from the API and translating it back to the UI key.
 *
 * Consumers: `apps/web/core/store/issue/**` group-by deserializers.
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
 * Persistence bucket discriminator for the four classes of filter state the
 * issue list persists separately. Each value names a column on the per-user
 * filters payload returned by the issue filters API.
 *
 * Values:
 * - FILTERS ("rich_filters"): the full rich-filter expression (operators + values)
 * - DISPLAY_FILTERS ("display_filters"): group-by / order-by / sub-group-by + type
 * - DISPLAY_PROPERTIES ("display_properties"): per-column visibility toggles
 * - KANBAN_FILTERS ("kanban_filters"): kanban-specific group collapse/expand state
 *
 * The string values mirror persistence column names on the API contract — DO NOT rename.
 *
 * Consumers: `apps/web/core/store/issue/**` filter persistence + `apps/web/core/components/issues/filters/**`.
 */
export enum EIssueFilterType {
  FILTERS = "rich_filters",
  DISPLAY_FILTERS = "display_filters",
  DISPLAY_PROPERTIES = "display_properties",
  KANBAN_FILTERS = "kanban_filters",
}

/**
 * Subset of `EIssueFilterType` supporting partial `PATCH`-style updates — excludes
 * `FILTERS` (rich filters), which are replaced atomically.
 *
 * Consumers: `apps/web/core/store/issue/**` filter update reducers.
 */
export type TSupportedFilterTypeForUpdate =
  | EIssueFilterType.DISPLAY_FILTERS
  | EIssueFilterType.DISPLAY_PROPERTIES
  | EIssueFilterType.KANBAN_FILTERS;

/**
 * Per-layout allowlist of filter keys exposed in the sidebar quick-filter menu.
 * Currently every layout exposes the same `[priority, state, labels]` triplet.
 *
 * Consumers: `apps/web/core/components/issues/issue-layouts/**` filter sidebars.
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
 * Priority filter pill catalog — pairs each backend priority value with its i18n
 * label, Tailwind classes, and Material Symbols icon name.
 *
 * Cross-stack contract: priority `key` strings (`urgent`/`high`/`medium`/`low`/`none`)
 * MIRROR the `Issue.priority` CharField choices in
 * `apps/api/plane/db/models/issue.py` — DO NOT change these values without a
 * corresponding backend migration.
 *
 * Consumers: priority filter pills in `apps/web/core/components/issues/filters/**`
 * and priority badges across `apps/web/core/components/issues/**`.
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
 * Per-layout filter/display options shape — keyed by layout name to its
 * `ILayoutDisplayFiltersOptions` (display properties + display filters + extra options).
 *
 * Consumers: `apps/web/core/components/issues/filters/**` page-aware filter config.
 */
export type TFiltersLayoutOptions = {
  [layoutType: string]: ILayoutDisplayFiltersOptions;
};

/**
 * Page-level filter configuration shape — the allowed filter keys for the page
 * plus per-layout options keyed by layout name.
 *
 * Consumers: `apps/web/core/components/issues/filters/**` page filter builders.
 */
export type TFilterPropertiesByPageType = {
  filters: TWorkItemFilterProperty[];
  layoutOptions: TFiltersLayoutOptions;
};

/**
 * Top-level registry shape — page type to its filter configuration.
 *
 * Consumers: `apps/web/core/components/issues/filters/**` page-aware filter resolvers.
 */
export type TIssueFiltersToDisplayByPageType = {
  [pageType: string]: TFilterPropertiesByPageType;
};

/**
 * Page-keyed filter registry: for each issue page type (`profile_issues`,
 * `archived_issues`, `my_issues`, `issues`, `sub_work_items`) declares the allowed
 * filter keys and the per-layout display properties / filters / extra options.
 *
 * This is the source of truth for which group-by / order-by options and which
 * display properties are available on each page × layout combination.
 *
 * Consumers: `apps/web/core/components/issues/filters/**` and
 * `apps/web/core/components/issues/issue-layouts/**` for page-aware filter
 * menus and column-visibility menus.
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
 * Maps an `EIssuesStoreType` to the page-type filter registry it should use.
 * Currently `PROJECT` → `issues`; extend here as new stores adopt rich filters.
 *
 * Consumers: `apps/web/core/store/issue/**` filter resolution.
 */
export const ISSUE_STORE_TO_FILTERS_MAP: Partial<Record<EIssuesStoreType, TFilterPropertiesByPageType>> = {
  [EIssuesStoreType.PROJECT]: ISSUE_DISPLAY_FILTERS_BY_PAGE.issues,
};

/**
 * Allowlist of filter keys available on the sub-work-item filter strip when
 * rendered inside a work-item page — a tighter subset than the full work-item
 * filter set (only priority/state/issue_type/assignees/date filters).
 *
 * Consumers: `apps/web/core/components/issues/issue-detail/**` sub-work-item filter strip.
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
 * Issue activity feed filter categories — partitions the activity stream into
 * filterable buckets the user can toggle in the activity panel.
 *
 * Values:
 * - ACTIVITY: generic property-change activity entries (anything not in another bucket)
 * - COMMENT: user-authored comments
 * - STATE: state/workflow change activities
 * - ASSIGNEE: assignee change activities
 * - DEFAULT: activity types always preserved regardless of filter selection (e.g., system entries)
 *
 * Consumers: `apps/web/core/components/issues/issue-detail/**` activity panel filter chips.
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
 * i18n label registry per activity filter type — drives the activity filter menu's
 * label text.
 *
 * Consumers: `apps/web/core/components/issues/issue-detail/**` activity filter menu.
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
 * Shape of a single activity filter chip — pairs the filter key with its
 * translation key, current selection state, and click handler.
 *
 * Consumers: `apps/web/core/components/issues/issue-detail/**` activity filter chips.
 */
export type TActivityFilterOption = {
  key: TActivityFilters;
  labelTranslationKey: string;
  isSelected: boolean;
  onClick: () => void;
};

/**
 * Default selected activity filters on first render — all user-toggleable
 * categories are pre-selected so the feed shows the full activity stream.
 *
 * Consumers: `apps/web/core/components/issues/issue-detail/**` activity panel
 * initial filter state.
 */
export const defaultActivityFilters: TActivityFilters[] = [
  EActivityFilterType.ACTIVITY,
  EActivityFilterType.COMMENT,
  EActivityFilterType.STATE,
  EActivityFilterType.ASSIGNEE,
];

/**
 * Returns the subset of activity items matching the selected filter categories.
 * Items whose `activity_type` is `EActivityFilterType.DEFAULT` are ALWAYS retained
 * (regardless of the filter set) so system-generated activity entries remain visible.
 *
 * @param activity - Full activity/comment timeline as returned by the API.
 * @param filters - Currently selected filter categories.
 * @returns Filtered timeline preserving `DEFAULT` entries.
 *
 * Consumers: `apps/web/core/components/issues/issue-detail/**` activity panel rendering.
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
 * Feature flag gating the experimental issue-dependencies UI (blocked-by / blocking
 * graphs). Set to `true` to surface dependency widgets in the issue detail view.
 *
 * Consumers: dependency-related components in `apps/web/core/components/issues/**`.
 */
export const ENABLE_ISSUE_DEPENDENCIES = false;

/**
 * Activity-type allowlist that is always rendered in the activity panel
 * (`COMMENT` is intentionally excluded — comments are surfaced via a separate
 * user toggle on the activity feed).
 *
 * Consumers: `apps/web/core/components/issues/issue-detail/**` activity panel renderer.
 */
export const BASE_ACTIVITY_FILTER_TYPES = [
  EActivityFilterType.ACTIVITY,
  EActivityFilterType.STATE,
  EActivityFilterType.ASSIGNEE,
  EActivityFilterType.DEFAULT,
];
