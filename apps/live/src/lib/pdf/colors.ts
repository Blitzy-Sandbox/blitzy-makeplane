/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Color tokens and resolution helpers for the PDF subsystem.
 *
 * Provides editor-facing palettes (text + background, light + dark themes),
 * Plane semantic palettes (neutrals, brand, text, background, border, code,
 * link, mention, status), and helpers that normalize raw hex values, CSS
 * variable references, and editor color keys into PDF-safe hex strings.
 *
 * Consumed by `./styles` (palette → stylesheet tokens), `./mark-renderers`
 * (`textStyle`, `highlight`, `customColor` marks call `resolveColorForPdf`),
 * and `./node-renderers` (`paragraph`, `tableHeader`, `tableCell`,
 * `calloutComponent` resolve `backgroundColor` attrs).
 */

/**
 * PDF Export Color Constants
 *
 * These colors are mapped from the editor CSS variables and tailwind-config tokens
 * to ensure PDF exports match the editor's appearance.
 *
 * Source mappings:
 * - Editor colors: packages/editor/src/styles/variables.css
 * - Tailwind tokens: packages/tailwind-config/variables.css
 */

/**
 * Editor text-color palette (semantic keys → hex). Sourced from
 * `packages/editor/src/styles/variables.css` `:root` — keep in sync when the
 * editor palette changes.
 */
export const EDITOR_TEXT_COLORS = {
  gray: "#5c5e63",
  peach: "#ff5b59",
  pink: "#f65385",
  orange: "#fd9038",
  green: "#0fc27b",
  "light-blue": "#17bee9",
  "dark-blue": "#266df0",
  purple: "#9162f9",
} as const;

/**
 * Editor background-color palette for light theme. Sourced from
 * `packages/editor/src/styles/variables.css` `[data-theme*="light"]`.
 */
export const EDITOR_BACKGROUND_COLORS_LIGHT = {
  gray: "#d6d6d8",
  peach: "#ffd5d7",
  pink: "#fdd4e3",
  orange: "#ffe3cd",
  green: "#c3f0de",
  "light-blue": "#c5eff9",
  "dark-blue": "#c9dafb",
  purple: "#e3d8fd",
} as const;

/**
 * Editor background-color palette for dark theme. Sourced from
 * `packages/editor/src/styles/variables.css` `[data-theme*="dark"]`.
 * Not currently selected for PDF output (PDFs default to the light palette).
 */
export const EDITOR_BACKGROUND_COLORS_DARK = {
  gray: "#404144",
  peach: "#593032",
  pink: "#562e3d",
  orange: "#583e2a",
  green: "#1d4a3b",
  "light-blue": "#1f495c",
  "dark-blue": "#223558",
  purple: "#3d325a",
} as const;

/**
 * Default editor-background palette used by PDF rendering. PDFs are
 * intentionally light-theme so they read well on paper / monochrome printers.
 */
export const EDITOR_BACKGROUND_COLORS = EDITOR_BACKGROUND_COLORS_LIGHT;

/** Union of valid editor color keys (`"gray" | "peach" | … | "purple"`). */
export type EditorColorKey = keyof typeof EDITOR_TEXT_COLORS;

/**
 * Looks up a hex text color for an editor color key (e.g., `"gray"`).
 * Returns `null` when the key is not in `EDITOR_TEXT_COLORS`.
 */
export const getTextColorHex = (colorKey: string): string | null => {
  if (colorKey in EDITOR_TEXT_COLORS) {
    return EDITOR_TEXT_COLORS[colorKey as EditorColorKey];
  }
  return null;
};

/**
 * Looks up a hex background color for an editor color key.
 * Returns `null` when the key is not in `EDITOR_BACKGROUND_COLORS`.
 */
export const getBackgroundColorHex = (colorKey: string): string | null => {
  if (colorKey in EDITOR_BACKGROUND_COLORS) {
    return EDITOR_BACKGROUND_COLORS[colorKey as EditorColorKey];
  }
  return null;
};

/**
 * `true` when the string begins with `"var("` — i.e., looks like a CSS
 * variable reference such as `"var(--editor-colors-gray-text)"`.
 */
export const isCssVariable = (value: string): boolean => {
  return value.startsWith("var(");
};

/**
 * Extracts the editor color key from a CSS variable reference of the form
 * `var(--editor-colors-<key>-{text|background})`. Returns `null` when the
 * pattern does not match.
 */
export const extractColorKeyFromCssVariable = (cssVar: string): string | null => {
  // Match patterns like: var(--editor-colors-{color}-text) or var(--editor-colors-{color}-background)
  const match = cssVar.match(/var\(--editor-colors-([\w-]+)-(text|background)\)/);
  if (match) {
    return match[1];
  }
  return null;
};

/**
 * Resolves a color string to a PDF-safe hex value.
 *
 * Resolution order:
 *  1. Literal hex (`"#..."`) → returned unchanged.
 *  2. CSS variable (`"var(--editor-colors-<key>-<type>)"`) → extracts the key
 *     and resolves to the matching `text`/`background` palette entry.
 *  3. Plain editor color key (e.g., `"gray"`) → resolves to the matching
 *     palette entry by `type`.
 *  4. Unrecognized input → returns `null` (callers must apply their own
 *     fallback).
 *
 * @param value - Raw color value from a TipTap mark or node attr.
 * @param type  - Whether to resolve against the text or background palette
 *                when the value is a CSS variable or plain key.
 */
export const resolveColorForPdf = (value: string | null | undefined, type: "text" | "background"): string | null => {
  if (!value) return null;

  // If it's already a hex color, return it
  if (value.startsWith("#")) {
    return value;
  }

  // If it's a CSS variable, extract the key and get the hex value
  if (isCssVariable(value)) {
    const colorKey = extractColorKeyFromCssVariable(value);
    if (colorKey) {
      return type === "text" ? getTextColorHex(colorKey) : getBackgroundColorHex(colorKey);
    }
  }

  // If it's just a color key (e.g., "gray", "peach"), get the hex value
  if (type === "text") {
    return getTextColorHex(value);
  }
  return getBackgroundColorHex(value);
};

/**
 * Plane semantic color tokens (light theme).
 *
 * Derived from `packages/tailwind-config/variables.css`. Grouped by role
 * (`NEUTRAL_COLORS`, `BRAND_COLORS`, `TEXT_COLORS`, `BACKGROUND_COLORS`,
 * `BORDER_COLORS`, `CODE_COLORS`, `LINK_COLORS`, `MENTION_COLORS`,
 * `SUCCESS_COLORS`, `WARNING_COLORS`, `DANGER_COLORS`) so that
 * `./styles.ts` reads natural language tokens instead of raw hex.
 * Keep in sync when the tailwind config palette changes.
 */

/** Neutral gray scale (light theme). `100` = lightest, `1200` = darkest. */
export const NEUTRAL_COLORS = {
  white: "#ffffff",
  100: "#fafafa", // oklch(0.9848 0.0003 230.66) ≈ #fafafa
  200: "#f5f5f5", // oklch(0.9696 0.0007 230.67) ≈ #f5f5f5
  300: "#f0f0f0", // oklch(0.9543 0.001 230.67) ≈ #f0f0f0
  400: "#ebebeb", // oklch(0.9389 0.0014 230.68) ≈ #ebebeb
  500: "#e5e5e5", // oklch(0.9235 0.001733 230.6853) ≈ #e5e5e5
  600: "#d9d9d9", // oklch(0.8925 0.0024 230.7) ≈ #d9d9d9
  700: "#cccccc", // oklch(0.8612 0.0032 230.71) ≈ #cccccc
  800: "#8c8c8c", // oklch(0.6668 0.0079 230.82) ≈ #8c8c8c
  900: "#7a7a7a", // oklch(0.6161 0.009153 230.867) ≈ #7a7a7a
  1000: "#636363", // oklch(0.5288 0.0083 230.88) ≈ #636363
  1100: "#4d4d4d", // oklch(0.4377 0.0066 230.87) ≈ #4d4d4d
  1200: "#1f1f1f", // oklch(0.2378 0.0029 230.83) ≈ #1f1f1f
  black: "#0f0f0f", // oklch(0.1472 0.0034 230.83) ≈ #0f0f0f
} as const;

/** Plane brand blue scale. `default` is the primary accent (`--brand-default`). */
export const BRAND_COLORS = {
  default: "#3f76ff", // oklch(0.4799 0.1158 242.91) - primary accent blue
  100: "#f5f8ff",
  200: "#e8f0ff",
  300: "#d1e1ff",
  400: "#b3d0ff",
  500: "#8ab8ff",
  600: "#5c9aff",
  700: "#3f76ff",
  900: "#2952b3",
  1000: "#1e3d80",
  1100: "#142b5c",
  1200: "#0d1f40",
} as const;

/** Semantic text colors mapped to the `--txt-*` Plane CSS variables. */
export const TEXT_COLORS = {
  primary: NEUTRAL_COLORS[1200], // --txt-primary
  secondary: NEUTRAL_COLORS[1100], // --txt-secondary
  tertiary: NEUTRAL_COLORS[1000], // --txt-tertiary
  placeholder: NEUTRAL_COLORS[900], // --txt-placeholder
  disabled: NEUTRAL_COLORS[800], // --txt-disabled
  accentPrimary: BRAND_COLORS.default, // --txt-accent-primary
  linkPrimary: BRAND_COLORS.default, // --txt-link-primary
} as const;

/** Semantic background colors mapped to the `--bg-*` Plane CSS variables. */
export const BACKGROUND_COLORS = {
  canvas: NEUTRAL_COLORS[300], // --bg-canvas
  surface1: NEUTRAL_COLORS.white, // --bg-surface-1
  surface2: NEUTRAL_COLORS[100], // --bg-surface-2
  layer1: NEUTRAL_COLORS[200], // --bg-layer-1
  layer2: NEUTRAL_COLORS.white, // --bg-layer-2
  layer3: NEUTRAL_COLORS[300], // --bg-layer-3
  accentSubtle: "#f5f8ff", // --bg-accent-subtle (brand-100)
} as const;

/** Semantic border colors mapped to the `--border-*` Plane CSS variables. */
export const BORDER_COLORS = {
  subtle: NEUTRAL_COLORS[400], // --border-subtle
  subtle1: NEUTRAL_COLORS[500], // --border-subtle-1
  strong: NEUTRAL_COLORS[600], // --border-strong
  strong1: NEUTRAL_COLORS[700], // --border-strong-1
  accentStrong: BRAND_COLORS.default, // --border-accent-strong
} as const;

/** Inline-code background + red text and block-code text colors. */
export const CODE_COLORS = {
  background: NEUTRAL_COLORS[200], // Similar to bg-layer-1
  text: "#dc2626", // Red for inline code text (matches editor)
  blockText: NEUTRAL_COLORS[1200], // Regular text for code blocks
} as const;

/** Link text colors — `primary` for unvisited and `hover` for the dark-blue hover state. */
export const LINK_COLORS = {
  primary: BRAND_COLORS.default,
  hover: BRAND_COLORS[900],
} as const;

/**
 * Mention pill colors — accent-primary with ~20% opacity on white background,
 * brand-blue text. Matches the editor's `.mention` rendering.
 */
export const MENTION_COLORS = {
  background: "#e0e9ff", // accent-primary with ~20% opacity on white
  text: BRAND_COLORS.default,
} as const;

/** Success / positive status palette (emerald-500 primary + emerald-100 subtle). */
export const SUCCESS_COLORS = {
  primary: "#10b981",
  subtle: "#d1fae5",
} as const;

/** Warning palette (amber-500 primary + amber-100 subtle). */
export const WARNING_COLORS = {
  primary: "#f59e0b",
  subtle: "#fef3c7",
} as const;

/** Danger / error palette (red-500 primary + red-100 subtle). */
export const DANGER_COLORS = {
  primary: "#ef4444",
  subtle: "#fee2e2",
} as const;
