/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * AI menu type contracts for the `@plane/editor` AI extension surface.
 *
 * Re-exported through `packages/editor/src/index.ts` (via `export * from "@/types"`)
 * and consumed by the in-editor `AIFeaturesMenu` (see
 * `core/components/menus/ai-menu.tsx`) plus the two editor variants that accept
 * an `aiHandler` prop — `ICollaborativeDocumentEditorProps` and
 * `IDocumentEditorProps` (see `@/types/editor`).
 */

/**
 * Props forwarded by the editor to a consumer-supplied AI menu renderer.
 *
 * The editor owns the popup `isOpen` boolean and the `onClose` callback and
 * propagates them down so the consumer's menu component does not need to
 * track open/close state itself — the editor stays the single source of
 * truth for AI menu visibility, keeping it in lockstep with focus,
 * slash-menu state, and selection range.
 */
export type TAIMenuProps = {
  isOpen: boolean;
  onClose: () => void;
};

/**
 * `aiHandler` contract supplied to collaborative and document editor variants.
 *
 * The single field `menu` is optional and behaviorally discriminating: when
 * omitted the editor renders no AI surface at all, and when provided the
 * callback fully replaces the default AI menu UI with a consumer-rendered
 * React node that receives the editor-owned `TAIMenuProps`. Optionality
 * exists because most editor instances (lite text, rich text, archived
 * read-only documents) ship without an AI integration.
 */
export type TAIHandler = {
  menu?: (props: TAIMenuProps) => React.ReactNode;
};
