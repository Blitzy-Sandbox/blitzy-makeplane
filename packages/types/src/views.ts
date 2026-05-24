/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Project-scoped saved view contracts for the `@plane/types` package.
 *
 * Models the `IProjectView` entity (saved filter sets for a single project), the access
 * level enum (`EViewAccess`), the published-link variant (`IPublishedProjectView`), and
 * the supporting filter/sort shapes consumed by the project Views list page. Compare with
 * `./workspace-views.ts` for the workspace-aggregated equivalent. Mirrors
 * `apps/api/plane/db/models/view.py`.
 *
 * Mutual contract with `./view-props.ts`: saved project views defined here are the
 * persistence wrapper around the filter / sort / display-property contracts declared in
 * `view-props.ts` — `IProjectView` imports and composes `IIssueDisplayFilterOptions`,
 * `IIssueDisplayProperties`, `IIssueFilterOptions`, and `TWorkItemFilterExpression`
 * from that module to form the saved-view API shape.
 *
 * Consumers: `apps/web/core/store/project-view.store.ts`, `apps/web/core/components/views/`,
 * and `apps/web/core/services/view.service.ts`.
 */

import type { TLogoProps } from "./common";
import type {
  IIssueDisplayFilterOptions,
  IIssueDisplayProperties,
  IIssueFilterOptions,
  TWorkItemFilterExpression,
} from "./view-props";

/**
 * Visibility level for a saved view.
 *
 * The numeric values are persisted to PostgreSQL via `apps/api/plane/db/models/view.py`,
 * so the ordering MUST NOT be reorganized or new variants inserted in the middle.
 */
export enum EViewAccess {
  /** Only the owner (and workspace admins) can see/use the view. Backing DB value: `0`. */
  PRIVATE,
  /** All project members can see/use the view. Backing DB value: `1`. */
  PUBLIC,
}

/**
 * Project-scoped saved view entity — a named, persisted filter set scoped to one project.
 *
 * Fields with non-obvious semantics:
 * - `access`: `EViewAccess` (PRIVATE / PUBLIC) — controls visibility to other project members.
 * - `rich_filters`: new-style filter expression tree (`TWorkItemFilterExpression`); preferred
 *   for net-new reads/writes. See `./view-props.ts` for the expression grammar.
 * - `display_filters`: display-layer settings (group_by, order_by, layout, calendar mode).
 * - `display_properties`: per-column visibility toggles for the list/spreadsheet layouts.
 * - `query` / `query_data`: legacy filter blobs (`IIssueFilterOptions`) preserved for
 *   backwards compatibility with stored views created before the rich-filters migration.
 * - `is_locked`: when true the view cannot be edited (server-enforced).
 * - `is_favorite`: per-user favorite flag (not a column on the view row — joined from
 *   the favorites table at read time).
 * - `anchor`: opaque URL slug present only when the view has been published; consumed by
 *   the public space app.
 * - `logo_props`: optional logo customization (emoji or uploaded asset).
 */
export interface IProjectView {
  id: string;
  access: EViewAccess;
  created_at: Date;
  updated_at: Date;
  is_favorite: boolean;
  created_by: string;
  updated_by: string;
  name: string;
  description: string;
  rich_filters: TWorkItemFilterExpression;
  display_filters: IIssueDisplayFilterOptions;
  display_properties: IIssueDisplayProperties;
  query: IIssueFilterOptions;
  query_data: IIssueFilterOptions;
  project: string;
  workspace: string;
  logo_props: TLogoProps | undefined;
  is_locked: boolean;
  anchor?: string;
  owned_by: string;
}

/**
 * Public-link variant of `IProjectView` returned by the published-spaces endpoint.
 *
 * `rich_filters` is intentionally dropped because the published-space renderer only
 * understands the legacy `IIssueFilterOptions` blob exposed via `filters`. Consumed by
 * `apps/space` when rendering a shared view at `/<anchor>`.
 */
export interface IPublishedProjectView extends Omit<IProjectView, "rich_filters"> {
  filters: IIssueFilterOptions;
}

/**
 * Toggle flags controlling which interactive features are enabled on a published view.
 *
 * Used as the request body when (un)publishing a view and as the source of truth for
 * the public-space renderer feature gates.
 */
export type TPublishViewSettings = {
  is_comments_enabled: boolean;
  is_reactions_enabled: boolean;
  is_votes_enabled: boolean;
};

/**
 * Server response shape after a view is published — combines feature toggles with the
 * generated public identifiers.
 *
 * `anchor` is the opaque URL slug appended to the public-space base URL; `id` is the
 * deploy-board row id for subsequent (un)publish requests.
 */
export type TPublishViewDetails = TPublishViewSettings & {
  id: string;
  anchor: string;
};

/**
 * Column the project Views list page is sorted by.
 *
 * Note: this sorts the LIST OF VIEWS shown to the user, not the issues inside any single
 * view (which is governed by `display_filters.order_by`).
 */
export type TViewFiltersSortKey = "name" | "created_at" | "updated_at";

/** Sort direction applied to the project Views list page. */
export type TViewFiltersSortBy = "asc" | "desc";

/**
 * Filter facets applied to the project Views list page (NOT to issues inside a view).
 *
 * - `created_at`: array of semicolon-delimited date-filter expressions evaluated by
 *   `satisfiesDateFilter` in `@plane/utils`. Each element parses as `value;operator;from`
 *   and falls into one of three forms:
 *     - Custom presets: `"today;custom;custom"`, `"yesterday;custom;custom"`,
 *       `"last_7_days;custom;custom"`, `"last_30_days;custom;custom"`
 *     - Absolute ISO dates: `"YYYY-MM-DD;after"` or `"YYYY-MM-DD;before"`
 *       (e.g. `"2024-12-01;after"`)
 *     - Relative durations from today: `"1_weeks;after;fromnow"`, `"2_weeks;before;fromnow"`,
 *       `"1_months;after;fromnow"`, `"2_months;after;fromnow"`
 *   Multiple elements are AND-combined; `null` / undefined means "no facet applied".
 * - `owned_by`: user ids whose views to include (matched against `view.created_by`);
 *   `null` / undefined means "no facet applied".
 * - `favorites`: when true, restrict to the current user's favorited views.
 * - `view_type`: visibility levels to include, matched against `view.access`
 *   (`EViewAccess.PRIVATE` / `PUBLIC`).
 */
export type TViewFilterProps = {
  created_at?: string[] | null;
  owned_by?: string[] | null;
  favorites?: boolean;
  view_type?: EViewAccess[];
};

/**
 * Top-level filter state for the project Views list page.
 *
 * Combines the search box (`searchQuery`), sort key/direction, and the optional facet
 * filters (`TViewFilterProps`). Held in MobX state by the project-view store; consumed
 * by the views list components.
 */
export type TViewFilters = {
  searchQuery: string;
  sortKey: TViewFiltersSortKey;
  sortBy: TViewFiltersSortBy;
  filters?: TViewFilterProps;
};
