/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `@plane/constants` barrel — re-exports 40 domain-organized constant modules
 * imported from `@plane/constants` directly (deep sub-module imports are not part
 * of the supported surface).
 *
 * Taxonomy (one-line purpose per category):
 * - ai: in-editor AI assistant task identifiers.
 * - analytics: analytics chart category/property catalogs and labels.
 * - auth: login mediums, password policy, auth-page/step enums, error contracts.
 * - chart: shared recharts axis/legend Tailwind primitives and color schemes.
 * - cycle: cycle lifecycle state catalog and filter option vocabulary.
 * - dashboard: home dashboard widget filter tokens (duration/status).
 * - emoji: emoji picker frequency thresholds.
 * - endpoints: env-derived base URL and marketing URL constants (`VITE_*` baked at build time).
 * - estimates: estimate-system catalog and input limits.
 * - event-tracker: `data-ph-element` identifiers and event-name string registry.
 * - file: file-asset MIME type allow-lists and size limits.
 * - filter: generic filter operator catalog and label vocabulary.
 * - graph: graph/timeline rendering primitives.
 * - icon: lucide icon name catalogs used by feature pickers.
 * - instance: self-hosted instance setup constants.
 * - intake: intake/inbox issue status and source vocabulary.
 * - issue: work-item vocabulary, filters, layouts, and modal defaults.
 * - label: label color palette and default label state.
 * - members: member spreadsheet column metadata and sort keys.
 * - metadata: site/space static metadata (titles, descriptions, OG tags).
 * - module: module status colors, layout/order/filter options, sort key.
 * - notification: notification panel tabs and unread-count seed.
 * - page: page list filter tokens and access vocabulary.
 * - payment: subscription tier catalog and upgrade/marketing URL maps.
 * - profile: profile page tab visibility, week-start, and time-format options.
 * - project: project network/visibility, filter/order/access, feature flags.
 * - rich-filters: rich filter operator labels and option configuration.
 * - settings: profile/project/workspace settings tab groups and role access maps.
 * - sidebar: workspace sidebar element identifiers.
 * - spreadsheet: spreadsheet view header/column primitives.
 * - state: workflow state group catalog and DnD payload type.
 * - stickies: sticky note color palette.
 * - subscription: subscription tier enum/label vocabulary.
 * - swr: SWR cache key prefixes and revalidation policies.
 * - tab-indices: shared tabIndex constants for keyboard nav ordering.
 * - themes: theme switcher option catalog.
 * - user: user profile field limits and onboarding step catalog.
 * - views: project view access-level option catalog.
 * - workspace: workspace org-size buckets, role labels, static view catalogs.
 * - workspace-drafts: workspace draft surface limits and default form state.
 */

export * from "./ai";
export * from "./analytics";
export * from "./auth";
export * from "./chart";
export * from "./cycle";
export * from "./dashboard";
export * from "./emoji";
export * from "./endpoints";
export * from "./estimates";
export * from "./event-tracker";
export * from "./file";
export * from "./filter";
export * from "./graph";
export * from "./icon";
export * from "./instance";
export * from "./intake";
export * from "./issue";
export * from "./members";
export * from "./label";
export * from "./metadata";
export * from "./module";
export * from "./notification";
export * from "./page";
export * from "./payment";
export * from "./profile";
export * from "./project";
export * from "./rich-filters";
export * from "./settings";
export * from "./sidebar";
export * from "./spreadsheet";
export * from "./state";
export * from "./stickies";
export * from "./subscription";
export * from "./swr";
export * from "./tab-indices";
export * from "./themes";
export * from "./user";
export * from "./views";
export * from "./workspace-drafts";
export * from "./workspace";
