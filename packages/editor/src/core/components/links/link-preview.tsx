/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Lightweight floating preview popover rendered when a link anchor is selected
 * in the editor; mounted by the `LinkView` controller when
 * `currentView === "LinkPreview"`.
 *
 * Fills the inline-UI gap left by `@tiptap/extension-link`, which exposes link
 * state through commands but ships no floating popover. The upstream
 * click-to-navigate behavior is intentionally suppressed in
 * `core/extensions/custom-link/` so this floating UI can take over
 * selection-time interactions.
 *
 * In read-only mode (`editor.isEditable === false`) the edit and unlink
 * actions are hidden — only the copy-URL action remains visible.
 */

import { Link2Off } from "lucide-react";
import { CopyIcon, GlobeIcon, EditIcon } from "@plane/propel/icons";
// components
import type { LinkViewProps, LinkViews } from "@/components/links";

/**
 * Renders a floating popover with a globe icon, the selected URL truncated at
 * 40 characters, and copy/edit/unlink action buttons.
 *
 * Props (cited by name; types live in `link-view.tsx`):
 * - `viewProps: LinkViewProps` — link context forwarded from the `LinkView`
 *   controller (the `editor` instance, the selection range `from`/`to`, the
 *   resolved `url`, and the `closeLinkView` dismissal callback).
 * - `switchView: (view: LinkViews) => void` — bridge used to transition the
 *   parent controller into `"LinkEditView"`.
 *
 * Side effects:
 * - `copyLinkToClipboard` writes the URL via
 *   `navigator.clipboard.writeText(url)` then invokes
 *   `viewProps.closeLinkView()`.
 * - `removeLink` dispatches a raw ProseMirror transaction
 *   (`editor.view.dispatch(editor.state.tr.removeMark(from, to, editor.schema.marks.link))`)
 *   to strip the link mark — bypassing the TipTap chain API — then invokes
 *   `viewProps.closeLinkView()`.
 * - The edit button invokes `switchView("LinkEditView")` only when
 *   `editor.isEditable` is true.
 *
 * TipTap behavior:
 * - Exposes the editor's ProseMirror transaction dispatch (`editor.view`,
 *   `editor.state.tr`, `editor.schema.marks.link`) for the unlink action.
 * - Overrides `@tiptap/extension-link`'s lack of any inline UI — TipTap
 *   exposes link state through commands but ships no floating popover, and
 *   this component fills that gap.
 * - Hides the edit and unlink buttons when `editor.isEditable === false`, so
 *   read-only consumers only see the copy-URL action.
 *
 * Consumer: `LinkView` in `link-view.tsx` (renders this when
 * `currentView === "LinkPreview"`); ultimately mounted by
 * `editors/link-view-container.tsx` during the hover-preview workflow.
 */
export function LinkPreview({
  viewProps,
  switchView,
}: {
  viewProps: LinkViewProps;
  switchView: (view: LinkViews) => void;
}) {
  const { editor, from, to, url } = viewProps;

  const removeLink = () => {
    editor.view.dispatch(editor.state.tr.removeMark(from, to, editor.schema.marks.link));
    viewProps.closeLinkView();
  };

  const copyLinkToClipboard = () => {
    navigator.clipboard.writeText(url);
    viewProps.closeLinkView();
  };

  return (
    <div
      className="animate-in fade-in absolute top-0 left-0 max-w-max translate-y-1"
      style={{
        transition: "all 0.2s cubic-bezier(.55, .085, .68, .53)",
      }}
    >
      <div className="shadow-md flex items-center gap-3 rounded-sm border-2 border-subtle bg-layer-1 p-2 text-11 text-tertiary">
        <GlobeIcon width={14} height={14} className="inline-block" />
        <p>{url?.length > 40 ? url.slice(0, 40) + "..." : url}</p>
        <div className="flex gap-2">
          <button onClick={copyLinkToClipboard} className="cursor-pointer transition-colors hover:text-primary">
            <CopyIcon width={14} height={14} className="inline-block" />
          </button>
          {editor.isEditable && (
            <>
              <button
                onClick={() => switchView("LinkEditView")}
                className="cursor-pointer transition-colors hover:text-primary"
              >
                <EditIcon width={14} height={14} className="inline-block" />
              </button>
              <button onClick={removeLink} className="cursor-pointer transition-colors hover:text-primary">
                <Link2Off size={14} className="inline-block" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
