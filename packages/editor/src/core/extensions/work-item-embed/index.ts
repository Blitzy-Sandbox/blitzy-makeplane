/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Public barrel export for the work-item-embed editor extension.
 *
 * Re-exports the runtime React-NodeView factory `WorkItemEmbedExtension`
 * from `./extension`, giving consumers a stable directory-level import
 * (e.g. `import { WorkItemEmbedExtension } from ".../work-item-embed"`)
 * decoupled from the internal file layout of the folder.
 *
 * The folder's other modules are intentionally NOT re-exported here:
 *   - `./extension-config` exposes the schema-only `WorkItemEmbedExtensionConfig`,
 *     which non-React render paths (Y.Doc binary → HTML/JSON conversion in
 *     `@/core/helpers/yjs-utils`, the PDF export pipeline backing
 *     `apps/live`, and the API backend's HTML round-trip of
 *     `Page.description_html`) must consume WITHOUT pulling in the React
 *     runtime — so `@/core/extensions/core-without-props` imports that
 *     config directly via its sibling relative path.
 *   - `./types` (`EWorkItemEmbedAttributeNames`, `TWorkItemEmbedAttributes`)
 *     is a folder-local attribute vocabulary shared between
 *     `./extension-config` and `./extension`; it has no callers outside
 *     this folder and therefore is not part of the package's public surface.
 *
 * This is a first-party custom ProseMirror node created via `Node.create(...)`
 * (see `./extension-config`), NOT a wrapper around an upstream
 * `@tiptap/extension-*` package — so the "Exposes / Overrides / Hides"
 * triplet conventional for TipTap-wrapper modules does not apply here.
 *
 * The node identifier is `CORE_EXTENSIONS.WORK_ITEM_EMBED`
 * (= `"issue-embed-component"`, declared in `@/core/constants/extension`),
 * which keeps the registered ProseMirror node name in sync with the
 * editor's central extension registry.
 */
export * from "./extension";
