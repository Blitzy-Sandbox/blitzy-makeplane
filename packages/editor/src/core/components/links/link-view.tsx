/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Floating link overlay controller for the Plane editor stack.
 *
 * This module is the stateful runtime switchboard for the floating link UI; it
 * exports the {@link LinkView} controller, the {@link LinkViews} mode
 * discriminant, and the {@link LinkViewProps} link-context contract that is
 * forwarded to both child views — `LinkPreview` (inspect / copy / edit / unlink)
 * and `LinkEditView` (controlled edit form).
 *
 * User-facing workflow: hovering an anchor causes `editors/link-view-container.tsx`
 * to mount this controller in `"LinkPreview"` mode → the user clicks the edit
 * action → the controller transitions to `"LinkEditView"` → the user submits or
 * removes the link → `closeLinkView()` dismisses the floating overlay. The
 * single-overlay-two-views architecture is the reason a controller component is
 * needed at all instead of rendering either child view directly at the mount
 * site.
 *
 * Cross-reference (TipTap behavior intentionally overridden): the upstream
 * `@tiptap/extension-link` ships click-to-navigate as its default user
 * affordance. Plane's custom mark in `core/extensions/custom-link/` keeps
 * `openOnClick` active but routes the click into a ProseMirror plugin that
 * surfaces this floating overlay instead of navigating away; that is why a
 * downstream reader does not see the editor navigate when a link is clicked —
 * the click is consumed by the orchestrator which mounts `LinkView`.
 */

import type { Editor } from "@tiptap/react";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
// components
import { LinkEditView, LinkPreview } from "@/components/links";

/**
 * String-union discriminant for the floating link overlay's two render modes.
 *
 * Restricts the controller's internal mode switching to `"LinkPreview"` (the
 * default popover for inspect / copy / edit / unlink) and `"LinkEditView"`
 * (the controlled edit form). Reused as the `view` field on
 * {@link LinkViewProps} (initial-mode override) and as the parameter type of
 * the internal `switchView` bridge handed to both child views.
 */
export type LinkViews = "LinkPreview" | "LinkEditView";

/**
 * Link context contract passed from the orchestrator (e.g.
 * `LinkViewContainer` or the bubble-menu link selector) to the
 * {@link LinkView} controller and forwarded verbatim to both child views.
 *
 * Fields:
 *   - `view?` — optional initial render mode; defaults to `"LinkPreview"`
 *     inside the controller when omitted.
 *   - `editor` — the active TipTap `Editor` instance used by the child views
 *     for ProseMirror transactions and chain commands; the controller itself
 *     never dispatches against it.
 *   - `from`, `to` — the link anchor's ProseMirror document position range; a
 *     change in `from` triggers a controller-level reset back to preview mode
 *     (see the reset effect in {@link LinkView}).
 *   - `url` — the current link `href`; consumed by both child views as the
 *     initial value of the URL input.
 *   - `text?` — optional display text at the anchor; relevant only to
 *     `LinkEditView` for in-place text replacement.
 *   - `closeLinkView` — callback invoked by child views to dismiss the
 *     floating overlay; typically resolves to `setLinkViewProps(undefined)`
 *     (or an equivalent `isOpen` toggle) inside the orchestrator.
 */
export type LinkViewProps = {
  view?: LinkViews;
  editor: Editor;
  from: number;
  to: number;
  url: string;
  text?: string;
  closeLinkView: () => void;
};

/**
 * Stateful controller for the floating link overlay; renders exactly one of
 * `LinkPreview` or `LinkEditView` at a time based on its internal `currentView`
 * state.
 *
 * Props: {@link LinkViewProps} & `{ style: CSSProperties }`. The `style` prop
 * lives outside `LinkViewProps` because the orchestrator (`LinkViewContainer`)
 * computes Floating UI positioning at the mount site and supplies it as a
 * positioning override — this is a deliberate split between link **context**
 * (carried by `LinkViewProps`) and rendering **hint** (`style`).
 *
 * State:
 *   - `currentView: LinkViews` — initialized to `props.view ?? "LinkPreview"`,
 *     so callers that mount the controller in edit mode (e.g. a bubble-menu
 *     workflow that wants the edit form on first paint) get that mode without
 *     a follow-up transition.
 *   - `prevFrom: number` — snapshot of `props.from` used by the reset effect
 *     to detect anchor changes.
 *
 * Side effects:
 *   - `useEffect` on `[prevFrom, props.from]`: when `props.from !== prevFrom`
 *     (i.e. the user has moved their selection or hovered a different link),
 *     reset `currentView` to `"LinkPreview"` and capture the new `from`. The
 *     reset is required because the overlay must restart the inspect-then-edit
 *     workflow whenever the anchor changes; without it, a user who hovered
 *     link A, clicked edit, then hovered link B would still see link B's edit
 *     form open instead of B's preview.
 *
 * TipTap behavior:
 *   - Exposes: the active `Editor` instance to both child views via
 *     `viewProps`; the controller itself never invokes any TipTap command or
 *     ProseMirror transaction — every mutation (unlink, copy, url/text edit)
 *     is delegated to `LinkPreview` and `LinkEditView`.
 *   - Overrides / hides: not applicable at the controller layer; the override
 *     of `@tiptap/extension-link`'s default UI happens in the child views and
 *     in `core/extensions/custom-link/`.
 *
 * Consumers:
 *   - `packages/editor/src/core/components/editors/link-view-container.tsx` —
 *     hover-preview workflow; mounts `LinkView` with Floating UI positioning.
 *   - `packages/editor/src/core/components/menus/bubble-menu/link-selector.tsx` —
 *     bubble-menu workflow; alternate entry point into the link-editing UI.
 */
export function LinkView(props: LinkViewProps & { style: CSSProperties }) {
  const [currentView, setCurrentView] = useState<LinkViews>(props.view ?? "LinkPreview");
  const [prevFrom, setPrevFrom] = useState(props.from);

  /**
   * Bridge handed to the child views so they can transition the parent
   * controller between `"LinkPreview"` and `"LinkEditView"` without owning
   * the controller's state.
   */
  const switchView = (view: LinkViews) => {
    setCurrentView(view);
  };

  useEffect(() => {
    if (props.from !== prevFrom) {
      setCurrentView("LinkPreview");
      setPrevFrom(props.from);
    }
  }, [prevFrom, props.from]);

  return (
    <>
      {currentView === "LinkPreview" && <LinkPreview viewProps={props} switchView={switchView} />}
      {currentView === "LinkEditView" && <LinkEditView viewProps={props} switchView={switchView} />}
    </>
  );
}
