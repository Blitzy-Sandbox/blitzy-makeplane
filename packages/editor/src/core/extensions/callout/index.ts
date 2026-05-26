/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public barrel entry for the custom callout extension package.
 *
 * Consumed by `packages/editor/src/core/extensions/index.ts` via
 * `export * from "./callout";`, which in turn feeds the editor's
 * `CORE_EXTENSIONS` registry used by the React editor variants.
 *
 * Re-exports only `./extension`, which transitively exposes
 * `CustomCalloutExtension` — the React-aware runtime extension that
 * binds a `ReactNodeViewRenderer` to the callout node so its logo and
 * color selectors render inside the editor.
 *
 * The schema-only `CustomCalloutExtensionConfig` from `./extension-config`
 * is intentionally NOT re-exported here; `core/extensions/core-without-props.ts`
 * imports it directly so without-props consumers (SSR, PDF export) can
 * participate in the document schema while bypassing the React node view.
 *
 * First-party origin: callout is a custom Plane node and is not a wrapper
 * of any upstream `@tiptap/extension-*` package.
 */

export * from "./extension";
