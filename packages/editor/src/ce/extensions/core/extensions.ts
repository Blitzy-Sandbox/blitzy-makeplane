/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Core CE additional-extension builder.
 *
 * Defines the typed factory used to contribute extensions on top of `CORE_EXTENSIONS`
 * in the React-aware (prop-accepting) editor build.
 *
 * Consumed by `core/extensions/extensions.ts` (the central extension builder),
 * which spreads the result of `CoreEditorAdditionalExtensions({...})` into the
 * rich-text/document editor's extension array.
 */

import type { Extensions } from "@tiptap/core";
// types
import type { IEditorProps } from "@/types";

/**
 * Subset of `IEditorProps` needed by the core CE extension builder.
 *
 * Picks `disabledExtensions`, `flaggedExtensions`, `fileHandler`, and
 * `extendedEditorProps` from `IEditorProps`; see `IEditorProps` for full
 * field semantics.
 */
export type TCoreAdditionalExtensionsProps = Pick<
  IEditorProps,
  "disabledExtensions" | "flaggedExtensions" | "fileHandler" | "extendedEditorProps"
>;

/**
 * Builds the core CE extension array (currently empty placeholder).
 *
 * Returns an empty `Extensions` array in CE. The factory shape is preserved so
 * EE builds or future CE additions can contribute extensions WITHOUT changing
 * the call site in `core/extensions/extensions.ts` (the central extension
 * builder).
 *
 * The `const {} = props;` pattern intentionally signals "props accepted but
 * currently unused" and makes the future-extension contract self-evident.
 *
 * @param props - Editor props subset (`TCoreAdditionalExtensionsProps`) accepted
 *   by contract; not consumed in the current empty-placeholder CE implementation
 *   but available for future extension contributions.
 * @returns `Extensions` array (currently always empty in CE).
 */
export const CoreEditorAdditionalExtensions = (props: TCoreAdditionalExtensionsProps): Extensions => {
  const {} = props;
  return [];
};
