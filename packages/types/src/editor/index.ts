/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel module for the `@plane/types/editor` subfolder — re-exports the editor
 * content type markers defined in `./editor-content` so consumers can import
 * via a stable, shallow path instead of referencing the implementation file
 * directly.
 *
 * Consumers:
 * - `@plane/editor` (core types and helpers — `packages/editor/src/core/types/editor.ts`,
 *   `packages/editor/src/core/helpers/yjs-utils.ts`, `packages/editor/src/core/helpers/parser.ts`)
 * - `apps/web/core/components/issues/issue-modal/components/description-editor.tsx` and
 *   `apps/web/core/components/editor/rich-text/description-input/` (issue description editors)
 *   plus `apps/web/core/components/pages/` (page editors)
 * - `apps/live/src/extensions/title-sync.ts` (real-time title sync)
 * - `packages/types/src/issues/activity/issue_comment.ts` (comment activity entries)
 *
 * Re-exports: `JSONContent`, `HTMLContent`, `Content` (type-only).
 */
export type { JSONContent, HTMLContent, Content } from "./editor-content";
