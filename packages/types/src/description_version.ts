/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Rich-text description version-history contracts for the `@plane/types` package.
 *
 * Models snapshot records produced when collaborative edits in `apps/live` finalize
 * via the persistence debounce. Server-side maintenance lives in
 * `apps/api/plane/bgtasks/issue_description_version_task.py` and `page_version_task.py`.
 */

/**
 * Lightweight version-history entry returned in version listings.
 *
 * Omits the actual content payload (binary/html/json/stripped) — fetch the full entry via
 * `TDescriptionVersionDetails` when restoring a specific version.
 *
 * Fields:
 * - `last_saved_at`: timestamp at which the underlying edit was persisted (debounced)
 * - `created_by` / `updated_by`: may be null for system-generated snapshots
 */
export type TDescriptionVersion = {
  created_at: string;
  created_by: string | null;
  id: string;
  last_saved_at: string;
  owned_by: string;
  project: string;
  updated_at: string;
  updated_by: string | null;
};

/**
 * Full version-history entry including all content representations.
 *
 * The four `description_*` fields parallel the live-edit persistence model:
 * - `description_binary`: Y.Doc encoded as a base64 binary string (CRDT source of truth)
 * - `description_html`: rendered HTML (for read-only display / email digests)
 * - `description_json`: ProseMirror JSON tree (for editor restore)
 * - `description_stripped`: plain-text extraction (for search/notifications)
 *
 * All four may be null on partial/legacy entries — consumers should fall back accordingly.
 */
export type TDescriptionVersionDetails = TDescriptionVersion & {
  /** Y.Doc encoded as a base64 binary string — the CRDT source of truth used by `apps/live`. */
  description_binary: string | null;
  /** Rendered HTML representation, suitable for read-only display and email digests. */
  description_html: string | null;
  /** ProseMirror JSON tree, used by the editor to restore a version into the live document. */
  description_json: object | null;
  /** Plain-text extraction, used for search indexing and notification previews. */
  description_stripped: string | null;
};

/**
 * Paginated listing of `TDescriptionVersion` entries.
 *
 * Mirrors the cursor-based pagination conventions used by other `apps/api` list endpoints.
 */
export type TDescriptionVersionsListResponse = {
  cursor: string;
  next_cursor: string | null;
  next_page_results: boolean;
  page_count: number;
  prev_cursor: string | null;
  prev_page_results: boolean;
  results: TDescriptionVersion[];
  total_pages: number;
  total_results: number;
};
