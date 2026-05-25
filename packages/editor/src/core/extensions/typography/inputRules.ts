/**
 * Typography input-rule catalog: configuration contract + factory functions.
 *
 * Defines `TypographyOptions` (the per-rule opt-out / override map) and 19
 * `textInputRule`-producing factories consumed by `./index.ts` to build the
 * `CustomTypographyExtension`. Each factory wraps `textInputRule()` from
 * `@tiptap/core` with a fixed trigger regex and a default Unicode
 * replacement, accepting an optional `override` string to substitute a
 * different replacement glyph.
 *
 * First-party implementation — this module does NOT wrap
 * `@tiptap/extension-typography`. The trigger regexes and replacement
 * glyphs are owned by Plane.
 */
import { textInputRule } from "@tiptap/core";

/**
 * Configuration contract for the Plane typography extension.
 *
 * Each key corresponds to one input rule registered by the
 * `CustomTypographyExtension`. The accepted values are:
 *
 *   - `false`        → skip this rule (do not register it)
 *   - `string`       → register the rule but emit this string as the
 *                      replacement instead of the factory's default glyph
 *
 * In TypeScript callers, the option is required (no `?`), but
 * `Extension.create<TypographyOptions>` allows the options to be supplied
 * at editor construction time via TipTap's options system. Any key
 * resolved to `undefined` at runtime falls back to the factory's default
 * Unicode replacement (since `override ?? <default>` short-circuits on
 * both `null` and `undefined`).
 */
export type TypographyOptions = {
  emDash: false | string;
  ellipsis: false | string;
  leftArrow: false | string;
  rightArrow: false | string;
  copyright: false | string;
  trademark: false | string;
  servicemark: false | string;
  registeredTrademark: false | string;
  oneHalf: false | string;
  plusMinus: false | string;
  notEqual: false | string;
  laquo: false | string;
  raquo: false | string;
  multiplication: false | string;
  superscriptTwo: false | string;
  superscriptThree: false | string;
  oneQuarter: false | string;
  threeQuarters: false | string;
  impliesArrowRight: false | string;
};

// ---------------------------------------------------------------------------
// Typography input-rule factories
// ---------------------------------------------------------------------------
//
// Each factory below follows the same shape:
//
//   export const <name> = (override?: string) =>
//     textInputRule({
//       find: <regex>,
//       replace: override ?? <default-glyph>,
//     });
//
// `find` is anchored at the end of the buffer (`$`) so the rule only
// triggers immediately after the user types the final character of the
// trigger sequence. `replace` uses `??` so:
//   - `override` undefined → use the default Unicode glyph
//   - `override` empty string → use empty string (deliberate caller override)
//   - `override` non-empty string → use the caller-supplied replacement
//
// The factories are consumed by `./index.ts` and registered in a fixed
// order on `addInputRules()`. The source order below differs slightly from
// the registration order in `./index.ts`; both orders are intentional and
// must not be changed.

/** `--` → `—` (em dash, U+2014). Triggers on the second `-` of a `--` sequence. */
export const emDash = (override?: string) =>
  textInputRule({
    find: /--$/,
    replace: override ?? "—",
  });

/** `=>` → `⇒` (rightwards double arrow, U+21D2). Triggers on `>` after `=`. */
export const impliesArrowRight = (override?: string) =>
  textInputRule({
    find: /=>$/,
    replace: override ?? "⇒",
  });

/** `<-` → `←` (leftwards arrow, U+2190). Triggers on `-` after `<`. */
export const leftArrow = (override?: string) =>
  textInputRule({
    find: /<-$/,
    replace: override ?? "←",
  });

/** `->` → `→` (rightwards arrow, U+2192). Triggers on `>` after `-`. */
export const rightArrow = (override?: string) =>
  textInputRule({
    find: /->$/,
    replace: override ?? "→",
  });

/** `...` → `…` (horizontal ellipsis, U+2026). Triggers on the third `.` of `...`. */
export const ellipsis = (override?: string) =>
  textInputRule({
    find: /\.\.\.$/,
    replace: override ?? "…",
  });

/** `(c)` → `©` (copyright sign, U+00A9). Triggers on the closing `)` of `(c)`. */
export const copyright = (override?: string) =>
  textInputRule({
    find: /\(c\)$/,
    replace: override ?? "©",
  });

/** `(tm)` → `™` (trade mark sign, U+2122). Triggers on the closing `)` of `(tm)`. */
export const trademark = (override?: string) =>
  textInputRule({
    find: /\(tm\)$/,
    replace: override ?? "™",
  });

/** `(sm)` → `℠` (service mark sign, U+2120). Triggers on the closing `)` of `(sm)`. */
export const servicemark = (override?: string) =>
  textInputRule({
    find: /\(sm\)$/,
    replace: override ?? "℠",
  });

/** `(r)` → `®` (registered sign, U+00AE). Triggers on the closing `)` of `(r)`. */
export const registeredTrademark = (override?: string) =>
  textInputRule({
    find: /\(r\)$/,
    replace: override ?? "®",
  });

/**
 * `1/2` → `½` (vulgar fraction one half, U+00BD). Whitespace-anchored:
 * the `1/2` must be preceded by start-of-string or whitespace AND followed
 * by a space, so substrings inside identifiers (e.g., `var1/2name`) do not
 * trigger.
 */
export const oneHalf = (override?: string) =>
  textInputRule({
    find: /(?:^|\s)(1\/2)\s$/,
    replace: override ?? "½",
  });

/** `+/-` → `±` (plus-minus sign, U+00B1). Triggers on the final `-` of `+/-`. */
export const plusMinus = (override?: string) =>
  textInputRule({
    find: /\+\/-$/,
    replace: override ?? "±",
  });

/** `!=` → `≠` (not equal to, U+2260). Triggers on `=` after `!`. */
export const notEqual = (override?: string) =>
  textInputRule({
    find: /!=$/,
    replace: override ?? "≠",
  });

/** `<<` → `«` (left-pointing double angle quotation mark, U+00AB). Triggers on second `<`. */
export const laquo = (override?: string) =>
  textInputRule({
    find: /<<$/,
    replace: override ?? "«",
  });

/** `>>` → `»` (right-pointing double angle quotation mark, U+00BB). Triggers on second `>`. */
export const raquo = (override?: string) =>
  textInputRule({
    find: />>$/,
    replace: override ?? "»",
  });

/**
 * `<n>*<n>` or `<n>x<n>` → `×` (multiplication sign, U+00D7). Matches one
 * or more digits, optional space, `*` OR `x`, optional space, one or more
 * digits. The capture group is preserved by the regex but not used in the
 * replacement (the entire match is substituted).
 */
export const multiplication = (override?: string) =>
  textInputRule({
    find: /\d+\s?([*x])\s?\d+$/,
    replace: override ?? "×",
  });

/** `^2` → `²` (superscript two, U+00B2). Triggers on `2` after `^`. */
export const superscriptTwo = (override?: string) =>
  textInputRule({
    find: /\^2$/,
    replace: override ?? "²",
  });

/** `^3` → `³` (superscript three, U+00B3). Triggers on `3` after `^`. */
export const superscriptThree = (override?: string) =>
  textInputRule({
    find: /\^3$/,
    replace: override ?? "³",
  });

/**
 * `1/4` → `¼` (vulgar fraction one quarter, U+00BC). Whitespace-anchored
 * (start-of-string or whitespace before; space after) to avoid matching
 * inside identifiers — same pattern as `oneHalf`.
 */
export const oneQuarter = (override?: string) =>
  textInputRule({
    find: /(?:^|\s)(1\/4)\s$/,
    replace: override ?? "¼",
  });

/**
 * `3/4` → `¾` (vulgar fraction three quarters, U+00BE). Whitespace-anchored
 * (start-of-string or whitespace before; space after) to avoid matching
 * inside identifiers — same pattern as `oneHalf`.
 */
export const threeQuarters = (override?: string) =>
  textInputRule({
    find: /(?:^|\s)(3\/4)\s$/,
    replace: override ?? "¾",
  });
