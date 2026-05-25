/**
 * Custom typography extension entry point for the Plane editor.
 *
 * Composes the 19 typographic shortcut input rules defined in
 * `./inputRules` into a single TipTap `Extension` so that ASCII
 * sequences such as `--`, `...`, `(c)`, `1/2`, and `^2` auto-replace
 * with their Unicode equivalents (`—`, `…`, `©`, `½`, `²`) as the user
 * types.
 */
import type { InputRule } from "@tiptap/core";
import { Extension } from "@tiptap/core";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
import type { TypographyOptions } from "./inputRules";
import {
  emDash,
  ellipsis,
  leftArrow,
  rightArrow,
  copyright,
  trademark,
  servicemark,
  registeredTrademark,
  oneHalf,
  plusMinus,
  notEqual,
  laquo,
  raquo,
  multiplication,
  superscriptTwo,
  superscriptThree,
  oneQuarter,
  threeQuarters,
  impliesArrowRight,
} from "./inputRules";

/**
 * Plane editor typography extension — registers ASCII-to-Unicode input rules.
 *
 * First-party origin:
 *   This is NOT a wrapper of `@tiptap/extension-typography` (which is
 *   intentionally not a dependency of `@plane/editor`). The rule set is
 *   defined from scratch in `./inputRules` using `@tiptap/core`'s
 *   `textInputRule()` primitive, giving Plane direct control over the
 *   regex triggers, default glyphs, and opt-out shape declared by
 *   `TypographyOptions`.
 *
 * Input rules (registration order, all enabled by default):
 *   1. `emDash` — `--` → `—` (em dash, U+2014)
 *   2. `impliesArrowRight` — `=>` → `⇒` (rightwards double arrow, U+21D2)
 *   3. `ellipsis` — `...` → `…` (horizontal ellipsis, U+2026)
 *   4. `leftArrow` — `<-` → `←` (leftwards arrow, U+2190)
 *   5. `rightArrow` — `->` → `→` (rightwards arrow, U+2192)
 *   6. `copyright` — `(c)` → `©` (copyright sign, U+00A9)
 *   7. `trademark` — `(tm)` → `™` (trade mark sign, U+2122)
 *   8. `servicemark` — `(sm)` → `℠` (service mark, U+2120)
 *   9. `registeredTrademark` — `(r)` → `®` (registered sign, U+00AE)
 *  10. `oneHalf` — `1/2` (whitespace-anchored) → `½` (one half, U+00BD)
 *  11. `plusMinus` — `+/-` → `±` (plus-minus sign, U+00B1)
 *  12. `notEqual` — `!=` → `≠` (not equal to, U+2260)
 *  13. `laquo` — `<<` → `«` (left guillemet, U+00AB)
 *  14. `raquo` — `>>` → `»` (right guillemet, U+00BB)
 *  15. `multiplication` — `<n>{*|x}<n>` → `×` (multiplication sign, U+00D7)
 *  16. `superscriptTwo` — `^2` → `²` (superscript two, U+00B2)
 *  17. `superscriptThree` — `^3` → `³` (superscript three, U+00B3)
 *  18. `oneQuarter` — `1/4` (whitespace-anchored) → `¼` (one quarter, U+00BC)
 *  19. `threeQuarters` — `3/4` (whitespace-anchored) → `¾` (three quarters, U+00BE)
 *
 * Opt-out semantics: setting any `TypographyOptions[key]` to strictly
 * `false` skips that rule's registration. A non-`false` string overrides
 * the default Unicode glyph (the rule still registers, but emits the
 * caller-supplied replacement). Any other value (including `undefined`)
 * uses the factory's built-in default.
 *
 * Extension name: `CORE_EXTENSIONS.TYPOGRAPHY` (resolves to `"typography"`),
 * imported from `@/constants/extension`.
 *
 * Consumer: composed into the interactive editor stack by
 * `core/extensions/extensions.ts`. Intentionally absent from
 * `core/extensions/core-without-props.ts` because typography rules are
 * only meaningful in interactive editing contexts.
 */
export const CustomTypographyExtension = Extension.create<TypographyOptions>({
  name: CORE_EXTENSIONS.TYPOGRAPHY,

  addInputRules() {
    const rules: InputRule[] = [];

    if (this.options.emDash !== false) {
      rules.push(emDash(this.options.emDash));
    }

    if (this.options.impliesArrowRight !== false) {
      rules.push(impliesArrowRight(this.options.impliesArrowRight));
    }

    if (this.options.ellipsis !== false) {
      rules.push(ellipsis(this.options.ellipsis));
    }

    if (this.options.leftArrow !== false) {
      rules.push(leftArrow(this.options.leftArrow));
    }

    if (this.options.rightArrow !== false) {
      rules.push(rightArrow(this.options.rightArrow));
    }

    if (this.options.copyright !== false) {
      rules.push(copyright(this.options.copyright));
    }

    if (this.options.trademark !== false) {
      rules.push(trademark(this.options.trademark));
    }

    if (this.options.servicemark !== false) {
      rules.push(servicemark(this.options.servicemark));
    }

    if (this.options.registeredTrademark !== false) {
      rules.push(registeredTrademark(this.options.registeredTrademark));
    }

    if (this.options.oneHalf !== false) {
      rules.push(oneHalf(this.options.oneHalf));
    }

    if (this.options.plusMinus !== false) {
      rules.push(plusMinus(this.options.plusMinus));
    }

    if (this.options.notEqual !== false) {
      rules.push(notEqual(this.options.notEqual));
    }

    if (this.options.laquo !== false) {
      rules.push(laquo(this.options.laquo));
    }

    if (this.options.raquo !== false) {
      rules.push(raquo(this.options.raquo));
    }

    if (this.options.multiplication !== false) {
      rules.push(multiplication(this.options.multiplication));
    }

    if (this.options.superscriptTwo !== false) {
      rules.push(superscriptTwo(this.options.superscriptTwo));
    }

    if (this.options.superscriptThree !== false) {
      rules.push(superscriptThree(this.options.superscriptThree));
    }

    if (this.options.oneQuarter !== false) {
      rules.push(oneQuarter(this.options.oneQuarter));
    }

    if (this.options.threeQuarters !== false) {
      rules.push(threeQuarters(this.options.threeQuarters));
    }

    return rules;
  },
});
