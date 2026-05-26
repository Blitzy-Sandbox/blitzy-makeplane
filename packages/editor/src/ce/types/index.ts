/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel for the CE editor type surface.
 *
 * Re-exports the public type modules consumed broadly across the editor package:
 * - `./issue-embed` — issue embed configuration and callback contracts
 *   (`TEmbedConfig`, `TReadOnlyEmbedConfig`, `TIssueEmbedConfig`).
 * - `./editor-extended` — extension-oriented editor type placeholders
 *   (`IEditorExtensionOptions`, `IEditorPropsExtended`,
 *   `ICollaborativeDocumentEditorPropsExtended`, `TExtendedEditorCommands`,
 *   `TExtendedCommandExtraProps`, `TExtendedEditorRefApi`).
 * - `./config` — file-handler alias (`TExtendedFileHandler`).
 *
 * Intentionally NOT re-exported here (each has a narrow, specific call site):
 * - `./asset` — consumed directly by `core/types/asset.ts` via
 *   `@/plane-editor/types/asset`.
 * - `./storage` — consumed directly by `ce/constants/utility.ts` via
 *   `@/plane-editor/types/storage`.
 * - `./utils` — consumed directly by `core/extensions/utility.ts` via
 *   `@/plane-editor/types/utils`.
 *
 * This selective barrel keeps generic CE consumers decoupled from the
 * narrow type aliases that only specific call sites need.
 */

export * from "./issue-embed";
export * from "./editor-extended";
export * from "./config";
