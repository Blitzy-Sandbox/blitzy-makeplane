/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Schema-only TipTap configuration for the default `image` node — extends
 * upstream `@tiptap/extension-image` with Plane-specific attribute defaults
 * (width / height / aspectRatio / alignment) and intentionally depends on no
 * runtime services: no `fileHandler`, no React `NodeView`, no editor instance.
 *
 * Why this is split from `./extension.tsx`:
 *   This config is consumed in "without-props" contexts where no
 *   `fileHandler` exists — specifically
 *   `packages/editor/src/core/extensions/core-without-props.ts`, which
 *   registers `ImageExtensionConfig` alongside `CustomImageExtensionConfig`
 *   for the server-side rendering and PDF export pipelines. The runtime
 *   sibling `./extension.tsx` (`ImageExtension` factory) re-extends this
 *   config with `addOptions()` / `addStorage()` / `addNodeView()` / keyboard
 *   shortcuts for use inside the live editor.
 *
 * Why distinct from `custom-image/extension-config.ts`:
 *   The sibling `custom-image/` config registers under TipTap node name
 *   `CORE_EXTENSIONS.CUSTOM_IMAGE = "imageComponent"` and owns the modern
 *   editor-inserted image flow (upload, React node view, restore). THIS
 *   config inherits the upstream `@tiptap/extension-image` node name
 *   `CORE_EXTENSIONS.IMAGE = "image"` and exists to parse legacy `<img>`
 *   HTML — both configs ship together because removing either would orphan
 *   one content source.
 */

import { Image as BaseImageExtension } from "@tiptap/extension-image";
// local imports
import type { CustomImageExtensionOptions } from "../custom-image/types";
import type { ImageExtensionStorage } from "./extension";

/**
 * Thin Plane-specific extension of the upstream `@tiptap/extension-image`
 * `Image` node. The schema, commands, `parseHTML`, and `renderHTML` are all
 * inherited unchanged; only Plane's image-layout attribute defaults are
 * layered on top.
 *
 * Node name:
 *   Inherits `name: "image"` from `BaseImageExtension` — matches
 *   `CORE_EXTENSIONS.IMAGE` in `packages/editor/src/core/constants/extension.ts`.
 *
 * Generic type parameters:
 *   - Options = `Pick<CustomImageExtensionOptions, "getImageSource">` —
 *     narrows the extension's options surface to the single `getImageSource`
 *     field. No `addOptions()` override is provided here, so the field
 *     resolves to `undefined` at runtime; the live-editor sibling in
 *     `./extension.tsx` populates it via `fileHandler.getAssetSrc`. Reusing
 *     the same `CustomImageExtensionOptions` supertype keeps a single
 *     options-shape contract across the `image/` and `custom-image/`
 *     extensions even though only one option key is honored here.
 *   - Storage = `ImageExtensionStorage` — declared up front so consumers see
 *     consistent typing for `editor.storage[CORE_EXTENSIONS.IMAGE]`. Storage
 *     is NOT initialized in this config; the runtime sibling adds the
 *     `addStorage()` override.
 *
 * `addAttributes()` override:
 *   Spreads `this.parent?.()` first to preserve upstream `src` / `alt` /
 *   `title` attributes, then layers four Plane-specific defaults:
 *     - `width`       — `"35%"` (string so it accepts both `%` and `px`).
 *     - `height`      — `null` (auto-derived from `aspectRatio` or intrinsic).
 *     - `aspectRatio` — `null` (when non-null, drives the rendered height).
 *     - `alignment`   — `"left"` (other valid values `"center"` / `"right"`
 *       are enforced by the toolbar UI in `custom-image/components/toolbar/`,
 *       not by schema validation here).
 *
 * Upstream behavior NOT overridden (still active from `@tiptap/extension-image`):
 *   - `parseHTML`     — still parses `<img src=...>` tags.
 *   - `renderHTML`    — still emits `<img>` on HTML serialization (this is
 *     what server-side rendering and PDF export rely on).
 *   - `setImage`      — still callable as
 *     `editor.commands.setImage({ src, alt, title })`.
 *
 * Exposes / Overrides / Hides (relative to `@tiptap/extension-image`):
 *   - Exposes: `<img>` schema, `setImage` command, `parseHTML`, `renderHTML`,
 *     and the upstream `src` / `alt` / `title` attributes — all inherited
 *     verbatim.
 *   - Overrides: `addAttributes()` only, to add the four layout-attribute
 *     defaults above.
 *   - Hides: nothing — the upstream HTML rendering is preserved here. The
 *     runtime sibling (`./extension.tsx`) is where the rendered output is
 *     replaced by a React `NodeView` at editor runtime; SSR / PDF consumers
 *     of THIS config get upstream rendering unchanged.
 */
export const ImageExtensionConfig = BaseImageExtension.extend<
  Pick<CustomImageExtensionOptions, "getImageSource">,
  ImageExtensionStorage
>({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: "35%",
      },
      height: {
        default: null,
      },
      aspectRatio: {
        default: null,
      },
      alignment: {
        default: "left",
      },
    };
  },
});
