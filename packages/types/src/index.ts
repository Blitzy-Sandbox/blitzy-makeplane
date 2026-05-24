/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `@plane/types` — shared compile-time type surface for the Plane monorepo.
 *
 * **Package role:** canonical source of truth for cross-boundary type contracts shared
 * across every app and package — `apps/api` (mirrored as Django serializers/models),
 * `apps/web`, `apps/admin`, `apps/space`, `apps/live`, and the sibling packages
 * `@plane/ui`, `@plane/editor`, `@plane/constants`, `@plane/decorators`.
 *
 * **Runtime footprint:** ZERO. The package is type-only — every re-export below is
 * erased at build time. JSDoc on these types is purely a documentation / IDE-hint
 * mechanism; `tsc` parses the comments but emits nothing.
 *
 * **Domain organization** (each category aggregates one or more re-exports below):
 * - Issues: core work-item model, attachments, links, relations, sub-issues, reactions,
 *   activity, comments, labels (`./issues/`, `./issues.ts`)
 * - Projects, cycles, modules, pages: domain entities and their filter shapes
 *   (`./project/`, `./cycle/`, `./module/`, `./page/`)
 * - Workspace surface: workspace entity, members, invites, notifications, views, drafts
 *   (`./workspace.ts`, `./workspace-views.ts`, `./workspace-notifications.ts`,
 *   `./workspace-draft-issues/`)
 * - Auth and users: sign-in flow + user profile + current-user preferences
 *   (`./auth.ts`, `./users.ts`, `./current-user/`)
 * - Layout and rendering: issue layouts, base layouts, gantt, calendar, charts, dashboard,
 *   home, view-props (`./layout/`, `./base-layouts/`, `./charts/`, `./calendar.ts`,
 *   `./dashboard.ts`, `./home.ts`, `./view-props.ts`, `./views.ts`)
 * - Rich filters: composable filter expression tree (adapter/builder/expression/config/
 *   field-types/operators/derived layers) — `./rich-filters/`
 * - Editor: rich-text document schema markers (`./editor/`)
 * - Settings + instance: settings tab descriptors + instance/provider configuration
 *   (`./settings.ts`, `./instance/`)
 * - Intake + inbox: intake form and inbox triage (`./inbox.ts`, `./intake/`)
 * - File + asset: presigned uploads, asset duplication, description versions
 *   (`./file.ts`, `./description_version.ts`)
 * - Integrations: third-party integration descriptors (`./integration.ts`, `./importer/`)
 * - Analytics + AI: chart configs, AI GPT response, dedupe (`./analytics.ts`, `./ai.ts`,
 *   `./de-dupe.ts`, `./epics.ts`)
 * - Webhooks + API tokens: webhook config, API token records (`./webhook.ts`,
 *   `./api_token.ts`)
 * - Estimates + state: estimate systems, workflow states (`./estimate.ts`, `./state.ts`)
 * - Reactions + favorites: emoji reactions, favorite/bookmarked entities (`./reaction.ts`,
 *   `./favorite/`)
 * - Common: shared primitives, type utilities, enums, pagination, command palette,
 *   pragmatic DnD, stickies, search, publish, timezone, waitlist, payment
 *   (`./common.ts`, `./utils.ts`, `./enums.ts`, `./pagination.ts`,
 *   `./command-palette.ts`, `./pragmatic.ts`, `./stickies.ts`, `./search.ts`,
 *   `./publish.ts`, `./timezone.ts`, `./waitlist.ts`, `./payment.ts`)
 *
 * **Per-entity documentation:** see each target file's module-level JSDoc plus the
 * per-type JSDoc above each `export interface` / `export type` / `export enum`
 * declaration. Each documented type lists its consumers, non-obvious field semantics,
 * discriminated union variants, and any backend mirror in `apps/api`.
 */

export * from "./activity";
export * from "./ai";
export * from "./analytics";
export * from "./api_token";
export * from "./auth";
export * from "./calendar";
export * from "./charts";
export * from "./command-palette";
export * from "./common";
export * from "./cycle";
export * from "./dashboard";
export * from "./de-dupe";
export * from "./description_version";
export * from "./editor";
export * from "./enums";
export * from "./epics";
export * from "./estimate";
export * from "./favorite";
export * from "./file";
export * from "./home";
export * from "./importer";
export * from "./inbox";
export * from "./instance";
export * from "./integration";
export * from "./issues";
export * from "./issues/base"; // TODO: Remove this after development and the refactor/mobx-store-issue branch is stable
export * from "./issues/issue-identifier";
export * from "./layout";
export * from "./module";
export * from "./page";
export * from "./payment";
export * from "./pragmatic";
export * from "./project";
export * from "./publish";
export * from "./reaction";
export * from "./intake";
export * from "./rich-filters";
export * from "./search";
export * from "./settings";
export * from "./state";
export * from "./stickies";
export * from "./timezone";
export * from "./users";
export * from "./utils";
export * from "./view-props";
export * from "./views";
export * from "./waitlist";
export * from "./webhook";
export * from "./workspace";
export * from "./workspace-draft-issues/base";
export * from "./workspace-notifications";
export * from "./workspace-views";
export * from "./base-layouts";
export * from "./pagination";
