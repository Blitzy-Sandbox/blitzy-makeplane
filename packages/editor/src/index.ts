/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Main public barrel for the `@plane/editor` package and the canonical import
 * target for downstream consumers (apps/web, apps/space, and any other React
 * application that mounts a Plane editor).
 *
 * This barrel stabilizes the package boundary by exposing a fixed surface:
 *
 *  - Four editor component variants (`CollaborativeDocumentEditorWithRef`,
 *    `DocumentEditorWithRef`, `LiteTextEditorWithRef`,
 *    `RichTextEditorWithRef`) — see `@/components/editors`.
 *  - Common toolbar / configuration constants — `@/constants/common`.
 *  - Editor utility helpers — `@/helpers/common`.
 *  - Y.js binary update encode / decode / merge utilities —
 *    `@/helpers/yjs-utils`.
 *  - The canonical TipTap extension name registry, `CORE_EXTENSIONS` —
 *    `@/constants/extension`.
 *  - The client-editor (CE) placeholder for extensions added beyond the core
 *    set, `ADDITIONAL_EXTENSIONS` — `@/plane-editor/constants/extensions`.
 *  - All editor TypeScript types — `@/types`.
 *  - The standalone `TrailingNode` ProseMirror node used to keep an empty
 *    paragraph at the end of every document.
 *
 * @see lib.ts for the secondary barrel that exposes collaboration primitives
 *      independently of the React component surface (consumed by apps/live).
 */

// editors
/**
 * Re-export of the four editor variants exposed by `@plane/editor`:
 *
 *  - `CollaborativeDocumentEditorWithRef` — full document editor with a Y.js
 *    / Hocuspocus collaboration provider, used for collaboratively edited
 *    pages and project docs.
 *  - `DocumentEditorWithRef` — same full document surface without
 *    collaboration; used for read-only or single-user document contexts.
 *  - `LiteTextEditorWithRef` — minimal editor for short / single-line inputs
 *    such as comment fields.
 *  - `RichTextEditorWithRef` — general-purpose rich text editor for free-form
 *    content blocks.
 *
 * @see `@/components/editors` for per-component prop and ref documentation.
 */
export {
  CollaborativeDocumentEditorWithRef,
  DocumentEditorWithRef,
  LiteTextEditorWithRef,
  RichTextEditorWithRef,
} from "@/components/editors";

// constants
/**
 * Shared toolbar / configuration constants consumed by every editor variant.
 * These values are the canonical metadata for the editor's static config
 * surface.
 */
export * from "@/constants/common";

// helpers
/**
 * Editor helper modules re-exported transitively:
 *
 *  - `@/helpers/common` — asset metadata normalization, command
 *    orchestration, parsing, scroll/insertion utilities, and other editor
 *    runtime helpers.
 *  - `@/helpers/yjs-utils` — Y.js binary update encode / decode / merge
 *    helpers used to persist and rehydrate collaborative document state.
 *    Y.js applies a CRDT auto-merge (Yjs vector-clock convergence) when
 *    updates from multiple peers are folded together; see tech spec §5.2.5.4
 *    and `apps/live/src/extensions/database.ts` for the 10-second
 *    persistence debounce on the server side.
 */
export * from "@/helpers/common";
export * from "@/helpers/yjs-utils";

/**
 * Canonical name registry of every core TipTap extension wired into the Plane
 * editor. This constant is consumed by feature flags, conditional extension
 * filtering, slash-command suggestion building, and type-narrowed extension
 * lookups across `@plane/editor` and downstream apps.
 *
 * @see `@/constants/extension` for the enum definition listing each extension
 *      registered by the editor.
 */
export { CORE_EXTENSIONS } from "@/constants/extension";
/**
 * Name registry of TipTap extensions added by the client-editor (`ce/`) layer
 * beyond the core set defined in `CORE_EXTENSIONS`. Currently empty in the
 * community edition; reserved as a stable extension slot for enterprise-only
 * additions that override `ce/` with `ee/`-specific extension sets.
 *
 * @see `@/plane-editor/constants/extensions` for the current enum members.
 */
export { ADDITIONAL_EXTENSIONS } from "@/plane-editor/constants/extensions";

// types
/**
 * Public TypeScript type surface for the editor: AI prop types, asset and
 * embed contracts, collaboration session types, editor command / ref API
 * types, extension allowlists, hook prop derivations, mention search /
 * rendering types, slash-command metadata, and document collaboration event
 * payloads.
 */
export * from "@/types";

// additional exports
/**
 * Custom ProseMirror node that maintains a trailing empty paragraph at the
 * end of every document. This ensures the cursor always has a click target
 * below the last meaningful block so users can begin a new line by clicking
 * into empty space at the bottom of the editor.
 *
 * @see `./core/extensions/trailing-node` for the schema and plugin
 *      implementation.
 */
export { TrailingNode } from "./core/extensions/trailing-node";
