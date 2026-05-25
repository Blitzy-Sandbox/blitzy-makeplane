/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Foundational TipTap-wrapper type contracts for `@plane/editor`.
 *
 * Models the command catalog (`TEditorCommands`), command extra-props
 * (`TCommandExtraProps`), the imperative ref API (`EditorRefApi`), the four
 * editor variant prop interfaces (`IEditorProps` → lite/rich/document/
 * collaborative document), and editor lifecycle event types (`EditorEvents`).
 *
 * This file is the broadest contract in `core/types/` — `EditorRefApi` and
 * the four editor prop interfaces are the foundational API consumed by every
 * editor wrapper component in `core/components/editors/` (`RichTextEditorWithRef`,
 * `LiteTextEditorWithRef`, `DocumentEditorWithRef`,
 * `CollaborativeDocumentEditorWithRef`) and every editor hook in
 * `core/hooks/` (e.g., `use-editor.ts`, `use-collaborative-editor.ts`,
 * `use-title-editor.ts`). Downstream type contracts in `hook.ts` derive their
 * shapes from the prop interfaces here via `Pick` + intersection to prevent
 * drift between component props and hook props.
 */

import type { Content, Extensions, JSONContent, RawCommands } from "@tiptap/core";
import type { MarkType, NodeType } from "@tiptap/pm/model";
import type { Selection } from "@tiptap/pm/state";
import type { EditorProps, EditorView } from "@tiptap/pm/view";
import type { NodeViewProps as TNodeViewProps } from "@tiptap/react";
// plane imports
import type { TCustomComponentsMetaData } from "@plane/utils";
// extension types
import type { TTextAlign } from "@/extensions";
// plane editor imports
import type {
  IEditorPropsExtended,
  TExtendedEditorCommands,
  ICollaborativeDocumentEditorPropsExtended,
} from "@/plane-editor/types/editor-extended";
// types
import type {
  IMarking,
  TAIHandler,
  TDisplayConfig,
  TDocumentEventEmitter,
  TDocumentEventsServer,
  TEditorAsset,
  TExtensions,
  TFileHandler,
  TMentionHandler,
  TRealtimeConfig,
  TServerHandler,
  TUserDetails,
  TExtendedEditorRefApi,
  EventToPayloadMap,
} from "@/types";

/**
 * Discriminated catalog of every command invokable through the editor —
 * via the bubble menu, slash menu, toolbar, or imperative `EditorRefApi`
 * (`executeMenuItemCommand`, `isMenuItemActive`).
 *
 * The union is constrained (rather than `string`) so consumers building
 * toolbar/slash UIs get compile-time rejection of unknown command names
 * and IDE autocomplete. The trailing `| TExtendedEditorCommands` injects
 * overlay-specific commands from `@/plane-editor/types/editor-extended`,
 * letting the community/enterprise editions add commands without
 * modifying the core union — see `TExtendedEditorCommands` for the
 * overlay-specific entries.
 */
export type TEditorCommands =
  | "text"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "bulleted-list"
  | "numbered-list"
  | "to-do-list"
  | "quote"
  | "code"
  | "table"
  | "image"
  | "divider"
  | "link"
  | "issue-embed"
  | "text-color"
  | "background-color"
  | "text-align"
  | "callout"
  | "attachment"
  | "emoji"
  | "external-embed"
  | TExtendedEditorCommands;

/**
 * Per-command extra-props map — keys are command names from
 * `TEditorCommands`, values are the additional payload each command
 * requires beyond its identity.
 *
 * Most commands (e.g., `"bold"`, `"h1"`) require no payload and are
 * intentionally absent from this map; only commands listed here need
 * extra runtime data from the invoker (the link URL, the saved
 * Selection for inline content insertion, the chosen color, etc.).
 *
 * Behavioral notes on optional / nullable fields:
 *   - `image.savedSelection` / `attachment.savedSelection`: `null` means
 *     "insert at the current cursor"; a `Selection` means "restore that
 *     selection first, then insert at the restored cursor". Used to
 *     re-anchor insertion when the user has interacted with a modal
 *     (which would otherwise blur the editor and lose the cursor).
 *   - `text-color.color` / `background-color.color`: `undefined` clears
 *     the color attribute (revert to default); a string applies that
 *     color value.
 *   - `link.text`: optional — when present, the link node renders with
 *     that visible text; when absent, the existing selection text is
 *     used as the link label.
 */
export type TCommandExtraProps = {
  image: {
    savedSelection: Selection | null;
  };
  attachment: {
    savedSelection: Selection | null;
  };
  "text-color": {
    color: string | undefined;
  };
  link: {
    url: string;
    text?: string;
  };
  "background-color": {
    color: string | undefined;
  };
  "text-align": {
    alignment: TTextAlign;
  };
};

// Create a utility type that maps a command to its extra props or an empty object if none are defined
/**
 * Conditional mapped type that yields a command's `TCommandExtraProps`
 * payload (or `object` when no extras are required) given a command
 * name `T`.
 *
 * Lets consumers writing `executeMenuItemCommand` invocations get a
 * precisely-typed second-argument shape: for `"bold"` the extras are
 * `object` (no extras), for `"link"` the extras are
 * `{ url: string; text?: string }`. Without this conditional,
 * consumers would need to pass `any` or hand-write the extras for
 * each command site.
 */
export type TCommandWithProps<T extends TEditorCommands> = T extends keyof TCommandExtraProps
  ? TCommandExtraProps[T] // If the command has extra props, include them
  : object; // Otherwise, just return the command type with no extra props

type TCommandWithPropsWithItemKey<T extends TEditorCommands> = T extends keyof TCommandExtraProps
  ? { itemKey: T } & TCommandExtraProps[T]
  : { itemKey: T };

/**
 * Document statistics returned by `EditorRefApi.getDocumentInfo()` and
 * pushed to `EditorRefApi.onDocumentInfoChange` subscribers.
 *
 * All three counts are recomputed on every editor transaction (each
 * keystroke, paste, or remote update), so subscribers see live counts
 * suitable for footer counters and word-limit indicators.
 */
export type TDocumentInfo = {
  characters: number;
  paragraphs: number;
  words: number;
};

/**
 * Imperative API surface that parent components use to interact with a
 * live editor instance.
 *
 * Constructed via `useImperativeHandle` in `core/hooks/use-editor.ts`
 * (and the collaborative/title hook variants); method bodies are
 * implemented in `core/helpers/editor-ref.ts` via the
 * `getEditorRefHelpers` factory. Composed with overlay-specific methods
 * through `EditorRefApi = CoreEditorRefApi & TExtendedEditorRefApi`
 * (see `@/plane-editor/types/editor-extended`).
 *
 * Parents assign a `MutableRefObject<EditorRefApi | null>` to
 * `IEditorProps.forwardedRef` and call methods on `.current`. Direct
 * TipTap editor access is intentionally not exposed — all editor
 * interactions go through this contract so the underlying TipTap
 * version can be upgraded without breaking consumers.
 *
 * Method groups:
 *   - focus/blur: `focus`, `blur`, `setFocusAtPosition`,
 *     `createSelectionAtCursorPosition`.
 *   - document I/O: `getDocument` (returns `{ binary, html, json }` —
 *     binary is the Yjs encoded update or `null` when not in collab
 *     mode), `setEditorValue`, `setEditorValueAtCursorPosition`,
 *     `clearEditor`, `setProviderDocument`, `getMarkDown`,
 *     `copyMarkdownToClipboard`.
 *   - cursor/selection: `getCurrentCursorPosition`, `getSelectedText`,
 *     `getCoordsFromPos`.
 *   - TOC/headings: `getHeadings`, `onHeadingChange`, `scrollSummary`,
 *     `scrollToNodeViaDOMCoordinates` — used by the table-of-contents
 *     sidebar to render and scroll to headings.
 *   - realtime: `emitRealTimeUpdate`, `listenToRealTimeUpdate`
 *     (returns a `TDocumentEventEmitter` for subscribing to events
 *     broadcast through the Hocuspocus stateless channel).
 *   - menu commands: `executeMenuItemCommand`, `isMenuItemActive` —
 *     both keyed by `TCommandWithPropsWithItemKey<T>` so the payload
 *     shape is enforced per command.
 *   - history: `undo`, `redo`.
 *   - subscriptions: `onDocumentInfoChange`, `onStateChange`.
 *   - readiness: `isEditorReadyToDiscard` (true when no unsaved
 *     changes), `isAnyDropbarOpen` (true when a dropdown/popover owned
 *     by the editor is open — used by parents to suppress global
 *     keyboard shortcuts).
 *   - inline insertion: `insertText` (with optional `insertOnNextLine`
 *     to push the inserted HTML to a new paragraph below the cursor).
 *   - mark attributes: `getAttributesWithExtendedMark`.
 *
 * `on*Change` methods (and `onHeadingChange`) return an unsubscribe
 * function — call it to remove the listener, e.g., from a React
 * effect cleanup.
 */
export type CoreEditorRefApi = {
  blur: () => void;
  clearEditor: (emitUpdate?: boolean) => void;
  createSelectionAtCursorPosition: () => void;
  emitRealTimeUpdate: (action: TDocumentEventsServer) => void;
  executeMenuItemCommand: <T extends TEditorCommands>(props: TCommandWithPropsWithItemKey<T>) => void;
  focus: (args: Parameters<RawCommands["focus"]>[0]) => void;
  getAttributesWithExtendedMark: (
    mark: string | MarkType,
    attribute: string | NodeType | MarkType
  ) => Record<string, any> | undefined;
  getCoordsFromPos: (pos?: number) => ReturnType<EditorView["coordsAtPos"]> | undefined;
  getCurrentCursorPosition: () => number | undefined;
  getDocument: () => {
    binary: Uint8Array | null;
    html: string;
    json: JSONContent | null;
  };
  getDocumentInfo: () => TDocumentInfo;
  getHeadings: () => IMarking[];
  getMarkDown: () => string;
  copyMarkdownToClipboard: () => void;
  getSelectedText: () => string | null;
  insertText: (contentHTML: string, insertOnNextLine?: boolean) => void;
  isAnyDropbarOpen: () => boolean;
  isEditorReadyToDiscard: () => boolean;
  isMenuItemActive: <T extends TEditorCommands>(props: TCommandWithPropsWithItemKey<T>) => boolean;
  listenToRealTimeUpdate: () => TDocumentEventEmitter | undefined;
  onDocumentInfoChange: (callback: (documentInfo: TDocumentInfo) => void) => () => void;
  onHeadingChange: (callback: (headings: IMarking[]) => void) => () => void;
  onStateChange: (callback: () => void) => () => void;
  redo: () => void;
  scrollSummary: (marking: IMarking) => void;

  scrollToNodeViaDOMCoordinates: ({ pos, behavior }: { pos?: number; behavior?: ScrollBehavior }) => void;
  setEditorValue: (content: string, emitUpdate?: boolean) => void;
  setEditorValueAtCursorPosition: (content: string) => void;
  setFocusAtPosition: (position: number) => void;
  setProviderDocument: (value: Uint8Array) => void;
  undo: () => void;
};

/**
 * Public imperative-API contract for every editor variant — the
 * composition of `CoreEditorRefApi` (defined above) and
 * `TExtendedEditorRefApi` (from `@/plane-editor/types/editor-extended`).
 *
 * The `& TExtendedEditorRefApi` extension lets the community/enterprise
 * overlay add methods (e.g., enterprise-only commands) without
 * modifying the core API — see `TExtendedEditorRefApi` for the
 * overlay-specific methods.
 *
 * Consumed by every editor wrapper: `RichTextEditorWithRef`,
 * `LiteTextEditorWithRef`, `DocumentEditorWithRef`, and
 * `CollaborativeDocumentEditorWithRef` in `core/components/editors/`.
 */
export type EditorRefApi = CoreEditorRefApi & TExtendedEditorRefApi;

/**
 * Alias for `EditorRefApi` used specifically for page-title editors.
 *
 * Kept as a distinct alias (rather than reusing `EditorRefApi`
 * directly) so readers and IDE intellisense can distinguish a title
 * ref from a body ref — important when both refs co-exist on the same
 * component, e.g., the collaborative document editor exposes
 * `forwardedRef` for the body and `titleRef` for the heading
 * (see `ICollaborativeDocumentEditorProps.titleRef`).
 */
export type EditorTitleRefApi = EditorRefApi;

// editor props
/**
 * Base prop shape inherited by every editor variant — `ILiteTextEditorProps`,
 * `IRichTextEditorProps`, `IDocumentEditorProps`, and
 * `ICollaborativeDocumentEditorProps` all derive from this contract.
 *
 * Consumed by the wrapper components in `core/components/editors/`
 * (lite-text, rich-text, document, document/collaborative) and threaded
 * through to the underlying `useEditor` / `useCollaborativeEditor` /
 * `useTitleEditor` hooks via the `Pick`-derived contracts in
 * `core/types/hook.ts`.
 *
 * Behavioral notes on key fields (per AAP Rule 2 — flag optional /
 * dual-purpose fields with non-obvious semantics):
 *   - `disabledExtensions` vs `flaggedExtensions`: both accept
 *     `TExtensions[]`. `disabledExtensions` REMOVES the extension
 *     entirely (no node schema, no commands, not wired into the
 *     editor); `flaggedExtensions` keeps the extension wired but marks
 *     it for conditional behavior (e.g., feature-flagged rendering,
 *     overlay-specific gating). Mis-using one for the other is a
 *     common source of subtle bugs.
 *   - `initialValue` (required) vs `value?` (optional): `initialValue`
 *     is read ONCE at editor construction; `value?` is observed for
 *     controlled updates from outside (e.g., when external state
 *     replaces the editor content). The document/collaborative variants
 *     `Omit` both fields because Yjs drives content there.
 *   - `forwardedRef?` — when present, the parent gets imperative
 *     control of the editor via `EditorRefApi`. Required by parents
 *     that need to call `focus()`, `getDocument()`, or any other
 *     imperative method.
 *   - `getEditorMetaData` (required) — called on every content change
 *     to extract custom-component metadata (e.g., embedded work-item
 *     references) for syncing back to consumer state.
 *   - `onChange?` — fires with `(json, html, { isMigrationUpdate })`.
 *     The `isMigrationUpdate` flag is set during legacy-data
 *     migrations so consumers can suppress side effects (e.g., skip
 *     dirty-flag updates or analytics events) when the change
 *     originated from automatic migration rather than user input.
 *   - `placeholder?` — accepts either a static string or a
 *     `(isFocused, value) => string` callback for focus-aware
 *     placeholder text (e.g., "Press / for commands" when focused,
 *     "Start writing..." when blurred).
 *   - `extendedEditorProps` (required) — overlay-specific props
 *     supplied via `IEditorPropsExtended` from
 *     `@/plane-editor/types/editor-extended`; the community/enterprise
 *     overlay defines its shape.
 *   - `mentionHandler` (required) — search + render callbacks for the
 *     mention extension; see `TMentionHandler`.
 *   - `fileHandler` (required) — upload/download/restore callbacks for
 *     embedded assets; see `TFileHandler`.
 */
export type IEditorProps = {
  autofocus?: boolean;
  bubbleMenuEnabled?: boolean;
  containerClassName?: string;
  displayConfig?: TDisplayConfig;
  disabledExtensions: TExtensions[];
  editable: boolean;
  editorClassName?: string;
  editorProps?: EditorProps;
  extensions?: Extensions;
  flaggedExtensions: TExtensions[];
  fileHandler: TFileHandler;
  forwardedRef?: React.MutableRefObject<EditorRefApi | null>;
  getEditorMetaData: (htmlContent: string) => TCustomComponentsMetaData;
  handleEditorReady?: (value: boolean) => void;
  id: string;
  initialValue: string;
  isTouchDevice?: boolean;
  mentionHandler: TMentionHandler;
  onAssetChange?: (assets: TEditorAsset[]) => void;
  onEditorFocus?: () => void;
  onChange?: (json: object, html: string, { isMigrationUpdate }?: { isMigrationUpdate?: boolean }) => void;
  onEnterKeyPress?: (e?: any) => void;
  onTransaction?: () => void;
  placeholder?: string | ((isFocused: boolean, value: string) => string);
  showPlaceholderOnEmpty?: boolean;
  tabIndex?: number;
  value?: string | null;
  extendedEditorProps: IEditorPropsExtended;
  workItemIdentifier?: string | null;
};

/**
 * Prop shape for the lite-text editor — a minimal editor variant used
 * for short-form content (issue comments, inline descriptions) where
 * the document-editor features (drag-drop, block-level reordering,
 * TOC) are intentionally absent.
 *
 * Pure alias of `IEditorProps` — no additions, no omissions. Kept as a
 * named alias so the consumer-facing wrapper signature remains stable
 * even if `IEditorProps` later diverges into variant-specific shapes.
 *
 * Consumer: `core/components/editors/lite-text/`.
 */
export type ILiteTextEditorProps = IEditorProps;

/**
 * Prop shape for the rich-text editor — extends `IEditorProps` with a
 * drag-drop toggle for block-level reordering.
 *
 * Behavioral notes:
 *   - `dragDropEnabled?` — defaults to `false` when omitted; when
 *     `true`, the rich-text wrapper wires the drag-handle and
 *     drop-cursor extensions so users can drag blocks to reorder them.
 *     Kept optional so the same prop interface can serve both
 *     reorderable contexts (issue descriptions) and non-reorderable
 *     ones (inline forms).
 *
 * Consumer: `core/components/editors/rich-text/`.
 */
export type IRichTextEditorProps = IEditorProps & {
  dragDropEnabled?: boolean;
};

/**
 * Prop shape for the collaborative document editor — wraps
 * `IEditorProps` (omitting `initialValue`, `onEnterKeyPress`, `value`)
 * and adds collaboration-specific fields.
 *
 * Why the `Omit`: in collaborative mode, document content is driven by
 * the Yjs `HocuspocusProvider` (the editor pulls state from the
 * provider, not props). `initialValue` and `value` would conflict
 * with the Yjs source of truth, and `onEnterKeyPress` is not
 * applicable because remote keystrokes also drive document changes —
 * the parent should observe the Yjs document, not the local keydown.
 *
 * Added fields:
 *   - `realtimeConfig: TRealtimeConfig` (required) — Hocuspocus URL
 *     and room configuration used by the collaboration provider.
 *   - `user: TUserDetails` (required) — identity used for awareness
 *     (presence cursors, name labels), selection broadcasting, and
 *     attribution of edits in the collaboration channel.
 *   - `editable: boolean` (required, explicitly re-declared) — kept on
 *     the variant interface so the contract is self-contained even
 *     though `IEditorProps.editable` is also required.
 *   - `aiHandler?: TAIHandler` — optional AI menu wiring (slash menu
 *     items for AI-generated content).
 *   - `serverHandler?: TServerHandler` — optional collaboration-state
 *     observer; receives `CollaborationState` updates (connecting →
 *     synced → reconnecting → disconnected, see `CollabStage`).
 *   - `extendedDocumentEditorProps?: ICollaborativeDocumentEditorPropsExtended`
 *     — optional overlay-specific props from
 *     `@/plane-editor/types/editor-extended`.
 *   - `updatePageProperties?` — when present, the editor emits page-
 *     property realtime events through `apps/live` (broadcasts to
 *     other collaborators). Keyed by `EventToPayloadMap` so the
 *     payload shape is enforced per action type.
 *   - `dragDropEnabled?` — block-level reordering toggle (defaults
 *     `false`).
 *   - `documentLoaderClassName?` — class applied to the loader shown
 *     while the Yjs document is fetching.
 *   - `pageRestorationInProgress?` — `true` while restoring a prior
 *     page version, suppresses local edit handling.
 *   - `titleRef?` — ref binding for the page title editor when the
 *     parent renders a separate title surface (see `EditorTitleRefApi`).
 *   - `isFetchingFallbackBinary?` — `true` while the editor is
 *     fetching a fallback binary snapshot from the API (used when the
 *     realtime server has no document state yet — HTML→binary
 *     backfill path, see `apps/live` `extensions/database.ts`).
 *
 * Consumer: `core/components/editors/document/collaborative-editor.tsx`.
 */
export type ICollaborativeDocumentEditorProps = Omit<IEditorProps, "initialValue" | "onEnterKeyPress" | "value"> & {
  aiHandler?: TAIHandler;
  documentLoaderClassName?: string;
  dragDropEnabled?: boolean;
  editable: boolean;
  realtimeConfig: TRealtimeConfig;
  serverHandler?: TServerHandler;
  user: TUserDetails;
  extendedDocumentEditorProps?: ICollaborativeDocumentEditorPropsExtended;
  updatePageProperties?: <T extends keyof EventToPayloadMap>(
    pageIds: string | string[],
    actionType: T,
    data: EventToPayloadMap[T],
    performAction?: boolean
  ) => void;
  pageRestorationInProgress?: boolean;
  titleRef?: React.MutableRefObject<EditorTitleRefApi | null>;
  isFetchingFallbackBinary?: boolean;
};

/**
 * Prop shape for the non-collaborative document editor — wraps
 * `IEditorProps` (omitting `initialValue`, `onEnterKeyPress`, `value`)
 * and adds document-specific fields.
 *
 * Exists separately from `ICollaborativeDocumentEditorProps` because
 * the non-collaborative variant is used for read-only document
 * previews (e.g., archived page versions) and offline document
 * editing where no Yjs / Hocuspocus provider is wired. The `Omit` of
 * `initialValue` / `value` from the base shape is replaced by a
 * single `value: Content` field — the document is driven by a
 * controlled TipTap `Content` value rather than by props or a
 * provider.
 *
 * Added fields:
 *   - `value: Content` (required) — current document content as the
 *     TipTap `Content` type (richer than `IEditorProps.value: string`).
 *   - `aiHandler?: TAIHandler` — optional AI menu wiring.
 *   - `user?: TUserDetails` — optional user identity used for
 *     in-document user mentions; the editor does NOT use it for
 *     cursor awareness here (no collaboration provider).
 *
 * Consumer: `core/components/editors/document/editor.tsx`.
 */
export type IDocumentEditorProps = Omit<IEditorProps, "initialValue" | "onEnterKeyPress" | "value"> & {
  aiHandler?: TAIHandler;
  user?: TUserDetails;
  value: Content;
};

/**
 * TipTap editor lifecycle event payload map — keys are TipTap-defined
 * event names; values are the payload shape (or `never` when the
 * event carries no payload).
 *
 * `never` is used (rather than `void` or `undefined`) so consumers
 * writing event listeners as `(args: never) => {}` get correct
 * nothingness inference at the call site — TypeScript will reject any
 * accidental use of `args` for the no-payload events.
 *
 * The only payload-carrying entry is `ready: { height: number }`,
 * which fires after the first render and exposes the rendered editor
 * height. Parents use it for layout calculations that depend on the
 * fully-rendered editor size (e.g., sizing a sibling sidebar or
 * scrolling the viewport to bring the editor into view).
 */
export type EditorEvents = {
  beforeCreate: never;
  create: never;
  update: never;
  selectionUpdate: never;
  transaction: never;
  focus: never;
  blur: never;
  destroy: never;
  ready: { height: number };
};

/**
 * Plane-editor-owned alias for `@tiptap/react`'s `NodeViewProps`.
 *
 * Re-exported under a local name so node-view components import from
 * `@plane/editor` rather than directly from `@tiptap/react`. This
 * keeps the `@plane/editor` public surface decoupled from the
 * underlying TipTap version — internal version bumps of
 * `@tiptap/react` do not break consumers' imports.
 */
export type NodeViewProps = TNodeViewProps;
