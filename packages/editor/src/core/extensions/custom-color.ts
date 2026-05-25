/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Text-color and background-color mark for the Plane editor.
 *
 * Exports `CustomColorExtension`, a custom ProseMirror `Mark` defined from
 * scratch via `@tiptap/core`'s `Mark.create()` — NOT a wrapper of
 * `@tiptap/extension-color`. The mark is hand-rolled so that a single
 * ProseMirror mark can carry BOTH `color` and `backgroundColor` attributes
 * for efficient HTML round-trip and so that each color attribute can be
 * mutated independently of the other.
 *
 * Public surface added to the editor command set (via the
 * `declare module "@tiptap/core"` augmentation below):
 *   - `setTextColor(color)`        — apply a foreground color
 *   - `unsetTextColor()`           — clear the foreground color only
 *   - `setBackgroundColor(color)`  — apply a background color
 *   - `unsetBackgroundColor()`     — clear the background color only
 */

import { Mark, mergeAttributes } from "@tiptap/core";
// constants
import { COLORS_LIST } from "@/constants/common";
import { CORE_EXTENSIONS } from "@/constants/extension";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    [CORE_EXTENSIONS.CUSTOM_COLOR]: {
      /**
       * Set the text color
       * @param {string} color The color to set
       * @example editor.commands.setTextColor('red')
       */
      setTextColor: (color: string) => ReturnType;

      /**
       * Unset the text color
       * @example editor.commands.unsetTextColor()
       */
      unsetTextColor: () => ReturnType;
      /**
       * Set the background color
       * @param {string} backgroundColor The color to set
       * @example editor.commands.setBackgroundColor('red')
       */
      setBackgroundColor: (backgroundColor: string) => ReturnType;

      /**
       * Unset the background color
       * @example editor.commands.unsetBackgroundColorColor()
       */
      unsetBackgroundColor: () => ReturnType;
    };
  }
}

/**
 * Plane editor text-color and background-color mark.
 *
 * First-party note:
 *   Plane does NOT use `@tiptap/extension-color`. The mark is defined from
 *   scratch so a single ProseMirror mark can carry BOTH `color` and
 *   `backgroundColor` attributes simultaneously, letting the four exported
 *   commands mutate one color attribute without disturbing the other. The
 *   standard Exposes/Overrides/Hides triplet that applies to TipTap-wrapper
 *   extensions in this package therefore does not apply here — there is no
 *   upstream extension to expose, override, or hide.
 *
 * Schema:
 *   Mark name: `CORE_EXTENSIONS.CUSTOM_COLOR` (value `"customColor"`).
 *   Attributes:
 *     - `color` (default `null`): parsed from the `data-text-color` HTML
 *       attribute and serialized back to the same attribute on `<span>`. If
 *       the value matches a key in `COLORS_LIST` (the design-system palette),
 *       only the `data-text-color` attribute is emitted — Plane's stylesheet
 *       resolves the palette token via a `data-text-color` selector. For any
 *       value NOT in `COLORS_LIST` (e.g., a raw hex like `#ff00aa`), an
 *       inline `style="color: <value>"` is also emitted so custom CSS colors
 *       render correctly.
 *     - `backgroundColor` (default `null`): same dual-attribute strategy via
 *       `data-background-color` plus inline `style="background-color: ..."`
 *       fallback for out-of-palette values.
 *
 * HTML parsing (`parseHTML`):
 *   Matches `<span>` elements carrying either `data-text-color` or
 *   `data-background-color`. Each rule's `getAttrs` returns `null` to signal
 *   a successful match while letting the per-attribute `parseHTML` functions
 *   above harvest the actual attribute values.
 *
 * HTML rendering (`renderHTML`):
 *   Emits `<span {...mergedAttributes}>...</span>` with `mergeAttributes`
 *   composing options-level HTMLAttributes with the per-mark attributes.
 *
 * Markdown serialization (`addStorage().markdown.serialize`):
 *   Empty `open` / `close` delimiters with `mixable: true` and
 *   `expelEnclosingWhitespace: true`. Color information is intentionally NOT
 *   preserved when the document is exported to markdown via
 *   `tiptap-markdown` — markdown has no representation for inline color so
 *   the mark renders as a no-op text passthrough.
 *
 * Commands:
 *   - `setTextColor(color)`        — `setMark(name, { color })`.
 *   - `unsetTextColor()`           — `setMark(name, { color: null })`, NOT
 *     `unsetMark(name)`. Because color and backgroundColor are co-located on
 *     the same mark, calling `unsetMark` would also clear any active
 *     backgroundColor; setting one attribute to `null` keeps the other
 *     intact.
 *   - `setBackgroundColor(color)`  — `setMark(name, { backgroundColor })`.
 *   - `unsetBackgroundColor()`     — `setMark(name, { backgroundColor: null })`,
 *     for the same independence reason as `unsetTextColor`.
 */
export const CustomColorExtension = Mark.create({
  name: CORE_EXTENSIONS.CUSTOM_COLOR,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-text-color"),
        renderHTML: (attributes: { color: string }) => {
          const { color } = attributes;
          if (!color) {
            return {};
          }

          let elementAttributes: Record<string, string> = {
            "data-text-color": color,
          };

          if (!COLORS_LIST.find((c) => c.key === color)) {
            elementAttributes = {
              ...elementAttributes,
              style: `color: ${color}`,
            };
          }

          return elementAttributes;
        },
      },
      backgroundColor: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-background-color"),
        renderHTML: (attributes: { backgroundColor: string }) => {
          const { backgroundColor } = attributes;
          if (!backgroundColor) {
            return {};
          }

          let elementAttributes: Record<string, string> = {
            "data-background-color": backgroundColor,
          };

          if (!COLORS_LIST.find((c) => c.key === backgroundColor)) {
            elementAttributes = {
              ...elementAttributes,
              style: `background-color: ${backgroundColor}`,
            };
          }

          return elementAttributes;
        },
      },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open: "",
          close: "",
          mixable: true,
          expelEnclosingWhitespace: true,
        },
      },
    };
  },

  // @ts-expect-error types are incorrect
  // TODO: check this and update types
  parseHTML() {
    return [
      {
        tag: "span",
        getAttrs: (node) => node.getAttribute("data-text-color") && null,
      },
      {
        tag: "span",
        getAttrs: (node) => node.getAttribute("data-background-color") && null,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setTextColor:
        (color: string) =>
        ({ chain }) =>
          chain().setMark(this.name, { color }).run(),
      unsetTextColor:
        () =>
        ({ chain }) =>
          chain().setMark(this.name, { color: null }).run(),
      setBackgroundColor:
        (backgroundColor: string) =>
        ({ chain }) =>
          chain().setMark(this.name, { backgroundColor }).run(),
      unsetBackgroundColor:
        () =>
        ({ chain }) =>
          chain().setMark(this.name, { backgroundColor: null }).run(),
    };
  },
});
