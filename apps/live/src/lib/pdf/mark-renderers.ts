/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Inline formatting behavior for TipTap marks in the PDF subsystem.
 *
 * Marks (`bold`, `italic`, `underline`, `strike`, `code`, `link`, `textStyle`,
 * `highlight`, `subscript`, `superscript`, `customColor`) are folded onto a
 * base React-PDF `Style` by `applyMarks`, which iterates the editor's
 * mark order and stacks each contribution. Later marks win on property
 * conflicts (e.g., a `customColor` after a `link` overrides the link color).
 *
 * Color-bearing marks (`textStyle`, `highlight`, `customColor`) resolve color
 * tokens through `./colors.resolveColorForPdf` so editor color keys, CSS
 * variable references (`var(--editor-colors-...)`) and literal hex / rgb
 * values all normalize to PDF-safe values.
 */

import type { Style } from "@react-pdf/types";
import {
  BACKGROUND_COLORS,
  CODE_COLORS,
  EDITOR_BACKGROUND_COLORS,
  EDITOR_TEXT_COLORS,
  LINK_COLORS,
  resolveColorForPdf,
} from "./colors";
import type { MarkRendererRegistry, TipTapMark } from "./types";

/**
 * Registry mapping TipTap mark `type` names to functions that return the
 * partial React-PDF `Style` contribution of that mark. Each function receives
 * the current accumulated style and returns the next; `applyMarks` composes
 * them in the order the editor emitted them.
 *
 * Notable entries:
 *  - `bold` / `italic` / `underline` / `strike` apply the obvious React-PDF
 *    `fontWeight` / `fontStyle` / `textDecoration` properties.
 *  - `code` switches to a monospace font and applies the inline-code
 *    background + text color tokens from `./colors`.
 *  - `link` applies the brand link color and underline decoration.
 *  - `textStyle` carries arbitrary `color` / `backgroundColor` strings from
 *    the editor's text-style extension; values are accepted as-is (assumed to
 *    be valid CSS color strings).
 *  - `highlight` defaults to the purple editor background when no color is
 *    provided in the mark attrs.
 *  - `subscript` / `superscript` reduce the font size to 8 (the PDF subsystem
 *    does not currently offset baselines).
 *  - `customColor` resolves both `data-text-color` and `data-background-color`
 *    through `./colors` with hex / rgb / color-key fallbacks (see its inline
 *    JSDoc).
 */
export const markRenderers: MarkRendererRegistry = {
  bold: (_mark: TipTapMark, style: Style): Style => ({
    ...style,
    fontWeight: "bold",
  }),

  italic: (_mark: TipTapMark, style: Style): Style => ({
    ...style,
    fontStyle: "italic",
  }),

  underline: (_mark: TipTapMark, style: Style): Style => ({
    ...style,
    textDecoration: "underline",
  }),

  strike: (_mark: TipTapMark, style: Style): Style => ({
    ...style,
    textDecoration: "line-through",
  }),

  code: (_mark: TipTapMark, style: Style): Style => ({
    ...style,
    fontFamily: "Courier",
    fontSize: 10,
    backgroundColor: BACKGROUND_COLORS.layer1,
    color: CODE_COLORS.text,
  }),

  link: (_mark: TipTapMark, style: Style): Style => ({
    ...style,
    color: LINK_COLORS.primary,
    textDecoration: "underline",
  }),

  textStyle: (mark: TipTapMark, style: Style): Style => {
    const attrs = mark.attrs || {};
    const newStyle: Style = { ...style };

    if (attrs.color && typeof attrs.color === "string") {
      newStyle.color = attrs.color;
    }

    if (attrs.backgroundColor && typeof attrs.backgroundColor === "string") {
      newStyle.backgroundColor = attrs.backgroundColor;
    }

    return newStyle;
  },

  highlight: (mark: TipTapMark, style: Style): Style => {
    const attrs = mark.attrs || {};
    return {
      ...style,
      backgroundColor: (attrs.color as string) || EDITOR_BACKGROUND_COLORS.purple,
    };
  },

  subscript: (_mark: TipTapMark, style: Style): Style => ({
    ...style,
    fontSize: 8,
  }),

  superscript: (_mark: TipTapMark, style: Style): Style => ({
    ...style,
    fontSize: 8,
  }),

  /**
   * Custom color mark handler
   * Handles the customColor extension which stores colors as data-text-color and data-background-color attributes
   * The colors can be either:
   * 1. Color keys like "gray", "peach", "pink", etc. (from COLORS_LIST)
   * 2. Direct hex values for custom colors
   * 3. CSS variable references like "var(--editor-colors-gray-text)"
   */
  customColor: (mark: TipTapMark, style: Style): Style => {
    const attrs = mark.attrs || {};
    const newStyle: Style = { ...style };

    // Handle text color (stored in 'color' attribute)
    const textColor = attrs.color as string | undefined;
    if (textColor) {
      const resolvedColor = resolveColorForPdf(textColor, "text");
      if (resolvedColor) {
        newStyle.color = resolvedColor;
      } else if (textColor.startsWith("#") || textColor.startsWith("rgb")) {
        // Direct color value
        newStyle.color = textColor;
      } else if (textColor in EDITOR_TEXT_COLORS) {
        // Color key lookup
        newStyle.color = EDITOR_TEXT_COLORS[textColor as keyof typeof EDITOR_TEXT_COLORS];
      }
    }

    // Handle background color (stored in 'backgroundColor' attribute)
    const backgroundColor = attrs.backgroundColor as string | undefined;
    if (backgroundColor) {
      const resolvedColor = resolveColorForPdf(backgroundColor, "background");
      if (resolvedColor) {
        newStyle.backgroundColor = resolvedColor;
      } else if (backgroundColor.startsWith("#") || backgroundColor.startsWith("rgb")) {
        // Direct color value
        newStyle.backgroundColor = backgroundColor;
      } else if (backgroundColor in EDITOR_BACKGROUND_COLORS) {
        // Color key lookup
        newStyle.backgroundColor = EDITOR_BACKGROUND_COLORS[backgroundColor as keyof typeof EDITOR_BACKGROUND_COLORS];
      }
    }

    return newStyle;
  },
};

/**
 * Reducer that folds an ordered array of TipTap marks onto a base `Style`.
 * Looks up each mark in `markRenderers` and applies its contribution; unknown
 * mark types are silently skipped so adding new TipTap extensions never
 * crashes the PDF pipeline.
 *
 * Order matters: later marks override earlier marks on property conflicts.
 *
 * @param marks     - Ordered list of marks (e.g., from a TipTap text node's
 *                    `.marks` array). `undefined` or empty returns `baseStyle`
 *                    unchanged.
 * @param baseStyle - Starting `Style` object. Defaults to `{}`.
 * @returns A new `Style` with all known mark contributions merged.
 */
export const applyMarks = (marks: TipTapMark[] | undefined, baseStyle: Style = {}): Style => {
  if (!marks || marks.length === 0) {
    return baseStyle;
  }

  return marks.reduce((style, mark) => {
    const renderer = markRenderers[mark.type];
    if (renderer) {
      return renderer(mark, style);
    }
    return style;
  }, baseStyle);
};
