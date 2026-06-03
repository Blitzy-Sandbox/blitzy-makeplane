/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Runtime variant of the default-image Tiptap extension — composes
 * `ImageExtensionConfig` (a thin wrapper around `@tiptap/extension-image`)
 * with runtime-only behavior: file-handler integration, keyboard
 * shortcuts at node boundaries, per-editor storage, and a React `NodeView`.
 *
 * The module is paired with `./extension-config.tsx`. The split mirrors
 * `callout/`, `custom-image/`, `mentions/`, and `work-item-embed/` and
 * exists so the schema-only config can be reused in without-props
 * contexts (SSR / PDF export via `core-without-props.ts`) where no
 * `fileHandler` is available, while the runtime variant exported here
 * is wired into the live editor in `extensions.ts`.
 *
 * Distinct from the sibling `CustomImageExtension` (in
 * `../custom-image/extension.tsx`) — both ship together at registration.
 * THIS extension targets `CORE_EXTENSIONS.IMAGE = "image"` (the default
 * Tiptap image node name) so legacy `<img>` tags in pre-existing HTML
 * content continue to parse and render. The sibling targets
 * `CORE_EXTENSIONS.CUSTOM_IMAGE = "imageComponent"` and powers NEW
 * images inserted through the editor toolbar (with upload, alignment,
 * deferred deletion, validation). Removing this module would break
 * rendering for legacy HTML image content.
 */

import { ReactNodeViewRenderer } from "@tiptap/react";
// constants
import type { CORE_EXTENSIONS } from "@/constants/extension";
// helpers
import { insertEmptyParagraphAtNodeBoundaries } from "@/helpers/insert-empty-paragraph-at-node-boundary";
// types
import type { TFileHandler } from "@/types";
// local imports
import type { CustomImageNodeViewProps } from "../custom-image/components/node-view";
import { CustomImageNodeView } from "../custom-image/components/node-view";
import { ImageExtensionConfig } from "./extension-config";

/**
 * Augments Tiptap's global `Storage` interface so
 * `editor.storage[CORE_EXTENSIONS.IMAGE]` is typed as `ImageExtensionStorage`.
 * `CORE_EXTENSIONS.IMAGE` resolves to the string `"image"` — the default
 * Tiptap image node name (see
 * `packages/editor/src/core/constants/extension.ts:L27`).
 */
declare module "@tiptap/core" {
  interface Storage {
    [CORE_EXTENSIONS.IMAGE]: ImageExtensionStorage;
  }
}

/**
 * Per-editor storage shape for the default-image extension; tracks which
 * image `src` URLs have been soft-deleted within the editor session.
 * Keyed by image `src` (string); value `true` indicates a soft-deleted
 * entry. The `declare module` augmentation above registers this shape
 * under `editor.storage[CORE_EXTENSIONS.IMAGE]`.
 */
export type ImageExtensionStorage = {
  deletedImageSet: Map<string, boolean>;
};

/**
 * Constructor props for `ImageExtension`. `fileHandler` (required, type
 * `TFileHandler` from `@/types`) supplies the file-handling callbacks
 * (`getAssetSrc` and optional `validation.maxFileSize`) consumed by this
 * extension.
 */
type Props = {
  fileHandler: TFileHandler;
};

/**
 * Builds the runtime default-image extension by extending
 * `ImageExtensionConfig` with runtime-only behavior. Wraps
 * `@tiptap/extension-image` (transitively via `ImageExtensionConfig.extend(...)`).
 * Registers under `CORE_EXTENSIONS.IMAGE = "image"` — the default Tiptap
 * image schema node name.
 *
 * **Exposes** (inherited from `@tiptap/extension-image` upstream, unchanged):
 * - The `image` Node schema (Tiptap node name `"image"`).
 * - The `setImage({ src, alt, title })` command — the parent command
 *   surface is left intact via the `...this.parent?.()` spread in
 *   `addOptions()`.
 * - HTML `<img>` `parseHTML` / `renderHTML` machinery, so existing
 *   `<img>` tags in incoming HTML continue to parse into this node.
 * - The upstream `src`, `alt`, `title` attributes — preserved via
 *   `this.parent?.()` inside `ImageExtensionConfig.addAttributes()`.
 *
 * **Overrides** (layered on top of `@tiptap/extension-image`):
 * - `addAttributes()` (in `ImageExtensionConfig`): adds `width`
 *   (default `"35%"`), `height` (default `null`), `aspectRatio`
 *   (default `null`), and `alignment` (default `"left"`) on top of
 *   upstream `src` / `alt` / `title`.
 * - `addOptions()` (here): injects `getImageSource: getAssetSrc` so the
 *   React `NodeView` can resolve asset-storage URLs through the
 *   file-handler.
 * - `addKeyboardShortcuts()` (here): binds `ArrowDown` and `ArrowUp` to
 *   `insertEmptyParagraphAtNodeBoundaries` so the caret escapes cleanly
 *   out of an atomic image node — without this, image nodes can trap
 *   the cursor at the top or bottom of the document.
 * - `addStorage()` (here): initializes per-editor storage
 *   `{ deletedImageSet: Map<string, boolean>, maxFileSize: number }`.
 *   `maxFileSize` is read from `fileHandler.validation?.maxFileSize`
 *   when the `validation` key is present, defaulting to `0` otherwise.
 * - `addNodeView()` (here): renders via `ReactNodeViewRenderer` +
 *   `CustomImageNodeView` (reused from
 *   `../custom-image/components/node-view`). The cast
 *   `props.node as CustomImageNodeViewProps["node"]` is required
 *   because the `image/` and `custom-image/` nodes share the
 *   `NodeView` component but declare their attribute shapes independently.
 *
 * **Hides** (upstream behavior intentionally suppressed):
 * - The upstream HTML `<img>` `renderHTML` output is effectively
 *   replaced at runtime by the React `NodeView` (`addNodeView`). The
 *   upstream renderer remains present in the schema config (so `<img>`
 *   content still parses on initial load), but the editor never uses
 *   it for live rendering — `CustomImageNodeView` owns the on-screen
 *   presentation.
 *
 * Cross-references:
 * - Companion config: `./extension-config.tsx` (schema-only; consumed
 *   in without-props contexts via `core-without-props.ts`).
 * - Sibling extension: `../custom-image/extension.tsx`
 *   (`CustomImageExtension`, registered under
 *   `CORE_EXTENSIONS.CUSTOM_IMAGE = "imageComponent"` — a different node).
 * - NodeView component: `../custom-image/components/node-view.tsx`
 *   (`CustomImageNodeView`).
 * - Keyboard helper: `@/helpers/insert-empty-paragraph-at-node-boundary`.
 * - Constants: `CORE_EXTENSIONS.IMAGE` at
 *   `packages/editor/src/core/constants/extension.ts:L27`.
 *
 * @param props - Constructor props (see `Props`). `props.fileHandler`
 *   (`TFileHandler`) supplies `getAssetSrc` and optionally
 *   `fileHandler.validation?.maxFileSize`.
 * @returns A Tiptap extension instance ready for registration in
 *   `extensions.ts` (see `CoreEditorExtensions`).
 */
export function ImageExtension(props: Props) {
  const { fileHandler } = props;
  // derived values
  const { getAssetSrc } = fileHandler;

  return ImageExtensionConfig.extend({
    addOptions() {
      return {
        ...this.parent?.(),
        getImageSource: getAssetSrc,
      };
    },

    addKeyboardShortcuts() {
      return {
        ArrowDown: insertEmptyParagraphAtNodeBoundaries("down", this.name),
        ArrowUp: insertEmptyParagraphAtNodeBoundaries("up", this.name),
      };
    },

    // storage to keep track of image states Map<src, isDeleted>
    addStorage() {
      const maxFileSize = "validation" in fileHandler ? fileHandler.validation?.maxFileSize : 0;

      return {
        deletedImageSet: new Map<string, boolean>(),
        maxFileSize,
      };
    },

    // render custom image node
    addNodeView() {
      return ReactNodeViewRenderer((props) => (
        <CustomImageNodeView {...props} node={props.node as CustomImageNodeViewProps["node"]} />
      ));
    },
  });
}
