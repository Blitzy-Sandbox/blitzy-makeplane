/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Core page entity contracts for the `@plane/types/page` subfolder.
 *
 * Defines `TPage` — the collaborative page entity persisted by
 * `apps/api/plane/db/models/page.py::Page` and edited live via the HocusPocus server
 * in `apps/live` (see tech spec §5.2.5 for the real-time persistence sequence).
 * Pages can be project-scoped or workspace-scoped, public or private, archived or
 * active. Also defines filter/sort vocabularies, version-history snapshots,
 * document-payload shapes (binary + html + json parallel formats), and the
 * live-server WebSocket connect parameter shape.
 *
 * Consumers: `apps/web/core/store/pages/` (project page stores),
 * `apps/web/core/components/pages/` (page UI components), `apps/live/src/` (real-time
 * persistence layer), and `apps/api/plane/app/serializers/page.py` (mirrored backend
 * serializer).
 */

import type { TLogoProps } from "../common";
import type { EPageAccess } from "../enums";
import type { TPageExtended } from "./extended";

/**
 * Collaborative page entity — workspace or project-scoped rich-text document.
 *
 * Edited live via Y.js CRDT through `apps/live`'s HocusPocus server (tech spec §5.2.5).
 * Persistence is debounced; binary CRDT state is the source of truth, with HTML and
 * plain-text mirrors maintained server-side for rendering, search, and notifications.
 *
 * Intersected with `TPageExtended` so feature builds can layer additional fields
 * (e.g. hierarchy parent ids in feature-flagged variants) without modifying this
 * shared shape.
 *
 * Consumers: `apps/web/core/store/pages/`, `apps/web/core/components/pages/`,
 * `apps/live/src/services/page/`.
 */
export type TPage = {
  /**
   * Page visibility — `EPageAccess.PUBLIC` (0) is visible to all workspace/project
   * members; `EPageAccess.PRIVATE` (1) is visible only to the owner. Undefined for
   * partial/in-progress records before persistence.
   */
  access: EPageAccess | undefined;
  /**
   * ISO timestamp marking when the page was archived; `null` for active pages.
   * Archived pages remain readable but cannot be edited or appear in default listings.
   */
  archived_at: string | null | undefined;
  color: string | undefined;
  created_at: Date | undefined;
  created_by: string | undefined;
  /**
   * ProseMirror JSON document tree — the structural representation used by the editor
   * for restoring view state. Maintained in parallel with `description_html` (rendered
   * HTML); the canonical binary CRDT representation lives on the live-server's Y.Doc
   * and is materialized on persistence via `apps/live/src/extensions/database.ts`.
   */
  description_json: object | undefined;
  /**
   * Rendered HTML representation of the page body — used for read-only display, email
   * digests, and public space rendering. Updated server-side from the binary CRDT on
   * each persistence cycle.
   */
  description_html: string | undefined;
  id: string | undefined;
  is_favorite: boolean;
  /**
   * When true, only the owner (`owned_by`) can edit the page. Locking is a soft gate
   * applied at the API layer; the underlying Y.Doc is unaffected.
   */
  is_locked: boolean;
  label_ids: string[] | undefined;
  name: string | undefined;
  /**
   * User id of the page owner. The owner has unconditional edit rights and is the
   * principal subject of `is_locked` enforcement.
   */
  owned_by: string | undefined;
  /**
   * Project ids the page belongs to — optional and may be undefined for workspace-scoped
   * pages that are not bound to a project.
   */
  project_ids?: string[] | undefined;
  updated_at: Date | undefined;
  updated_by: string | undefined;
  workspace: string | undefined;
  /**
   * Shared logo descriptor (emoji or icon) rendered next to the page title in lists
   * and breadcrumbs. See `TLogoProps` in `../common`.
   */
  logo_props: TLogoProps | undefined;
  /**
   * ISO timestamp marking soft deletion; `undefined` for live pages. Soft-deleted
   * pages are excluded from default listings but remain in storage for the retention
   * window defined by `apps/api/plane/bgtasks/cleanup_task.py`.
   */
  deleted_at: Date | undefined;
} & TPageExtended;

// page filters
/**
 * Top-level navigation tab for the pages listing UI.
 *
 * Union values:
 * - `public`: pages visible to all project/workspace members (`EPageAccess.PUBLIC`)
 * - `private`: pages visible only to the current viewer as owner (`EPageAccess.PRIVATE`)
 * - `archived`: pages with non-null `archived_at`
 *
 * Consumed by `apps/web/core/components/pages/header/` to render the tab strip.
 */
export type TPageNavigationTabs = "public" | "private" | "archived";

/**
 * Sort field for the pages list.
 *
 * Union values:
 * - `name`: alphabetical by title
 * - `created_at`: by creation timestamp
 * - `updated_at`: by last-modified timestamp (default in most UIs)
 * - `opened_at`: by last-opened timestamp (per-user recent-activity field)
 */
export type TPageFiltersSortKey = "name" | "created_at" | "updated_at" | "opened_at";

/**
 * Sort direction for the pages list — ascending or descending.
 */
export type TPageFiltersSortBy = "asc" | "desc";

/**
 * Filter predicates applied on the pages list.
 *
 * Each key narrows the result set independently; combinations are AND'd across keys
 * and OR'd within an individual key's array. All keys are optional/nullable — null or
 * undefined means "no filter applied for this dimension".
 */
export type TPageFilterProps = {
  /** ISO-date range strings or relative offsets used to filter by creation date. */
  created_at?: string[] | null;
  /** User ids — narrows to pages created by any of the listed users. */
  created_by?: string[] | null;
  /** When true, includes only pages the current viewer has marked as favorites. */
  favorites?: boolean;
  /** Label ids — narrows to pages tagged with any of the listed labels. */
  labels?: string[] | null;
};

/**
 * Complete filter + sort + search state for the pages list view.
 *
 * Persisted per-user-per-project so that filter selections survive across sessions.
 * Consumed by `apps/web/core/store/pages/` and the filter-bar component family in
 * `apps/web/core/components/pages/list/filters/`.
 */
export type TPageFilters = {
  /** Free-text search applied to page titles (case-insensitive substring match). */
  searchQuery: string;
  /** Active sort field (see `TPageFiltersSortKey`). */
  sortKey: TPageFiltersSortKey;
  /** Active sort direction (`asc` or `desc`). */
  sortBy: TPageFiltersSortBy;
  /** Active filter predicates (see `TPageFilterProps`); undefined means no filters applied. */
  filters?: TPageFilterProps;
};

/**
 * Embed kind that can be inserted inline inside a page document.
 *
 * Union values:
 * - `mention`: @-mention of a workspace user (rendered as a chip with avatar/name)
 * - `issue`: embedded issue reference (rendered as a chip with sequence id and title)
 *
 * Consumed by `packages/editor`'s embed picker and the corresponding ProseMirror nodes.
 */
export type TPageEmbedType = "mention" | "issue";

/**
 * Historical snapshot of a page's content at a specific save point.
 *
 * Produced by the live-server's persistence cycle (see tech spec §5.2.5 and
 * `apps/api/plane/bgtasks/page_version_task.py`) when the document debounce window
 * expires. Used by the version-history sidebar in `apps/web/core/components/pages/version/`
 * to allow users to inspect and restore prior versions.
 *
 * Field-level notes:
 * - `description_binary` / `description_html` / `description_json`: parallel content
 *   formats — `binary` is the Y.js CRDT byte string (source of truth for collaborative
 *   restore), `html` is the rendered output (display), `json` is the ProseMirror tree
 *   (editor state restore). All three are optional/nullable because legacy/partial
 *   entries may carry only a subset.
 * - `last_saved_at`: timestamp of the underlying edit that triggered this snapshot
 *   (may differ from `updated_at` which is the server-side row update time).
 * - `deleted_at`: soft-delete marker for the version record itself; null for live versions.
 */
export type TPageVersion = {
  created_at: string;
  created_by: string;
  deleted_at: string | null;
  description_binary?: string | null;
  description_html?: string | null;
  description_json?: object;
  id: string;
  last_saved_at: string;
  owned_by: string;
  page: string;
  updated_at: string;
  updated_by: string;
  workspace: string;
};

/**
 * Document body payload exchanged between `apps/live` and `apps/api` on persistence.
 *
 * Carries the three parallel content representations produced from the Y.Doc state:
 * - `description_binary`: base64-encoded Y.js update (CRDT source of truth)
 * - `description_html`: rendered HTML for read-only display and email digests
 * - `description_json`: ProseMirror JSON tree for editor restore
 *
 * Posted by `apps/live/src/extensions/database.ts` to `apps/api`'s page description
 * endpoint after the 10-second debounce window closes (see tech spec §5.2.5.4).
 */
export type TDocumentPayload = {
  description_binary: string;
  description_html: string;
  description_json: object;
};

/**
 * Query parameters carried on the live-server WebSocket upgrade request.
 *
 * Used by `apps/live`'s authentication hook to namespace the Y.Doc by entity
 * scope (project page vs. team page vs. workspace page) and to bind the connection
 * to the correct workspace context. The `documentType` discriminant determines which
 * scope-id (`projectId` or `teamId`) is required.
 *
 * Despite the type name "Webhook", this is the live-server connection query — the
 * naming predates the live-server rename and is preserved to avoid breaking imports.
 */
export type TWebhookConnectionQueryParams = {
  /**
   * Document namespace discriminant — determines whether `projectId` or `teamId`
   * is the required scope identifier alongside `workspaceSlug`.
   */
  documentType: "project_page" | "team_page" | "workspace_page";
  /** Required when `documentType === "project_page"`. */
  projectId?: string;
  /** Required when `documentType === "team_page"`. */
  teamId?: string;
  /** Workspace URL slug — always required. */
  workspaceSlug: string;
};
