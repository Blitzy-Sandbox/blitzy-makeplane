/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `@plane/constants` — Shared, statically-typed constants for the Plane monorepo.
 *
 * This barrel re-exports 40 domain-organized constant modules consumed across
 * `apps/web`, `apps/admin`, `apps/space`, `apps/live`, and sibling packages.
 *
 * Public surface (alphabetical):
 *   ai, analytics, auth, chart, cycle, dashboard, emoji, endpoints, estimates,
 *   event-tracker, file, filter, graph, icon, instance, intake, issue, label,
 *   members, metadata, module, notification, page, payment, profile, project,
 *   rich-filters, settings, sidebar, spreadsheet, state, stickies, subscription,
 *   swr, tab-indices, themes, user, views, workspace, workspace-drafts.
 *
 * Consumers import from `@plane/constants` directly; sub-module deep imports are
 * not part of the supported API surface.
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
