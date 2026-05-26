/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Edit popover for modifying an existing link's URL and display text, rendered by the
 * `LinkView` controller (`link-view.tsx`) when its `currentView === "LinkEditView"`.
 *
 * Composes TipTap's command primitives (`setLink`/`unsetLink` are surfaced as
 * raw ProseMirror `tr.removeMark`/`tr.addMark` dispatches plus chain calls) into a
 * user-facing form: controlled URL and text inputs, Enter-to-submit, in-place link
 * mark update that preserves sibling non-link marks, link removal, and unmount-time
 * cleanup of abandoned empty links. `@tiptap/extension-link` exposes link state but
 * provides no inline edit UI; this module fills that gap.
 */
import type { Node } from "@tiptap/pm/model";
import { Link2Off } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
// components
import type { LinkViewProps, LinkViews } from "@/components/links";
// helpers
import { isValidHttpUrl } from "@/helpers/common";

type InputViewProps = {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
};

/**
 * Local reusable controlled-input row rendering a labeled text field; used by
 * `LinkEditView` for both the URL and display-text inputs. Internal to this module
 * (not exported); props are described by {@link InputViewProps}.
 */
function InputView({ label, value, placeholder, onChange, autoFocus }: InputViewProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="inline-block text-11 font-semibold text-placeholder">{label}</label>
      <input
        placeholder={placeholder}
        onClick={(e) => e.stopPropagation()}
        className="w-[280px] rounded-md border border-strong bg-layer-1 p-2 text-13 text-primary outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
      />
    </div>
  );
}

type LinkEditViewProps = {
  viewProps: LinkViewProps;
  switchView: (view: LinkViews) => void;
};

/**
 * Edit popover for modifying an existing link's URL and display text.
 *
 * Props are described by {@link LinkEditViewProps} (carries `viewProps: LinkViewProps`
 * from `link-view.tsx` plus the `switchView` callback typed against {@link LinkViews}).
 *
 * State:
 * - `positionRef`: immutable `{ from, to }` snapshot captured at mount; used by
 *   `applyChanges` to delete the original text range before inserting replacement
 *   text, so concurrent selection moves do not corrupt the splice.
 * - `localUrl`: controlled URL input state, seeded from `viewProps.url` and resynced
 *   by a `useEffect` whenever `initialUrl` changes.
 * - `localText`: controlled display-text input state, seeded from `viewProps.text`
 *   (defaults to `""` because `text` is optional on {@link LinkViewProps}) and
 *   resynced when `initialText` changes.
 * - `linkRemoved`: flag preventing the unmount cleanup from re-dispatching a removal
 *   that the user already performed explicitly via the "Remove Link" button.
 * - `hasSubmitted` (ref): flips to `true` inside `applyChanges`; lets the cleanup
 *   effect distinguish intentional submits from user-cancelled empty links.
 *
 * Side effects:
 * - URL validation: `applyChanges` consults `isValidHttpUrl(localUrl)` (from
 *   `@/helpers/common`) before dispatching; invalid URLs (and selections that have
 *   drifted past `editor.state.doc.content.size`) silently suppress the dispatch.
 * - Update link mark: a single ProseMirror transaction
 *   (`editor.state.tr.removeMark(...).addMark(...)`) replaces the existing link
 *   mark with one carrying the new `href`.
 * - Replace display text while preserving non-link marks: uses the TipTap chain
 *   API (`setTextSelection` → `deleteRange` → `insertContent` → `setTextSelection`)
 *   to swap text, then re-applies each non-link mark read from the {@link Node}
 *   (from `prosemirror-model`) at the original anchor.
 * - Enter-to-submit: the container's `onKeyDown` handler stops propagation, runs
 *   `applyChanges()`, and on success calls `closeLinkView()` and clears the inputs.
 * - Remove link mark: the "Remove Link" button dispatches `tr.removeMark(...)`
 *   directly through `editor.view.dispatch` (NOT the chain API), sets
 *   `linkRemoved`, and closes the popover.
 * - Unmount cleanup: dangling links created with an empty `initialUrl` and never
 *   submitted are stripped — see the dedicated effect's JSDoc below.
 *
 * TipTap behavior:
 * - Exposes the editor primitives `editor.view.dispatch`, `editor.state.tr`,
 *   `editor.schema.marks.link`, and the chain API (`setTextSelection`, `deleteRange`,
 *   `insertContent`, `setMark`) through the form's actions.
 * - Exposes `prosemirror-model`'s {@link Node} via the imported type; existing marks
 *   at the link anchor are read so they can be restored after text replacement.
 * - Overrides `@tiptap/extension-link`'s missing inline edit UI — TipTap exposes
 *   link state through commands but ships no floating edit form.
 * - Hides invalid-URL submissions and out-of-bounds selections: the guard inside
 *   `applyChanges` returns `false` without mutating the document, so consumers
 *   observe no transaction.
 *
 * Consumers: `LinkView` controller in `link-view.tsx` (renders this branch when
 * `currentView === "LinkEditView"`); ultimately mounted by
 * `editors/link-view-container.tsx` and the bubble-menu link selector.
 */
export function LinkEditView({ viewProps }: LinkEditViewProps) {
  const { editor, from, to, url: initialUrl, text: initialText, closeLinkView } = viewProps;

  // State
  const [positionRef] = useState({ from, to });
  const [localUrl, setLocalUrl] = useState(initialUrl);
  const [localText, setLocalText] = useState(initialText ?? "");
  const [linkRemoved, setLinkRemoved] = useState(false);
  const hasSubmitted = useRef(false);

  const removeLink = useCallback(() => {
    editor.view.dispatch(editor.state.tr.removeMark(from, to, editor.schema.marks.link));
    setLinkRemoved(true);
    closeLinkView();
  }, [editor, from, to, closeLinkView]);

  // Effects
  /**
   * Cleanup links the user abandoned without confirming. When the popover opens for
   * a freshly created link (`initialUrl === ""`) and the user dismisses it without
   * submitting (`!hasSubmitted.current`) and without using "Remove Link"
   * (`!linkRemoved`), unmounting must strip the empty-`href` link mark; otherwise
   * the document is left with a dangling link range that renders as broken.
   */
  useEffect(
    () =>
      // Cleanup effect: Remove link if not submitted and url is empty
      () => {
        if (!hasSubmitted.current && !linkRemoved && initialUrl === "") {
          try {
            removeLink();
          } catch (e) {
            console.error("Error removing link", e);
          }
        }
      },
    [removeLink, linkRemoved, initialUrl]
  );

  // Sync state with props
  useEffect(() => {
    setLocalUrl(initialUrl);
  }, [initialUrl]);

  useEffect(() => {
    if (initialText) setLocalText(initialText);
  }, [initialText]);

  // Handlers
  const handleTextChange = useCallback((value: string) => {
    if (value.trim() !== "") setLocalText(value);
  }, []);

  const applyChanges = useCallback((): boolean => {
    if (linkRemoved) return false;
    hasSubmitted.current = true;

    const { url, isValid } = isValidHttpUrl(localUrl);
    if (to >= editor.state.doc.content.size || !isValid) return false;

    // Apply URL change
    const tr = editor.state.tr;
    tr.removeMark(from, to, editor.schema.marks.link).addMark(from, to, editor.schema.marks.link.create({ href: url }));
    editor.view.dispatch(tr);

    // Apply text change if different
    if (localText !== initialText) {
      const node = editor.view.state.doc.nodeAt(from) as Node;
      if (!node || !node.marks) return false;

      editor
        .chain()
        .setTextSelection(from)
        .deleteRange({ from: positionRef.from, to: positionRef.to })
        .insertContent(localText)
        .setTextSelection({ from, to: from + localText.length })
        .run();
      //
      // Restore marks
      node.marks.forEach((mark) => {
        editor.chain().setMark(mark.type.name, mark.attrs).run();
      });
    }

    return true;
  }, [linkRemoved, positionRef, editor, from, to, initialText, localText, localUrl]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.stopPropagation();
        if (applyChanges()) {
          closeLinkView();
          setLocalUrl("");
          setLocalText("");
        }
      }
    },
    [applyChanges, closeLinkView]
  );

  return (
    <div
      onKeyDown={handleKeyDown}
      className="shadow-md animate-in fade-in flex translate-y-1 flex-col gap-3 rounded-sm border-2 border-subtle bg-layer-1 p-2"
      style={{
        transition: "all 0.1s cubic-bezier(.55, .085, .68, .53)",
      }}
      tabIndex={0}
    >
      <InputView label="URL" placeholder="Enter or paste URL" value={localUrl} onChange={setLocalUrl} autoFocus />
      <InputView label="Text" placeholder="Enter Text to display" value={localText} onChange={handleTextChange} />
      <div className="bg-strong mb-1 h-[1px] w-full gap-2" />
      <div className="flex items-center gap-2 text-13 text-secondary">
        <Link2Off size={14} className="inline-block" />
        <button onClick={removeLink} className="cursor-pointer transition-colors hover:text-placeholder">
          Remove Link
        </button>
      </div>
    </div>
  );
}
