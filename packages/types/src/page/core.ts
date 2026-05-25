/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Core page entity contracts mirroring `apps/api/plane/db/models/page.py::Page` and
 * edited live via the HocusPocus server in `apps/live` (tech spec §5.2.5); consumed
 * by `apps/web/core/store/pages/`, `apps/web/core/components/pages/`, and
 * `apps/live/src/services/page/`.
 */

import type { TLogoProps } from "../common";
import type { EPageAccess } from "../enums";
import type { TPageExtended } from "./extended";

/**
 * Collaborative page entity edited live via Y.js CRDT through HocusPocus; the
 * binary CRDT state is the source of truth, with HTML/JSON mirrors maintained
 * server-side. Intersected with `TPageExtended` so feature builds can layer
 * additional fields without modifying this shared shape.
 */
export type TPage = {
  /** `EPageAccess.PUBLIC` (0) = all members, `PRIVATE` (1) = owner only. */
  access: EPageAccess | undefined;
  /** ISO archive timestamp; archived pages remain readable but are read-only. */
  archived_at: string | null | undefined;
  color: string | undefined;
  created_at: Date | undefined;
  created_by: string | undefined;
  /** ProseMirror JSON tree maintained in parallel with `description_html`; the canonical binary CRDT lives on the live-server's Y.Doc. */
  description_json: object | undefined;
  /** Rendered HTML used for read-only display, email digests, and public space; updated server-side from the binary CRDT on each persistence cycle. */
  description_html: string | undefined;
  id: string | undefined;
  is_favorite: boolean;
  /** Soft API-layer gate restricting edits to the owner; the underlying Y.Doc is unaffected. */
  is_locked: boolean;
  label_ids: string[] | undefined;
  name: string | undefined;
  /** Owner user id with unconditional edit rights and the subject of `is_locked` enforcement. */
  owned_by: string | undefined;
  /** Project ids; undefined for workspace-scoped pages not bound to a project. */
  project_ids?: string[] | undefined;
  updated_at: Date | undefined;
  updated_by: string | undefined;
  workspace: string | undefined;
  /** Logo descriptor rendered next to the title in lists and breadcrumbs. */
  logo_props: TLogoProps | undefined;
  /** Soft-delete marker; pages remain in storage for the retention window set in `apps/api/plane/bgtasks/cleanup_task.py`. */
  deleted_at: Date | undefined;
} & TPageExtended;

// page filters
/**
 * Top-level pages-listing navigation tab consumed by
 * `apps/web/core/components/pages/header/`: `"public"`/`"private"`/`"archived"`.
 */
export type TPageNavigationTabs = "public" | "private" | "archived";

/**
 * Sort field for the pages list: `name`, `created_at`, `updated_at` (default),
 * or `opened_at` (per-viewer recent-activity).
 */
export type TPageFiltersSortKey = "name" | "created_at" | "updated_at" | "opened_at";

/**
 * Sort direction for the pages list — ascending or descending.
 */
export type TPageFiltersSortBy = "asc" | "desc";

/**
 * Filter predicates on the pages list; combinations are AND'd across keys and
 * OR'd within an individual key's array, with `null`/`undefined` meaning "no
 * filter for this dimension".
 */
export type TPageFilterProps = {
  /** ISO-date range strings or relative offsets for creation date. */
  created_at?: string[] | null;
  /** User ids narrowing to pages created by any of the listed users. */
  created_by?: string[] | null;
  /** Restricts to pages the current viewer has favorited. */
  favorites?: boolean;
  /** Label ids narrowing to pages tagged with any of the listed labels. */
  labels?: string[] | null;
};

/**
 * Full filter+sort+search state for the pages list, persisted per-user-per-project
 * so selections survive across sessions.
 */
export type TPageFilters = {
  searchQuery: string;
  sortKey: TPageFiltersSortKey;
  sortBy: TPageFiltersSortBy;
  filters?: TPageFilterProps;
};

/**
 * Inline embed kind inserted inside a page document — `"mention"` (workspace
 * user @-mention) or `"issue"` (issue reference chip).
 */
export type TPageEmbedType = "mention" | "issue";

/**
 * Historical page snapshot produced by the live-server persistence cycle and
 * `apps/api/plane/bgtasks/page_version_task.py`; the `description_binary`/
 * `description_html`/`description_json` triple are parallel formats with
 * `binary` as the CRDT source of truth.
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
 * Document body payload posted by `apps/live/src/extensions/database.ts` to
 * `apps/api` after the 10-second debounce window closes (tech spec §5.2.5.4);
 * `description_binary` is a base64-encoded Y.js update.
 */
export type TDocumentPayload = {
  description_binary: string;
  description_html: string;
  description_json: object;
};

/**
 * Live-server WebSocket upgrade query params used by the auth hook to namespace
 * the Y.Doc by scope; the `documentType` discriminant determines whether
 * `projectId` or `teamId` is required. NOTE: the legacy "Webhook" name is
 * preserved to avoid breaking imports — this is the live-server connection query.
 */
export type TWebhookConnectionQueryParams = {
  /** Discriminant selecting the required scope id alongside `workspaceSlug`. */
  documentType: "project_page" | "team_page" | "workspace_page";
  /** Required when `documentType === "project_page"`. */
  projectId?: string;
  /** Required when `documentType === "team_page"`. */
  teamId?: string;
  /** Workspace URL slug — always required. */
  workspaceSlug: string;
};
