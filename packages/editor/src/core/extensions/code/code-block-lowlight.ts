/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Composition wrapper combining the base `CodeBlock` extension with the
 * `LowlightPlugin` syntax-highlight decoration plugin to produce the
 * full lowlight-enabled code-block extension.
 *
 * This is the wrapper layer of the editor's code-block stack. The
 * interactive `CustomCodeBlockExtension` (`./index.tsx`) and the
 * non-interactive `CustomCodeBlockExtensionWithoutProps`
 * (`./without-props.tsx`) both extend `CodeBlockLowlight` further to
 * add their respective node-view and keyboard-shortcut layers on top.
 *
 * First-party note (per `@plane/editor` architectural context — TipTap
 * wrapper is treated as first-party code):
 *   Plane does NOT depend on the upstream
 *   `@tiptap/extension-code-block-lowlight` package. The composition is
 *   done here against Plane's OWN `./code-block.ts` (which itself does
 *   not depend on `@tiptap/extension-code-block`). This is why the next
 *   line carries a commented-out import showing the original upstream
 *   path — it documents the deliberate replacement of upstream
 *   code-block semantics with Plane's first-party implementation (whose
 *   VS Code clipboard paste handler, Backspace-at-start clear,
 *   triple-Enter exit, and tilde/backtick input rules are not provided
 *   by the upstream extension).
 */

// import CodeBlock, { CodeBlockOptions } from "@tiptap/extension-code-block";

import type { CodeBlockOptions } from "./code-block";
import { CodeBlock } from "./code-block";
import { LowlightPlugin } from "./lowlight-plugin";

/**
 * Options for {@link CodeBlockLowlight}.
 *
 * Extends `CodeBlockOptions` (from `./code-block.ts`) with two
 * lowlight-specific fields:
 *
 * - `lowlight`: a configured lowlight instance (typically produced by
 *   `createLowlight(common)` from `lowlight` v3.0.0). Typed as `any`
 *   because the lowlight v3 API surface is not strongly typed by the
 *   library; the runtime contract is enforced by the
 *   `["highlight", "highlightAuto", "listLanguages"]` membership check
 *   in `LowlightPlugin` (`./lowlight-plugin.ts`). The pre-existing
 *   `// TODO: check all the type errors and fix them` directive in
 *   `./lowlight-plugin.ts` tracks this known type weakness.
 * - `defaultLanguage`: fallback language passed to `LowlightPlugin`
 *   when a code block carries no explicit `language` attribute. Set
 *   to `"plaintext"` by the consumers (`./index.tsx` and
 *   `./without-props.tsx`).
 */
type CodeBlockLowlightOptions = CodeBlockOptions & {
  lowlight: any;
  defaultLanguage: string | null | undefined;
};

/**
 * Composes the base `CodeBlock` extension (`./code-block.ts`) with the
 * `LowlightPlugin` syntax-highlight decoration plugin
 * (`./lowlight-plugin.ts`) into a single TipTap extension with
 * cascaded options.
 *
 * Exposes (from `lowlight` v3.0.0):
 *   - `lowlight.highlight(language, text)` and
 *     `lowlight.highlightAuto(text)` parse-tree-producing APIs, applied
 *     to code-block text content by `LowlightPlugin` and rendered as
 *     ProseMirror `Decoration.inline` ranges (one decoration per
 *     highlighted token), surfaced in the DOM as inline `<span>`
 *     wrappers carrying highlight.js theme classes (`hljs-keyword`,
 *     `hljs-string`, etc.).
 *   - `lowlight.listLanguages()` for the language-registered check
 *     that `LowlightPlugin.getDecorations` runs before falling back
 *     to the direct `highlight.js` `getLanguage()` check.
 *   - ALL languages registered on the supplied lowlight instance —
 *     interactive consumers (`./index.tsx`, `./without-props.tsx`)
 *     register the `common` bundle plus TypeScript explicitly; callers
 *     passing a different lowlight instance can extend or narrow the
 *     language set.
 *
 * Exposes (from base `CodeBlock` in `./code-block.ts`):
 *   - Schema: `block` group, `text*` content, `code: true` atomic,
 *     `language` attribute parsed from a `class="language-foo"` prefix.
 *   - Commands: `setCodeBlock`, `toggleCodeBlock`.
 *   - Input rules: ` ``` ` and `~~~` fences with an optional trailing
 *     language tag.
 *   - Keyboard shortcuts: `Mod-Alt-c` toggle, `Backspace`-at-start
 *     clears the code block, triple-`Enter` exit on empty trailing
 *     line, `ArrowDown` exit at last position.
 *   - VS Code clipboard paste handler (extracts language from the
 *     `vscode-editor-data` JSON payload set on copy from VS Code).
 *   - Default options cascaded from the base: `languageClassPrefix:
 *     "language-"`, `exitOnTripleEnter: true` (overridden downstream
 *     to `false` by `./index.tsx`), `exitOnArrowDown: true`,
 *     `HTMLAttributes: {}`.
 *   - New options added on top: `lowlight: {}` (placeholder; must be
 *     replaced via `.configure({ lowlight })` by the consumer) and
 *     `defaultLanguage: null` (overridden to `"plaintext"` by
 *     consumers).
 *
 * Overrides:
 *   - `addOptions()`: extends the parent options with `lowlight: {}`
 *     and `defaultLanguage: null` defaults. The
 *     `this.parent?.() ?? { ... }` inline fallback object guards
 *     against TipTap internal calls where the parent options getter
 *     may return `undefined`; the fallback mirrors the four base
 *     defaults (`languageClassPrefix`, `exitOnTripleEnter`,
 *     `exitOnArrowDown`, `HTMLAttributes`) so the extension stays
 *     operable during introspection even when no parent options are
 *     resolved.
 *   - `addProseMirrorPlugins()`: appends
 *     `LowlightPlugin({ name, lowlight, defaultLanguage })` AFTER the
 *     parent's plugin array (which carries the base `CodeBlock`'s VS
 *     Code paste handler). Decoration plugins are render-only and do
 *     not intercept transactions, so this ordering does not affect
 *     paste behavior.
 *
 * Hides:
 *   - `@tiptap/extension-code-block-lowlight` (upstream package) is
 *     NOT used — the commented-out import near the top of this file
 *     documents the deliberate replacement. Plane's base `CodeBlock`
 *     adds the VS Code clipboard handler, the Backspace-at-start
 *     clear, the configurable triple-Enter exit, and the tilde fence
 *     input rule; the upstream package does not provide these.
 *   - From `lowlight` v3.0.0: APIs beyond `highlight` / `highlightAuto`
 *     / `listLanguages` (e.g., `registerAlias`, `registered`, custom
 *     hast transformations) are not exposed through this wrapper.
 *   - Upstream `@tiptap/extension-code-block-lowlight` options (e.g.,
 *     a `lowlightOptions` plumbing hook, if present in that package)
 *     are not surfaced here; only `lowlight` and `defaultLanguage`
 *     are added on top of `CodeBlockOptions`.
 *
 * Composition stack (most-specific layer on top):
 *   `./code-block.ts`         — base TipTap node
 *   `./lowlight-plugin.ts`    — syntax-highlight decoration plugin
 *   THIS FILE                 — composes the two with cascaded options
 *   `./index.tsx`             — interactive variant (React node view,
 *                               Tab/ArrowUp/ArrowDown overrides,
 *                               `.configure({ lowlight, defaultLanguage:
 *                               "plaintext", ... })`)
 *   `./without-props.tsx`     — parallel non-interactive variant
 *                               (schema-only, no React node view)
 */
export const CodeBlockLowlight = CodeBlock.extend<CodeBlockLowlightOptions>({
  addOptions() {
    return {
      ...(this.parent?.() ?? {
        languageClassPrefix: "language-",
        exitOnTripleEnter: true,
        exitOnArrowDown: true,
        HTMLAttributes: {},
      }),
      lowlight: {},
      defaultLanguage: null,
    };
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() || []),
      LowlightPlugin({
        name: this.name,
        lowlight: this.options.lowlight,
        defaultLanguage: this.options.defaultLanguage,
      }),
    ];
  },
});
