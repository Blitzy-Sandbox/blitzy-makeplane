/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Editor configuration type contracts shared across every editor variant
 * exposed by `@plane/editor` (collaborative document, document, rich-text,
 * lite-text). Captures:
 *   - `TFileHandler` — asset/file callback surface (upload, download, etc.).
 *   - `TEditorFontStyle` / `TEditorFontSize` / `TEditorLineSpacing` /
 *     `TDisplayConfig` — presentation preferences resolved against
 *     `DEFAULT_DISPLAY_CONFIG` (see `core/constants/config.ts`).
 *   - `TUserDetails` — identity metadata fed into the Yjs awareness
 *     protocol so collaboration cursors can be rendered for remote peers.
 *   - `TRealtimeConfig` — Hocuspocus transport coordinates.
 *   - `IMarking` — heading record emitted for table-of-contents extraction.
 *
 * Primary consumers: every editor in `core/components/editors/` (which
 * accepts these types via `IEditorProps`) and `core/constants/config.ts`
 * (which exports `DEFAULT_DISPLAY_CONFIG` typed as `TDisplayConfig`).
 */

// plane imports
import type { TExtendedFileHandler } from "@/plane-editor/types/config";

/**
 * File-handler contract supplied to every editor variant via
 * `IEditorProps.fileHandler`. Wires the editor's asset operations
 * (upload, download, delete, restore, duplicate, existence check) to
 * consumer-managed storage — the editor itself is storage-agnostic.
 *
 * Behavioral pairs worth flagging:
 *   - `delete` / `restore` — soft-delete contract. `delete` marks the
 *     asset deleted server-side (the existing URL typically remains
 *     resolvable briefly to allow undo); `restore` reverses the deletion
 *     so existing references in the document keep rendering. Callers
 *     must wire these together — calling `delete` without an undo path
 *     leaves stale references in the document.
 *   - `getAssetSrc` / `getAssetDownloadSrc` — `getAssetSrc` returns the
 *     URL used for inline rendering (e.g., `<img src>`).
 *     `getAssetDownloadSrc` returns a URL that triggers an explicit
 *     download (typically signed with `Content-Disposition: attachment`).
 *     They must not be conflated; inline rendering of the download URL
 *     causes the browser to download instead of render.
 *
 * Other notes:
 *   - `assetsUploadStatus` is keyed by `blockId` and tracks per-block
 *     upload progress percentage (see inline comment on the field).
 *   - `cancel` aborts the currently in-flight upload; consumers typically
 *     wire this to an upload `AbortController.abort()`.
 *   - `checkIfAssetExists` is invoked on document load to detect orphaned
 *     references (asset deleted out-of-band); returns `true` when the
 *     asset is still resolvable.
 *   - `upload(blockId, file)` returns the persisted asset URL and is
 *     correlated with `assetsUploadStatus` via the same `blockId`.
 *   - `duplicate(assetId)` server-side-copies an asset; invoked when an
 *     image enters the `DUPLICATING` status after pasting cross-document
 *     content so the destination document owns an independent asset
 *     (see `core/extensions/custom-image/components/node-view.tsx`).
 *
 * Intersection with `TExtendedFileHandler` (from
 * `@/plane-editor/types/config`) carries overlay-specific extensions
 * (empty in CE, populated in EE); see that module for additional fields.
 */
export type TFileHandler = {
  assetsUploadStatus: Record<string, number>; // blockId => progress percentage
  cancel: () => void;
  checkIfAssetExists: (assetId: string) => Promise<boolean>;
  delete: (assetSrc: string) => Promise<void>;
  getAssetDownloadSrc: (path: string) => Promise<string>;
  getAssetSrc: (path: string) => Promise<string>;
  restore: (assetSrc: string) => Promise<void>;
  upload: (blockId: string, file: File) => Promise<string>;
  duplicate: (assetId: string) => Promise<string>;
  validation: {
    /**
     * @description max file size in bytes
     * @example enter 5242880(5 * 1024 * 1024) for 5MB
     */
    maxFileSize: number;
  };
} & TExtendedFileHandler;

/**
 * Display-config string-literal alias for editor font family.
 *
 * Shared design note for `TEditorFontStyle`, `TEditorFontSize`, and
 * `TEditorLineSpacing`: each variant string is applied directly as a
 * CSS class name on the editor container (see
 * `core/components/editors/editor-container.tsx`), so the union narrows
 * what can be injected into the class list and prevents typos from
 * silently producing untyped classes. Update the corresponding CSS
 * (in `src/styles/`) when adding a new variant here.
 */
export type TEditorFontStyle = "sans-serif" | "serif" | "monospace";

/** Font-size variant for `TDisplayConfig.fontSize`; see `TEditorFontStyle` for group docs. */
export type TEditorFontSize = "small-font" | "large-font" | "mobile-font";

/**
 * Line-spacing variant for `TDisplayConfig.lineSpacing`; see `TEditorFontStyle`
 * for group docs. Applied as `line-spacing-${value}` (e.g. `line-spacing-small`).
 */
export type TEditorLineSpacing = "regular" | "small" | "mobile-regular";

/**
 * Editor presentation state — font style, font size, line spacing, and a
 * wide-layout toggle. Passed to editor components via `IEditorProps.displayConfig`.
 *
 * All four fields are optional because the editor falls back per-field to
 * `DEFAULT_DISPLAY_CONFIG` (exported from `core/constants/config.ts`) — a
 * partial config is therefore valid and only overrides the fields it
 * provides. `wideLayout`, when `true`, removes the max-width prose
 * constraint to render a full-width writing surface; used by the document
 * editor and intentionally not exposed by the lite-text/rich-text variants.
 */
export type TDisplayConfig = {
  fontStyle?: TEditorFontStyle;
  fontSize?: TEditorFontSize;
  lineSpacing?: TEditorLineSpacing;
  wideLayout?: boolean;
};

/**
 * User identity metadata propagated into the Yjs awareness protocol so the
 * collaboration-cursor extension can render remote peers in the document.
 *
 * Fields:
 *   - `color`  — CSS color (typically hex) used for this user's cursor
 *                caret and selection highlight on remote peers' screens.
 *   - `id`     — stable user identifier; appears on cursor hover and is
 *                used to deduplicate awareness entries.
 *   - `name`   — display name shown next to the cursor on hover.
 *   - `cookie?` — optional session cookie forwarded to `apps/live` during
 *                the Hocuspocus connection handshake. When provided it
 *                enables the cookie-based auth path on the live server
 *                (`apps/live/src/lib/auth.ts`); when omitted the
 *                connection falls back to token-based auth supplied via
 *                other props.
 */
export type TUserDetails = {
  color: string;
  id: string;
  name: string;
  cookie?: string;
};

/**
 * Realtime endpoint configuration for collaborative editing — the
 * WebSocket URL the editor connects to via the Hocuspocus client
 * (`apps/live`). Only `url` is part of this config because the document
 * name and auth token are derived from sibling `IEditorProps` (the
 * editor `id` and `TUserDetails.cookie`); the URL is the only
 * externally-configurable transport coordinate.
 */
export type TRealtimeConfig = {
  url: string;
};

/**
 * Heading marker emitted by the editor's table-of-contents extraction
 * pipeline. One `IMarking` per heading found in the document; produced by
 * the headings-list extension (`core/extensions/headings-list.ts`) and
 * surfaced through `EditorRefApi.getHeadings()` / the `onHeadingChange`
 * subscription. `scrollSummary(marking)` consumes a single marker to
 * scroll the editor to its position.
 *
 * Fields:
 *   - `type`     — discriminant for the marker kind; currently always
 *                  `"heading"`. The literal exists so consumers can
 *                  branch on `type` if additional marker kinds are added
 *                  in the future without an API break.
 *   - `level`    — heading level 1–6 (corresponds to `<h1>`–`<h6>`).
 *   - `text`     — extracted plain-text content of the heading.
 *   - `sequence` — document-order index of this heading; consumers use
 *                  it to render the TOC in source order.
 */
export type IMarking = {
  type: "heading";
  level: number;
  text: string;
  sequence: number;
};
