/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Sticky-note widget contracts for the `@plane/types` package.
 *
 * Models the workspace sticky-note entity — free-form pinned notes rendered on the
 * workspace home dashboard. Consumed by `apps/web/core/store/sticky/sticky.store.ts`
 * and `apps/web/core/components/stickies/`.
 */

import type { TLogoProps } from "./common";

/**
 * Workspace sticky-note record.
 *
 * Mirrors the `Sticky` Django model (`apps/api/plane/db/models/sticky.py`) exposed via
 * `apps/api/plane/app/views/workspace/sticky.py`. Consumed by
 * `apps/web/core/store/sticky/sticky.store.ts` (state shape) and
 * `apps/web/core/components/stickies/` (rendering + edit flows).
 *
 * Fields with non-obvious semantics:
 * - `background_color`: optional hex/css color; null when the system default should apply
 * - `description`: opaque JSON object — the ProseMirror/TipTap document tree for the note body
 * - `description_html`: rendered HTML mirror of `description` (read-only at display time)
 * - `logo_props`: shared emoji/icon descriptor — undefined when the note has no icon
 * - `sort_order`: float-typed ordering for drag-reorder on the home grid
 */
export type TSticky = {
  /** ISO-8601 timestamp the sticky was created on the server. */
  created_at?: string | undefined;
  /** UUID of the user that originally created the sticky. */
  created_by?: string | undefined;
  /**
   * Optional hex/CSS color used as the sticky's card background; `null` when the
   * system default color should apply (no user override has been set).
   */
  background_color?: string | null | undefined;
  /**
   * Opaque JSON object — the ProseMirror/TipTap document tree for the note body.
   * Edited via the sticky editor in `apps/web/core/components/editor/sticky-editor/`
   * and persisted alongside `description_html`.
   */
  description?: object | undefined;
  /**
   * Rendered HTML mirror of {@link TSticky.description} (read-only at display time).
   * Produced server-side and used for non-editing surfaces.
   */
  description_html?: string | undefined;
  /** Server-assigned UUID identifying the sticky. */
  id: string;
  /**
   * Shared emoji/icon descriptor (see `TLogoProps` in `./common`).
   * Undefined when the sticky has no icon configured.
   */
  logo_props: TLogoProps | undefined;
  /** User-supplied display name / title for the sticky. */
  name?: string;
  /**
   * Float-typed ordering value used for drag-reorder on the workspace home grid.
   * Lower values render before higher values; gaps are reserved for in-between inserts.
   */
  sort_order: number | undefined;
  /** ISO-8601 timestamp of the most recent persisted edit. */
  updated_at?: string | undefined;
  /** UUID of the user that most recently edited the sticky. */
  updated_by?: string | undefined;
  /** UUID of the parent workspace that owns the sticky. */
  workspace: string | undefined;
};
