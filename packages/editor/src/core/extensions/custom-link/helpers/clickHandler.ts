/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * ProseMirror plugin factory for click-to-open links inside `CustomLinkExtension`.
 *
 * This module is Plane's first-party replacement for `@tiptap/extension-link`'s built-in click
 * handler. It is intentionally not the upstream implementation — kept under our control so the
 * "open the link's `href` in its configured `target` window" behavior can be tuned alongside the
 * rest of `CustomLinkExtension` (autolink, paste-to-link, mark attributes) without forking the
 * upstream package.
 *
 * Split into its own file so editor variants can compose click-to-open independently from
 * autolink and paste-to-link via the `openOnClick` boolean option in `CustomLinkExtension`
 * (see sibling `../extension.tsx` `addProseMirrorPlugins()`).
 */

import { getAttributes } from "@tiptap/core";
import type { MarkType } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";

type ClickHandlerOptions = {
  type: MarkType;
};

/**
 * Builds a ProseMirror plugin (key: `"handleClickLink"`) that intercepts clicks on link-marked
 * DOM nodes via the `handleClick` prop and opens the clicked link's `href` in its configured
 * `target` window.
 *
 * Filter chain inside `handleClick` (every condition must hold for the click to be treated as a
 * link-open):
 * 1. `event.button === 0` — non-primary buttons (middle-click, right-click, etc.) are ignored;
 *    only the primary mouse button can trigger a window open.
 * 2. Climbing DOM ancestry from `event.target` up to the nearest `<DIV>` must encounter an `<A>`
 *    element; otherwise the handler returns `false` so clicks on non-link content (paragraphs,
 *    headings, list items) fall through to ProseMirror's default click handling instead of
 *    triggering a window-open.
 * 3. `href` is resolved preferentially from the clicked `HTMLLinkElement.href` and falls back to
 *    `getAttributes(view.state, options.type.name).href` (the link mark's stored href). The
 *    fallback covers the case where `event.target` is a CHILD of the `<a>` (e.g.,
 *    `<a href="..."><span>label</span></a>` — `event.target` is the `<span>`, not the `<a>`), so
 *    the destination is read from the mark's stored attributes rather than from the child node.
 *
 * Action: when a usable `href` is resolved, calls `window.open(href, target)` and returns `true`
 * to suppress ProseMirror's default click handling. `target` resolves from the same precedence
 * chain (`HTMLLinkElement.target` then mark attribute) and defaults to `"_blank"` via
 * `CustomLinkExtension.options.HTMLAttributes.target` — so links open in a new window/tab by
 * default.
 *
 * Return contract: `true` when the click was handled (suppresses ProseMirror default handling);
 * `false` when not (lets ProseMirror handle normally).
 *
 * Modifier-click behavior (observed): the handler does NOT branch on `event.ctrlKey` or
 * `event.metaKey` — every primary-button click on a link element calls `window.open(href, target)`
 * regardless of modifier keys. Because `target = "_blank"` is the default, Cmd-click and a
 * regular click produce the same outcome (open in a new tab); the implementation is internally
 * consistent with the file's "always open in a new window" intent.
 *
 * Why this override exists (do NOT remove without replacing the UX it provides):
 * 1. Without this handler, link clicks inside the editor are inert. ProseMirror's default `<a>`
 *    behavior is to do nothing inside the editor view — its event chain swallows default browser
 *    navigation to keep the document mounted — so users could not open links by clicking them
 *    at all.
 * 2. Plane owns its link UX as first-party code. Opening in `_blank` by default (rather than
 *    same-tab navigation) ensures the editor view is never lost when a user follows a link.
 * 3. Pairs with the bubble-menu link editor: clicking opens the URL while the bubble menu
 *    (rendered outside this plugin by external UI components, orchestrated via
 *    `CustomLinkStorage` flags in `../extension.tsx`) provides the link EDITING affordance.
 *    Removing this click handler regresses the entire link UX pattern, not just one behavior.
 *
 * @param options - Configuration for the plugin.
 * @param options.type - The link `MarkType`, supplied as `this.type` by
 *   `CustomLinkExtension.addProseMirrorPlugins()` (resolves to the `"link"` mark per
 *   `CORE_EXTENSIONS.CUSTOM_LINK` in `packages/editor/src/core/constants/extension.ts`).
 * @returns A configured ProseMirror `Plugin` keyed `"handleClickLink"`.
 */
export function clickHandler(options: ClickHandlerOptions): Plugin {
  return new Plugin({
    key: new PluginKey("handleClickLink"),
    props: {
      handleClick: (view, pos, event) => {
        if (event.button !== 0) {
          return false;
        }

        let a = event.target as HTMLElement;
        const els: HTMLElement[] = [];

        while (a?.nodeName !== "DIV") {
          els.push(a);
          a = a?.parentNode as HTMLElement;
        }

        if (!els.find((value) => value.nodeName === "A")) {
          return false;
        }

        const attrs = getAttributes(view.state, options.type.name);
        const link = event.target as HTMLLinkElement;

        const href = link?.href ?? attrs.href;
        const target = link?.target ?? attrs.target;

        if (link && href) {
          window.open(href, target);

          return true;
        }

        return false;
      },
    },
  });
}
