/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel for the `@tiptap/extension-image` wrapper that backs the default
 * `<img>` schema (registered as `CORE_EXTENSIONS.IMAGE = "image"`). Re-exports:
 *   - {@link ImageExtension} — runtime factory used by the live editor
 *     (consumed by `core/extensions/extensions.ts`).
 *   - {@link ImageExtensionConfig} — schema-only config used in without-props
 *     contexts such as SSR and PDF export (consumed by `core-without-props.ts`).
 *   - {@link ImageExtensionStorage} — storage shape type registered on the
 *     Tiptap `Storage` interface under the `"image"` node name.
 *
 * NOT redundant with the sibling `custom-image/` folder. This barrel ships the
 * extension that parses legacy `<img>` tags found in pre-existing HTML content;
 * `custom-image/` ships the `imageComponent` extension
 * (`CORE_EXTENSIONS.CUSTOM_IMAGE = "imageComponent"`) that powers new editor-
 * inserted images (toolbar, alignment, deferred deletion, upload lifecycle).
 * Both are registered together in `core-without-props.ts` and `extensions.ts`;
 * removing either breaks rendering for one of the two content sources.
 */

export * from "./extension";
export * from "./extension-config";
