/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Core CE additional-extension array for prop-free contexts.
 *
 * Paired with `./extensions.ts` which provides the React-aware (prop-accepting)
 * variant; this prop-free variant is consumed where React props are unavailable —
 * e.g., server-side ProseMirror schema parsing in `apps/live`.
 */

import type { Extensions } from "@tiptap/core";

/**
 * Empty CE extension array exposed to consumers that cannot supply editor props.
 *
 * `apps/live` parses Y.js documents server-side to extract structured data
 * (e.g., page titles) and needs a TipTap `Extensions` collection matching the
 * client schema, but it has no React props; this constant is the contract for
 * that prop-free path.
 *
 * Imported transitively via `@plane/editor/lib` (which is `packages/editor/src/lib.ts`)
 * → `@/extensions/core-without-props` (which is `packages/editor/src/core/extensions/core-without-props.ts`)
 * → this file. Verified by grep of `apps/live/src/services/pdf-export/pdf-export.service.ts`
 * and `apps/live/src/lib/stateless.ts` (both import from `@plane/editor/lib`).
 */
export const CoreEditorAdditionalExtensionsWithoutProps: Extensions = [];
