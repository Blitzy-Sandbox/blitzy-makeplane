/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel for the core CE extension surface.
 *
 * Re-exports `CoreEditorAdditionalExtensions` and `TCoreAdditionalExtensionsProps`
 * from `./extensions`.
 *
 * Note: `./without-props` is intentionally NOT re-exported via this barrel because
 * it serves a different consumer surface — `apps/live` parses Y.js documents
 * server-side via `@plane/editor/lib` and needs the prop-free variant, which is
 * reached through its own import path rather than through this React-aware barrel.
 */

export * from "./extensions";
