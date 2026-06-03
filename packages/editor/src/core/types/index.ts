/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel module aggregating the `@plane/editor` core type surface.
 *
 * Re-exports the editor's local type modules — `ai`, `asset`,
 * `collaboration`, `config`, `editor`, `embed`, `extensions`, `hook`,
 * `mention`, `slash-commands-suggestion`, and `document-collaborative-events`
 * — together with the `@/plane-editor/types` overlay (community-edition
 * type extensions resolved through the `@/plane-editor/*` → `./src/ce/*`
 * tsconfig path alias).
 *
 * Consumers depend on the stable `@/types` import coordinate, and the
 * package's public entry point re-exports this barrel via
 * `export * from "@/types"` in `packages/editor/src/index.ts`. Routing
 * imports through this single coordinate insulates callers from internal
 * reorganization of the sibling type files — the underlying file layout
 * can change without breaking imports as long as the same symbols remain
 * re-exported here.
 *
 * Every symbol re-exported by this barrel is part of the `@plane/editor`
 * public API surface per AAP Directive 3; per-symbol documentation lives
 * in the sibling modules.
 */
export * from "./ai";
export * from "./asset";
export * from "./collaboration";
export * from "./config";
export * from "./editor";
export * from "./embed";
export * from "./extensions";
export * from "./hook";
export * from "./mention";
export * from "./slash-commands-suggestion";
export * from "./document-collaborative-events";

export * from "@/plane-editor/types";
