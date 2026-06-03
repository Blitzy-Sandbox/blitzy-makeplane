/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Type surface for the code-block extension's runtime attributes.
 *
 * Exports the canonical names of attributes attached to a `codeBlock`
 * ProseMirror node ({@link ECodeBlockAttributeNames}) and the shape
 * of those attributes as TypeScript ({@link TCodeBlockAttributes}).
 *
 * Supported-languages enumeration is NOT defined here. The set of
 * recognized `language` values is produced at runtime by the
 * `lowlight` v3.0.0 instance configured in `./index.tsx` and
 * `./without-props.tsx`:
 *
 *   1. The base set is the `common` bundle exported by lowlight v3
 *      and passed to `createLowlight(common)` in `./index.tsx`
 *      (line 15) and `./without-props.tsx` (line 13). This is
 *      lowlight's default "common languages" bundle (JavaScript,
 *      Python, Java, Bash, HTML, CSS, JSON, etc. — see lowlight's
 *      documentation for the exact list at the pinned version).
 *   2. TypeScript is explicitly registered on top of the common
 *      bundle via `lowlight.register("ts", ts)` in `./index.tsx`
 *      (line 16) and `./without-props.tsx` (line 14), where `ts` is
 *      imported from `highlight.js/lib/languages/typescript`. The
 *      common bundle includes JavaScript but NOT TypeScript — this
 *      explicit registration is a deliberate Plane language-coverage
 *      decision.
 *
 * The lowlight + highlight.js dual-registry check in
 * `./lowlight-plugin.ts`'s `getDecorations` (line 60:
 * `languages.includes(language) || registered(language)`) means an
 * attribute `language` value is accepted by the highlighter if
 * EITHER lowlight (`lowlight.listLanguages()`) OR highlight.js
 * (`highlight.getLanguage()`) recognizes it. Unknown or null
 * languages fall through to `lowlight.highlightAuto` (line 62 of the
 * same file).
 *
 * Consumed by `./code-block-node-view.tsx` (reads `node.attrs` as
 * {@link TCodeBlockAttributes} and uses
 * {@link ECodeBlockAttributeNames.ID} as the React `key` on the
 * `NodeViewWrapper`), `./code-block.ts` (declares the
 * `language` schema attribute in `addAttributes()` matching
 * {@link ECodeBlockAttributeNames.LANGUAGE}), and
 * `./lowlight-plugin.ts` (reads `node.attrs.language` to choose a
 * syntax-highlighting strategy).
 */

/**
 * Canonical names of the attributes attached to a `codeBlock` node.
 *
 * The `E`-prefix follows the `@plane/types` enum convention. Using
 * an enum (rather than string literals scattered through the
 * codebase) ensures that schema attribute names, ProseMirror
 * `node.attrs` access, and TypeScript type indexing all reference
 * the same source of truth.
 *
 * Members:
 *   - `ID = "id"`: a stable identifier for the code block, used by
 *     downstream tooling that needs to address individual blocks
 *     across edits. Currently consumed in
 *     `./code-block-node-view.tsx` as the React `key` for the
 *     `NodeViewWrapper` element (line 48). Note: this attribute is
 *     not declared in `./code-block.ts`'s `addAttributes()` — when
 *     absent on `node.attrs`, the key resolves to `undefined`.
 *   - `LANGUAGE = "language"`: the syntax-highlighting language tag.
 *     Values are matched against the lowlight + highlight.js dual
 *     registry — see module-level docs for the language source. A
 *     `null` or unrecognized value triggers `lowlight.highlightAuto`.
 *
 * The string value `"language"` matches the ProseMirror schema
 * attribute name declared in `./code-block.ts`'s `addAttributes()`
 * (line 73 of that file) — DO NOT change without updating the
 * schema declaration in lock-step.
 */
export enum ECodeBlockAttributeNames {
  ID = "id",
  LANGUAGE = "language",
}

/**
 * Shape of the attributes carried by a `codeBlock` ProseMirror node.
 *
 * Indexed by {@link ECodeBlockAttributeNames} so a future enum
 * member addition forces a structural mismatch at every site that
 * constructs or destructures this type.
 *
 * Both fields are typed as `string | null` because the runtime
 * attribute default in `./code-block.ts` for `language` is `null`
 * (see `addAttributes()` at line 75–93 — `default: null`), and the
 * `id` attribute is not declared in the schema so it resolves to
 * `null`/`undefined` on freshly inserted blocks. Downstream
 * consumers — the node view, the lowlight plugin, the static
 * renderer — handle the nullable case by applying their own
 * defaults (`defaultLanguage` propagation through
 * `.configure({...})`, `lowlight.highlightAuto` fallback when
 * `language` is null or unrecognized).
 */
export type TCodeBlockAttributes = {
  [ECodeBlockAttributeNames.ID]: string | null;
  [ECodeBlockAttributeNames.LANGUAGE]: string | null;
};
