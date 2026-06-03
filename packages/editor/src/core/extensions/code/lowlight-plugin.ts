/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Syntax-highlighting ProseMirror plugin for code blocks.
 *
 * `LowlightPlugin` walks every `codeBlock` node in the document, runs each
 * block's text content through the configured `lowlight` instance's
 * parse-tree producers (`lowlight.highlight(language, text)` when a known
 * language is specified, `lowlight.highlightAuto(text)` otherwise),
 * flattens the resulting token tree into `{ text, classes[] }` pairs, and
 * emits a `Decoration.inline` for each token range carrying the token's
 * CSS classes as the decoration's `class` attribute.
 *
 * The resulting `DecorationSet` is rendered by ProseMirror as inline
 * `<span class="...">` wrappers around the highlighted text, which the
 * editor's stylesheet styles per the highlight.js theme classes
 * (`hljs-keyword`, `hljs-string`, etc.).
 *
 * WHY this plugin is hand-rolled instead of using
 * `@tiptap/extension-code-block-lowlight`:
 *   The `registered()` helper performs a SECONDARY language-registration
 *   check against `highlight.js/lib/core` (see the direct `highlight`
 *   import below). The decoration condition in `getDecorations` is
 *   `languages.includes(language) || registered(language)`, meaning a
 *   language is treated as known if EITHER lowlight knows it OR
 *   highlight.js (the lower layer lowlight wraps) knows it. This dual
 *   check is a safety net for languages registered with highlight.js
 *   directly but not yet surfaced through lowlight's `listLanguages()` —
 *   the upstream `@tiptap/extension-code-block-lowlight` package does not
 *   implement this fallback. Owning the integration lets Plane preserve
 *   the dual-registry behavior across lowlight version upgrades.
 *
 * Composed by `./code-block-lowlight.ts`'s `CodeBlockLowlight.addProseMirrorPlugins`,
 * which instantiates this plugin with the node's `this.name`, the lowlight
 * instance from `this.options.lowlight`, and `this.options.defaultLanguage`.
 *
 * Type-weakness note: the `// TODO: check all the type errors and fix
 * them` directive below (preserved as-is) acknowledges that the
 * `lowlight: any` typing and the multiple `// @ts-expect-error` directives
 * inside the plugin's `apply` block are pre-existing weaknesses tracked
 * for a future cleanup. Per the documentation-only system boundary, these
 * are NOT addressed here.
 */

// TODO: check all the type errors and fix them

import { findChildren } from "@tiptap/core";
import type { Node as ProsemirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import highlight from "highlight.js/lib/core";

/**
 * Flattens a lowlight token tree into `{ text, classes }` pairs.
 *
 * Lowlight returns a tree of nodes shaped like `{ value: string,
 * properties: { className: string[] }, children?: Node[] }`. This function
 * recursively descends `children`, accumulating the `properties.className`
 * arrays along the path, and emits one `{ text, classes }` entry per LEAF
 * node (where `node.value` is set).
 *
 * Branch nodes contribute their `className` to the path but are not
 * themselves emitted. The trailing `.flat()` collapses one level of
 * nested arrays produced by the recursive return so the caller receives
 * a single flat list aligned with the source text order.
 */
function parseNodes(nodes: any[], className: string[] = []): { text: string; classes: string[] }[] {
  return nodes
    .map((node) => {
      const classes = [...className, ...(node.properties ? node.properties.className : [])];

      if (node.children) {
        return parseNodes(node.children, classes);
      }

      return {
        text: node.value,
        classes,
      };
    })
    .flat();
}

/**
 * Returns the top-level token nodes from a lowlight or highlight.js result.
 *
 * Lowlight v1 carried tokens on `result.value`; lowlight v2+ moved them
 * to `result.children` (hast-tree alignment). This helper normalizes
 * across versions by trying `.value` first and falling back to
 * `.children`, returning `[]` if neither is present.
 */
function getHighlightNodes(result: any) {
  // `.value` for lowlight v1, `.children` for lowlight v2
  return result.value || result.children || [];
}

/**
 * Secondary language-registration check against highlight.js.
 *
 * Returns `true` if `highlight.js/lib/core`'s `getLanguage(alias)` returns
 * truthy. Used by `getDecorations` as a fallback after the lowlight
 * `listLanguages()` check — a language may be registered with highlight.js
 * directly (e.g., via `lowlight.register(...)` which delegates to
 * highlight.js) but not yet surfaced through `lowlight.listLanguages()` in
 * certain timing scenarios. This dual check ensures registered languages
 * are recognized regardless of which layer they appear in first.
 */
function registered(aliasOrLanguage: string) {
  return Boolean(highlight.getLanguage(aliasOrLanguage));
}

/**
 * Computes the syntax-highlighting `DecorationSet` for the entire document.
 *
 * For each code-block node found via `findChildren(doc, type === name)`:
 *   1. Resolve the language as `node.attrs.language || defaultLanguage`.
 *   2. If the resolved language is registered (lowlight `listLanguages()`
 *      OR highlight.js `getLanguage()` via `registered()`), call
 *      `lowlight.highlight(language, node.textContent)`. Otherwise call
 *      `lowlight.highlightAuto(node.textContent)` — lowlight's auto-detect
 *      heuristic picks the best-matching language.
 *   3. Flatten the resulting token tree with `parseNodes` and emit one
 *      `Decoration.inline(from, to, { class })` per token range with
 *      non-empty classes.
 *
 * The `from` cursor starts at `block.pos + 1` (skipping the opening
 * `<codeBlock>` boundary — a ProseMirror node occupies one position for
 * its opening and one for its closing) and advances by each token's
 * `text.length` so decoration ranges align exactly with the underlying
 * text positions.
 *
 * Returns a `DecorationSet.create(doc, decorations)` — ProseMirror renders
 * decorations as inline `<span class="...">` wrappers around the
 * highlighted ranges, styled by the editor's highlight.js-compatible theme.
 *
 * Note: only the code-block node type is walked; inline code marks are
 * handled separately by the inline-code mark's own renderer.
 */
function getDecorations({
  doc,
  name,
  lowlight,
  defaultLanguage,
}: {
  doc: ProsemirrorNode;
  name: string;
  lowlight: any;
  defaultLanguage: string | null | undefined;
}) {
  const decorations: Decoration[] = [];

  findChildren(doc, (node) => node.type.name === name).forEach((block) => {
    let from = block.pos + 1;
    const language = block.node.attrs.language || defaultLanguage;
    const languages = lowlight.listLanguages();

    const nodes =
      language && (languages.includes(language) || registered(language))
        ? getHighlightNodes(lowlight.highlight(language, block.node.textContent))
        : getHighlightNodes(lowlight.highlightAuto(block.node.textContent));

    parseNodes(nodes).forEach((node) => {
      const to = from + node.text.length;

      if (node.classes.length) {
        const decoration = Decoration.inline(from, to, {
          class: node.classes.join(" "),
        });

        decorations.push(decoration);
      }

      from = to;
    });
  });

  return DecorationSet.create(doc, decorations);
}

/** Type-guard helper used to validate the lowlight instance's API surface. */
function isFunction(param: () => any) {
  return typeof param === "function";
}

/**
 * Builds the syntax-highlighting ProseMirror plugin for code blocks.
 *
 * Input:
 *   - `name`: schema name of the code-block node — passed by
 *     `CodeBlockLowlight.addProseMirrorPlugins` as `this.name`, resolving
 *     to `CORE_EXTENSIONS.CODE_BLOCK` (= `"codeBlock"`).
 *   - `lowlight`: a configured lowlight instance — validated at call time
 *     to expose `highlight`, `highlightAuto`, and `listLanguages` (throws
 *     `"You should provide an instance of lowlight..."` otherwise).
 *   - `defaultLanguage`: fallback language string applied to code blocks
 *     with no explicit `language` attribute; `lowlight.highlightAuto`
 *     runs when this default isn't registered.
 *
 * Plugin state contract (keyed `new PluginKey("lowlight")`):
 *   - `init(_, { doc })`: builds the initial `DecorationSet` for the doc
 *     via `getDecorations(...)`.
 *   - `apply(transaction, decorationSet, oldState, newState)`: recomputes
 *     the `DecorationSet` only when `transaction.docChanged` AND any of
 *     three triggers fire:
 *       1. Selection's parent node type (old OR new) IS the code-block
 *          type — cursor entered or left a code block.
 *       2. The number of code-block nodes in the doc changed — block
 *          added or removed.
 *       3. A transaction step's `[from, to]` range fully encapsulates an
 *          existing code-block node — covers full-document replacement
 *          transactions (e.g., collaboration sync via `y-prosemirror`,
 *          where the entire document may be replaced in one step).
 *     Otherwise the existing `decorationSet` is mapped through the
 *     transaction (`decorationSet.map(transaction.mapping, transaction.doc)`),
 *     preserving position adjustments without a full recompute — the
 *     common-case optimization for typing inside non-code paragraphs.
 *   - `props.decorations(state)`: returns the cached `DecorationSet` from
 *     plugin state for ProseMirror to render.
 *
 * WHY trigger #3 matters: without it, code blocks arriving via Y.js
 * collaboration sync would render with stale or missing syntax
 * highlighting because neither trigger #1 (selection change) nor #2
 * (node-count change) fires when a sync transaction replaces the
 * document in a single large step. The comment inside the `apply`
 * block (`// Such transactions can happen during collab syncing via
 * y-prosemirror, for example.`) confirms this intent.
 *
 * Output:
 *   - `Plugin` instance — registered by
 *     `CodeBlockLowlight.addProseMirrorPlugins` in
 *     `./code-block-lowlight.ts`. ProseMirror renders the
 *     `DecorationSet` returned by `props.decorations` as inline
 *     `<span class="...">` wrappers around highlighted token ranges,
 *     styled by the editor's highlight.js-compatible theme.
 *
 * @throws Error when the supplied `lowlight` instance is missing any of
 *   the required `highlight`, `highlightAuto`, or `listLanguages` methods.
 */
export function LowlightPlugin({
  name,
  lowlight,
  defaultLanguage,
}: {
  name: string;
  lowlight: any;
  defaultLanguage: string | null | undefined;
}) {
  if (!["highlight", "highlightAuto", "listLanguages"].every((api) => isFunction(lowlight[api]))) {
    throw Error("You should provide an instance of lowlight to use the code-block-lowlight extension");
  }

  const lowlightPlugin: Plugin = new Plugin({
    key: new PluginKey("lowlight"),

    state: {
      init: (_, { doc }) =>
        getDecorations({
          doc,
          name,
          lowlight,
          defaultLanguage,
        }),
      apply: (transaction, decorationSet, oldState, newState) => {
        const oldNodeName = oldState.selection.$head.parent.type.name;
        const newNodeName = newState.selection.$head.parent.type.name;
        const oldNodes = findChildren(oldState.doc, (node) => node.type.name === name);
        const newNodes = findChildren(newState.doc, (node) => node.type.name === name);

        if (
          transaction.docChanged &&
          // Apply decorations if:
          // selection includes named node,
          ([oldNodeName, newNodeName].includes(name) ||
            // OR transaction adds/removes named node,
            newNodes.length !== oldNodes.length ||
            // OR transaction has changes that completely encapsulate a node
            // (for example, a transaction that affects the entire document).
            // Such transactions can happen during collab syncing via y-prosemirror, for example.
            transaction.steps.some(
              (step) =>
                // @ts-expect-error type error
                step.from !== undefined &&
                // @ts-expect-error type error
                step.to !== undefined &&
                oldNodes.some(
                  (node) =>
                    // @ts-expect-error type error
                    node.pos >= step.from &&
                    // @ts-expect-error type error
                    node.pos + node.node.nodeSize <= step.to
                )
            ))
        ) {
          return getDecorations({
            doc: transaction.doc,
            name,
            lowlight,
            defaultLanguage,
          });
        }

        return decorationSet.map(transaction.mapping, transaction.doc);
      },
    },

    props: {
      decorations(state) {
        return lowlightPlugin.getState(state);
      },
    },
  });

  return lowlightPlugin;
}
