/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public barrel for the CE extensions composition layer.
 *
 * Re-exported modules:
 *   - `./core` — Core CE extension builders (currently empty placeholder,
 *     reserved for future CE additions). Re-exports
 *     `CoreEditorAdditionalExtensions` and `TCoreAdditionalExtensionsProps`.
 *   - `./document-extensions` — `DocumentEditorAdditionalExtensions` builder
 *     consumed by `core/hooks/use-collaborative-editor.ts` (the
 *     document/collaborative editor hook) and by
 *     `core/components/editors/document/editor.tsx` for constructing the
 *     document editor's additional extension array.
 *   - `./slash-commands` — `coreEditorAdditionalSlashCommandOptions` minimal
 *     slash-command helper that returns additional slash-command options to
 *     merge with the core slash-command extension.
 *
 * Note: `rich-text-extensions.tsx` is intentionally NOT re-exported via this
 * barrel — it is consumed directly by
 * `core/components/editors/rich-text/editor.tsx` via its own path
 * (`@/plane-editor/extensions/rich-text-extensions`).
 */

export * from "./core";
export * from "./document-extensions";
export * from "./slash-commands";
