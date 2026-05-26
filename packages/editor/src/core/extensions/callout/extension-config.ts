/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Schema-only TipTap node configuration for the custom callout block.
 *
 * This module declares the ProseMirror node spec (name, content model, attributes, parseHTML,
 * renderHTML, markdown serialization) with NO React `NodeView` attached, so it can be consumed
 * in non-DOM contexts. Callout is a first-party Plane block — it is NOT a wrapper around any
 * upstream `@tiptap/extension-*` package — and its node `name` is bound to
 * {@link CORE_EXTENSIONS.CALLOUT} (defined in `packages/editor/src/core/constants/extension.ts`).
 *
 * WHY the dual `extension-config.ts` / `extension.tsx` split: server-side conversion paths
 * (PDF export, markdown-to-HTML rendering invoked from `apps/live`, and the
 * `core-without-props.ts` registry consumed by Node.js contexts) cannot evaluate React
 * `ReactNodeViewRenderer`. This schema-only config exposes parseHTML, renderHTML, attributes,
 * and markdown serialization without dragging in React; the runtime variant in `./extension.tsx`
 * `extend`s this config to add the React `NodeView`, interactive commands, and keyboard shortcuts.
 *
 * Consumed by `packages/editor/src/core/extensions/core-without-props.ts` for non-DOM rendering
 * and by `./extension.tsx` as the base for the interactive variant. The same without-props split
 * pattern is used by `custom-image/`, `mentions/`, and `work-item-embed/`.
 */

import { Node, mergeAttributes } from "@tiptap/core";
import type { MarkdownSerializerState } from "@tiptap/pm/markdown";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// types
import { ECalloutAttributeNames } from "./types";
import type { CustomCalloutExtensionType, TCalloutBlockAttributes } from "./types";
// utils
import { DEFAULT_CALLOUT_BLOCK_ATTRIBUTES } from "./utils";

/**
 * Augments TipTap's global `Commands<ReturnType>` interface so that
 * `editor.commands.insertCallout()` is type-visible to all consumers.
 *
 * Declaring the command type on the schema-only config (this file) means both with-props and
 * without-props editor registries see the command at the type level, even though only the
 * with-props variant (`./extension.tsx`, `addCommands`) actually wires the runtime body.
 * The key `[CORE_EXTENSIONS.CALLOUT]` resolves to `"calloutComponent"` and must match the
 * `name` field of the `Node.create({...})` call below.
 */
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    [CORE_EXTENSIONS.CALLOUT]: {
      insertCallout: () => ReturnType;
    };
  }
}

/**
 * Schema-only TipTap node spec for the custom callout block.
 *
 * Encapsulates the name, content model, attribute defaults, HTML round-trip rules, and
 * markdown serialization — everything except React-dependent rendering, which is layered on
 * by `./extension.tsx`.
 *
 * Node kind: block-level (`group: "block"`) container that holds one or more nested blocks
 * (`content: "block+"`), so the callout body can carry paragraphs, lists, headings, and other
 * block content.
 *
 * Attributes: derived by reducing over {@link ECalloutAttributeNames} — `id`,
 * `data-icon-color`, `data-icon-name`, `data-emoji-unicode`, `data-emoji-url`,
 * `data-logo-in-use`, `data-background`, and `data-block-type` — each seeded from
 * {@link DEFAULT_CALLOUT_BLOCK_ATTRIBUTES}. WHY a reduce instead of an explicit object
 * literal: the attribute set is fully derived from the enum, so adding a new attribute
 * requires only adding an enum member plus a default — eliminating drift between
 * `ECalloutAttributeNames`, the attribute schema, and the default seeds.
 *
 * Markdown serialization (`addStorage.markdown.serialize`): CommonMark has no native callout
 * primitive, so the callout is represented as a `>`-prefixed blockquote with an inline HTML
 * tag for the logo — `<img src=... alt=... width="30px" />` for emoji logos (the
 * emoji-datasource-apple PNGs render predictably across CommonMark renderers) or
 * `<icon>NAME icon</icon>` for Lucide icons (a Plane-specific HTML token the deserializer
 * recognizes). The body is then wrapped via `state.wrapBlock("> ", null, node, ...)` so every
 * line of inner content survives a round trip through CommonMark blockquote parsing.
 *
 * HTML parsing (`parseHTML`): matches `div[data-block-type="callout-component"]`. The
 * block-type discriminator is the canonical marker — without it, plain `<div>` elements
 * would also match and pollute the document.
 *
 * HTML rendering (`renderHTML`): emits `<div>` with all `HTMLAttributes` collapsed via
 * `mergeAttributes`; the trailing `0` is the ProseMirror content-hole index where the inner
 * block content is rendered.
 *
 * What this config does NOT carry (delegated to `./extension.tsx`): `selectable`,
 * `draggable`, the `insertCallout` command body, keyboard shortcuts (Backspace boundary
 * escape and ArrowUp/Down paragraph boundary insertion), and the React `NodeView`.
 */
export const CustomCalloutExtensionConfig: CustomCalloutExtensionType = Node.create({
  name: CORE_EXTENSIONS.CALLOUT,
  group: "block",
  content: "block+",

  addAttributes() {
    const attributes = {
      // Reduce instead of map to accumulate the attributes directly into an object
      ...Object.values(ECalloutAttributeNames).reduce(
        (acc, value) => {
          acc[value] = {
            default: DEFAULT_CALLOUT_BLOCK_ATTRIBUTES[value],
          };
          return acc;
        },
        {} as Record<ECalloutAttributeNames, { default: TCalloutBlockAttributes[ECalloutAttributeNames] }>
      ),
    };

    return attributes;
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          const attrs = node.attrs as TCalloutBlockAttributes;
          const logoInUse = attrs["data-logo-in-use"];
          // add callout logo
          if (logoInUse === "emoji") {
            state.write(
              `> <img src="${attrs["data-emoji-url"]}" alt="${attrs["data-emoji-unicode"]}" width="30px" />\n`
            );
          } else {
            state.write(`> <icon>${attrs["data-icon-name"]} icon</icon>\n`);
          }
          // add an empty line after the logo
          state.write("> \n");
          // add '> ' before each line of the callout content
          state.wrapBlock("> ", null, node, () => state.renderContent(node));
          state.closeBlock(node);
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `div[${ECalloutAttributeNames.BLOCK_TYPE}="${DEFAULT_CALLOUT_BLOCK_ATTRIBUTES[ECalloutAttributeNames.BLOCK_TYPE]}"]`,
      },
    ];
  },

  // Render HTML for the callout node
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes), 0];
  },
});
