/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * String-literal union of user-facing editor extension names that consumers can
 * toggle on/off via the `disabledExtensions` and `flaggedExtensions` props on
 * `@plane/editor` editor components. Re-exported as part of the package's
 * public type surface through `src/index.ts` via `* from "@/types"`.
 */

/**
 * Allowlist of editor extension names accepted by `IEditorProps.disabledExtensions`
 * and `IEditorProps.flaggedExtensions` (see `core/types/editor.ts` lines 160 and 165).
 *
 * Constrained to a string-literal union so callers receive IDE autocomplete and
 * TypeScript rejects typos when toggling extension surfaces at editor
 * instantiation time — e.g., passing `disabledExtensions={["ai"]}` strips the AI
 * extension wiring without any runtime string-comparison risk.
 *
 * Relationship to `CORE_EXTENSIONS` in `core/constants/extension.ts`: the values
 * here are coarse user-facing toggles, while `CORE_EXTENSIONS` enumerates the
 * internal TipTap extension identifiers. A single toggle may map to multiple
 * internal extensions — e.g., `"image"` disables both `IMAGE` and `CUSTOM_IMAGE`
 * (see `core/extensions/extensions.ts` line 143).
 */
export type TExtensions = "ai" | "collaboration-cursor" | "issue-embed" | "slash-commands" | "enter-key" | "image";
