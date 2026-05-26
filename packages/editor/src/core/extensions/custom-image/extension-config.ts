/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Schema-only Tiptap node configuration for the custom-image extension.
 *
 * This module defines `CustomImageExtensionConfig` — the schema-only variant
 * of the custom-image node, derived by extending upstream
 * `@tiptap/extension-image`. It is the source of truth for the node's
 * attribute schema, HTML parse/serialize rules, and the typed `Commands` +
 * `Storage` module augmentations of `@tiptap/core`. This file intentionally
 * does NOT wire any runtime React node-view, file-handler callbacks,
 * `addCommands`, or `addStorage` initialization — those concerns live in the
 * sibling `./extension.tsx`, which further extends this config.
 *
 * Why a separate schema-only variant exists: the node-view in
 * `./extension.tsx` depends on `@tiptap/react`'s `ReactNodeViewRenderer`,
 * which requires a React DOM environment. Splitting the schema from the
 * node-view lets schema-only consumers parse and serialize document content
 * without instantiating any React tree.
 *
 * Use cases for the schema-only variant:
 *   - Server-side rendering paths where React DOM is unavailable.
 *   - PDF export pipeline in `apps/live/services/pdf-export/`, where HTML →
 *     PDF conversion needs the schema (to parse stored documents) but not
 *     the interactive node-view (resize handles, alignment toolbar, etc.).
 *   - Any context that must read or serialize stored document content
 *     without booting the editor UI.
 *
 * Cross-references:
 *   - `CORE_EXTENSIONS.CUSTOM_IMAGE` resolves to `"imageComponent"` (see
 *     `@/constants/extension`) and is the extension key used for storage
 *     and command namespacing.
 *   - `./extension.tsx` is the runtime variant that adds the React
 *     node-view, `addCommands`, `addStorage` initialization, and
 *     file-handler wiring on top of this config.
 */

import { mergeAttributes } from "@tiptap/core";
import { Image as BaseImageExtension } from "@tiptap/extension-image";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// local imports
import { ECustomImageAttributeNames } from "./types";
import type {
  CustomImageExtensionOptions,
  TCustomImageAttributes,
  CustomImageExtensionType,
  CustomImageExtensionStorage,
  InsertImageComponentProps,
} from "./types";
import { DEFAULT_CUSTOM_IMAGE_ATTRIBUTES } from "./utils";

/**
 * Module augmentation of `@tiptap/core` for the custom-image extension.
 *
 * Globally augments Tiptap's `Commands<ReturnType>` and `Storage`
 * interfaces so that `editor.commands.insertImageComponent(...)` and
 * `editor.storage.imageComponent` are type-safe across the codebase
 * without needing per-call-site casts.
 *
 * - `Commands[CORE_EXTENSIONS.CUSTOM_IMAGE].insertImageComponent` registers
 *   the command signature `({ file, pos, event }: InsertImageComponentProps)
 *   => ReturnType`. Only the type is declared here; the command's runtime
 *   implementation lives in `./extension.tsx`'s `addCommands()` hook.
 * - `Storage[CORE_EXTENSIONS.CUSTOM_IMAGE]` types the storage entry as
 *   `CustomImageExtensionStorage` (containing `fileMap`, `deletedImageSet`,
 *   `maxFileSize`). The storage object itself is initialized in
 *   `./extension.tsx`'s `addStorage()` hook.
 */
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    [CORE_EXTENSIONS.CUSTOM_IMAGE]: {
      insertImageComponent: ({ file, pos, event }: InsertImageComponentProps) => ReturnType;
    };
  }
  interface Storage {
    [CORE_EXTENSIONS.CUSTOM_IMAGE]: CustomImageExtensionStorage;
  }
}

/**
 * Schema-only custom-image node configuration built on
 * `@tiptap/extension-image` (`BaseImageExtension`).
 *
 * Extends the upstream `Image` node with Plane-specific layout/upload
 * attributes and a custom HTML tag (`<image-component>`) so that those
 * extra attributes survive HTML serialization round-trip.
 *
 * Schema characteristics:
 *   - `name`: `CORE_EXTENSIONS.CUSTOM_IMAGE` (`"imageComponent"`)
 *   - `group`: `"block"` — block-level node
 *   - `atom`: `true` — atomic node (no editable children; cursor cannot
 *     enter; treated as a single addressable unit by ProseMirror)
 *
 * Exposes (inherited from upstream `@tiptap/extension-image`):
 *   - The base `Image` node prototype, including the parent attribute set
 *     (e.g. `src`, `alt`, `title`). The parent attributes are preserved
 *     via `this.parent?.()` in `addAttributes()`, so consumers can still
 *     read/write the upstream fields.
 *   - The upstream `setImage` command (inherited; not overridden here).
 *
 * Overrides (relative to upstream):
 *   - Schema attribute set — extends the parent attributes with
 *     Plane-specific layout and upload metadata enumerated by
 *     `ECustomImageAttributeNames`: `id`, `width`, `height`,
 *     `aspectRatio`, `src`, `alignment`, `status`. Each attribute's
 *     default comes from `DEFAULT_CUSTOM_IMAGE_ATTRIBUTES`.
 *   - HTML serialization — parses and renders via the custom
 *     `<image-component>` HTML tag instead of the upstream `<img>` tag.
 *     The custom tag is required because HTML `<img>` (a void element)
 *     cannot legally carry non-standard attributes such as `aspectRatio`,
 *     `alignment`, or `status`; routing through `<image-component>` lets
 *     these survive HTML round-trip without loss.
 *
 * Hides (intentionally not provided by this config):
 *   - The interactive node-view UX — resize handles, alignment toolbar,
 *     full-screen viewer, and upload UX. These are added separately by
 *     `./extension.tsx`'s `addNodeView()`. In schema-only contexts (SSR,
 *     PDF export), images therefore render as static `<image-component>`
 *     markers with no interactive affordances.
 */
export const CustomImageExtensionConfig: CustomImageExtensionType = BaseImageExtension.extend<
  CustomImageExtensionOptions,
  CustomImageExtensionStorage
>({
  name: CORE_EXTENSIONS.CUSTOM_IMAGE,
  group: "block",
  atom: true,

  /**
   * Composes the node's attribute schema from upstream + Plane-specific
   * attributes.
   *
   * Spreads the parent extension's attribute definitions
   * (`this.parent?.()`) first, then layers Plane-specific attributes by
   * iterating every value in `ECustomImageAttributeNames`. Each generated
   * attribute entry uses its corresponding value in
   * `DEFAULT_CUSTOM_IMAGE_ATTRIBUTES` as the `default`.
   *
   * Why this enum-driven pattern: it keeps the schema in lockstep with
   * the canonical attribute-name enum — introducing a new attribute only
   * requires updating `ECustomImageAttributeNames` and
   * `DEFAULT_CUSTOM_IMAGE_ATTRIBUTES`, with no edits required here.
   */
  addAttributes() {
    const attributes = {
      ...this.parent?.(),
      ...Object.values(ECustomImageAttributeNames).reduce(
        (acc, value) => {
          acc[value] = {
            default: DEFAULT_CUSTOM_IMAGE_ATTRIBUTES[value],
          };
          return acc;
        },
        {} as Record<ECustomImageAttributeNames, { default: TCustomImageAttributes[ECustomImageAttributeNames] }>
      ),
    };

    return attributes;
  },

  /**
   * HTML → ProseMirror parse rule for the custom-image node.
   *
   * Recognizes `<image-component>` tags as instances of this node during
   * HTML parsing. The standard `<img>` tag is NOT matched here because
   * upstream `@tiptap/extension-image`'s own parse rule already claims it.
   *
   * Why a custom tag (not `<img>`): the HTML `<img>` element is a void
   * element and cannot legally carry non-standard attributes such as
   * `aspectRatio`, `alignment`, or `status`. Using a custom element name
   * lets those attributes survive HTML serialize → parse round-trip
   * without loss.
   */
  parseHTML() {
    return [
      {
        tag: "image-component",
      },
    ];
  },

  /**
   * ProseMirror → HTML serialize rule for the custom-image node.
   *
   * Emits the node as `<image-component ...>` with all node attributes
   * merged into the tag via `mergeAttributes(HTMLAttributes)`. This is
   * the inverse of `parseHTML()` above and lets the node round-trip
   * through HTML without dropping the Plane-specific attributes.
   *
   * Consumers that need to render the final visual image (e.g. the
   * `apps/live` PDF export pipeline) are responsible for translating
   * `<image-component src=... width=... alignment=...>` to a real `<img>`
   * with applied styles at their own rendering layer.
   */
  renderHTML({ HTMLAttributes }) {
    return ["image-component", mergeAttributes(HTMLAttributes)];
  },
});
