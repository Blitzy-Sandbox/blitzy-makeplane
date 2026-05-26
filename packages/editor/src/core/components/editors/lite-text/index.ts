/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public API barrel for the lite-text editor variant inside `@plane/editor`.
 *
 * Forwards every export of the sibling `./editor` implementation module —
 * principally `LiteTextEditorWithRef` — so callers can import from the
 * folder path rather than depending on the implementation file directly.
 *
 * This file is the stable module boundary for the lite-text editor; internal
 * restructuring of `./editor` will not break downstream imports as long as
 * the re-exported symbols remain stable. The package-level
 * `packages/editor/src/index.ts` re-exports through the parent
 * `packages/editor/src/core/components/editors/index.ts` barrel and ultimately
 * surfaces `LiteTextEditorWithRef` as part of the package's public API.
 */

export * from "./editor";
