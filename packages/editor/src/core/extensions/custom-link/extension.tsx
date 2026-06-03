/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Plane custom-link mark extension for the TipTap editor stack.
 *
 * API-compatible reimplementation of `@tiptap/extension-link` built directly
 * on `@tiptap/core`'s `Mark.create` rather than `Link.extend`. The canonical
 * mark name `"link"` (via `CORE_EXTENSIONS.CUSTOM_LINK`) is preserved so
 * existing HTML and stored ProseMirror documents round-trip through this
 * mark without schema migration.
 *
 * Plane-specific behavior layered on top of the upstream contract:
 *   - Three composable in-repo ProseMirror plugins for autolink, click-to-open,
 *     and paste-to-link (each individually toggleable via options so lite
 *     editor variants can compose subsets).
 *   - Editor storage slice (`CustomLinkStorage`) surfaced for Plane's
 *     bubble-menu link selector UI — the extension only initializes the
 *     slice; bubble-menu components rendered outside this file own all
 *     subsequent writes.
 *   - Hardened `parseHTML` and `renderHTML` that reject (parse-time) or
 *     blank (render-time) `javascript:`, `data:`, and `vbscript:` href
 *     values as defense-in-depth against XSS-shaped link content.
 *   - `linkifyjs` custom-protocol registration in `onCreate` (with `reset()`
 *     in `onDestroy`) so callers can extend recognized URL schemes via
 *     `options.protocols` without calling `registerCustomProtocol` directly.
 */
import type { PasteRuleMatch } from "@tiptap/core";
import { Mark, markPasteRule, mergeAttributes } from "@tiptap/core";
import type { Plugin } from "@tiptap/pm/state";
import { find, registerCustomProtocol, reset } from "linkifyjs";
// constants
import { CORE_EXTENSIONS } from "@/constants/extension";
// helpers
import { isValidHttpUrl } from "@/helpers/common";
// local imports
import { autolink } from "./helpers/autolink";
import { clickHandler } from "./helpers/clickHandler";
import { pasteHandler } from "./helpers/pasteHandler";

type LinkProtocolOptions = {
  scheme: string;
  optionalSlashes?: boolean;
};

type LinkOptions = {
  /**
   * If enabled, it adds links as you type.
   */
  autolink: boolean;
  /**
   * An array of custom protocols to be registered with linkifyjs.
   */
  protocols: Array<LinkProtocolOptions | string>;
  /**
   * If enabled, links will be opened on click.
   */
  openOnClick: boolean;
  /**
   * If enabled, links will be inclusive i.e. if you move your cursor to the
   * link text, and start typing, it'll be a part of the link itself.
   */
  inclusive: boolean;
  /**
   * Adds a link to the current selection if the pasted content only contains an url.
   */
  linkOnPaste: boolean;
  /**
   * A list of HTML attributes to be rendered.
   */
  HTMLAttributes: Record<string, unknown>;
  /**
   * A validation function that modifies link verification for the auto linker.
   * @param url - The url to be validated.
   * @returns - True if the url is valid, false otherwise.
   */
  validate?: (url: string) => boolean;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    [CORE_EXTENSIONS.CUSTOM_LINK]: {
      /**
       * Set a link mark
       */
      setLink: (attributes: {
        href: string;
        target?: string | null;
        rel?: string | null;
        class?: string | null;
      }) => ReturnType;
      /**
       * Toggle a link mark
       */
      toggleLink: (attributes: {
        href: string;
        target?: string | null;
        rel?: string | null;
        class?: string | null;
      }) => ReturnType;
      /**
       * Unset a link mark
       */
      unsetLink: () => ReturnType;
    };
  }
  interface Storage {
    [CORE_EXTENSIONS.CUSTOM_LINK]: CustomLinkStorage;
  }
}

/**
 * Editor storage slot installed at `editor.storage[CORE_EXTENSIONS.CUSTOM_LINK]`
 * (i.e. `editor.storage.link`, since `CUSTOM_LINK` resolves to `"link"`).
 *
 * Consumed by Plane's bubble-menu link selector UI rendered outside this
 * extension. `addStorage` is the only place this extension writes the slice;
 * the bubble-menu components own every subsequent read and write.
 *
 * - `isPreviewOpen` — bubble-menu link-preview popover visibility flag
 *   (read/written by UI components when the user hovers an existing link).
 * - `isBubbleMenuOpen` — bubble-menu link-editor visibility flag
 *   (read/written by UI components when the user opens the link editor).
 * - `posToInsert` — `{ from, to }` document range the bubble menu targets
 *   when applying a link to a saved selection.
 */
export type CustomLinkStorage = {
  isPreviewOpen: boolean;
  posToInsert: { from: number; to: number };
  isBubbleMenuOpen: boolean;
};

/**
 * Plane custom-link mark — API-compatible reimplementation of
 * `@tiptap/extension-link`.
 *
 * Mark identity:
 *   - Name: `CORE_EXTENSIONS.CUSTOM_LINK` resolves to the string `"link"`
 *     (see `packages/editor/src/core/constants/extension.ts`). This matches
 *     upstream `@tiptap/extension-link`'s default mark name, so HTML and
 *     stored ProseMirror documents authored against upstream's link mark
 *     round-trip through this mark without schema migration.
 *   - `priority: 1000` — high priority so the link mark resolves at the
 *     front of the plugin chain for bubble-menu coordination.
 *   - `keepOnSplit: false` — the link mark does NOT extend onto new blocks
 *     created by a block-level split (e.g., pressing Enter inside a link).
 *
 * Attributes (from `addAttributes`):
 *   - `href` — the URL (default `null`).
 *   - `target` — defaults to `options.HTMLAttributes.target` (`"_blank"`).
 *   - `rel` — defaults to `options.HTMLAttributes.rel`
 *     (`"noopener noreferrer nofollow"`; `nofollow` signals to search
 *     engines not to follow user-content links — anti-spam measure).
 *   - `class` — defaults to `options.HTMLAttributes.class` (Plane
 *     design-system link styling: `text-accent-secondary` underline,
 *     hover transition, cursor pointer).
 *
 * Composes three in-repo ProseMirror plugins via `addProseMirrorPlugins`,
 * each individually gated by an option so editor variants can compose
 * subsets (e.g., a lite-text comment input can disable autolink while
 * keeping click-to-open):
 *   - `autolink` (from `./helpers/autolink`, gated by `options.autolink`)
 *     — detects URLs in `appendTransaction` as the user types and applies
 *     the link mark. Honors a `preventAutolink` transaction-meta opt-out.
 *   - `clickHandler` (from `./helpers/clickHandler`, gated by
 *     `options.openOnClick`) — on primary-button clicks, climbs the DOM
 *     for an `<a>` ancestor and opens its `href` via
 *     `window.open(href, target)`.
 *   - `pasteHandler` (from `./helpers/pasteHandler`, gated by
 *     `options.linkOnPaste`) — when the clipboard text is exactly a
 *     single URL and the selection is non-empty, applies the link mark
 *     to the selection (distinct from the URL-substring-detecting
 *     `markPasteRule` registered in `addPasteRules`).
 *
 * Exposes (carried over from `@tiptap/extension-link`):
 *   - Commands `setLink(attrs)`, `toggleLink(attrs)`, `unsetLink()` with
 *     upstream-equivalent signatures and semantics.
 *   - `link` mark serialization to `<a href rel target class>` HTML.
 *   - A `markPasteRule` (via `addPasteRules`) that linkifies URL
 *     substrings inside larger pasted text, using `linkifyjs.find`.
 *   - Options `autolink`, `openOnClick`, `linkOnPaste`, `inclusive`,
 *     `protocols`, `validate` mirroring the upstream option contract.
 *
 * Overrides (vs. `@tiptap/extension-link`):
 *   - `autolink`, `clickHandler`, `pasteHandler` plugins are reimplemented
 *     in `./helpers/*` rather than reusing the upstream bundle. WHY: the
 *     split into three files lets editor variants disable plugins
 *     individually via the three boolean options.
 *   - All three commands stamp `setMeta("preventAutolink", true)` on every
 *     transaction they emit. WHY: prevents the `autolink` plugin's
 *     `appendTransaction` from re-processing changes already produced by
 *     an explicit link command — otherwise the autolink plugin could
 *     re-trigger on the just-applied mark, producing duplicate/recursive
 *     mark application.
 *   - `parseHTML.getAttrs` rejects (returns `false`) `<a>` whose `href`
 *     starts with `javascript:`, `data:`, or `vbscript:`; `renderHTML`
 *     blanks the href for the same protocols. WHY: defense in depth —
 *     the parse-time check stops dangerous HTML from entering the doc,
 *     and the render-time check stops dangerous HTML from leaving it
 *     even when a mark was created programmatically (skipping `parseHTML`).
 *   - Default `HTMLAttributes` carry Plane design-system link styling
 *     (`text-accent-secondary` underline + hover transitions) not present
 *     in upstream defaults.
 *
 * Hides (vs. `@tiptap/extension-link`):
 *   - Upstream's bundled `clickHandler`, `autolink`, and `pasteHandler`
 *     plugins are not used — Plane's helpers take over wholesale. Mixing
 *     upstream click handling with Plane's bubble-menu UX is not
 *     supported.
 *   - Direct `linkifyjs.registerCustomProtocol` access is not part of the
 *     wrapper API; protocols are registered automatically from
 *     `options.protocols` in `onCreate` and cleared via `reset()` in
 *     `onDestroy`.
 *
 * Editor storage (`CustomLinkStorage` at `editor.storage.link`): see the
 * `CustomLinkStorage` type JSDoc above for the three flags consumed by
 * the bubble-menu link selector UI.
 *
 * WHY the click-handler override matters (CRITICAL ARCHITECTURAL DECISION):
 *   Plane owns link UX as first-party code. The click handler opens links
 *   via `window.open(href, target)` (typically `_blank`) so a click on a
 *   link inside the editor never navigates the editor view away.
 *   Combined with the bubble-menu link selector orchestrated externally
 *   via `CustomLinkStorage`, this forms the Plane link interaction
 *   pattern: clicks open the link (new tab) and the bubble menu edits
 *   the link (in-place). Removing the click-handler override would
 *   regress this pattern by falling back to whatever default link
 *   behavior the editor view permits — DO NOT remove without
 *   understanding the bubble-menu interaction it pairs with.
 *
 * Module augmentation (see `declare module "@tiptap/core"` above):
 *   registers the `CORE_EXTENSIONS.CUSTOM_LINK` namespace on TipTap's
 *   `Commands` and `Storage` interfaces so consumers get typed access to
 *   `editor.commands.setLink({ href })` etc. and to `editor.storage.link`
 *   as `CustomLinkStorage`.
 */
export const CustomLinkExtension = Mark.create<LinkOptions, CustomLinkStorage>({
  name: CORE_EXTENSIONS.CUSTOM_LINK,

  priority: 1000,

  keepOnSplit: false,

  onCreate() {
    this.options.protocols.forEach((protocol) => {
      if (typeof protocol === "string") {
        registerCustomProtocol(protocol);
        return;
      }
      registerCustomProtocol(protocol.scheme, protocol.optionalSlashes);
    });
  },

  onDestroy() {
    reset();
  },

  inclusive() {
    return this.options.inclusive;
  },

  addOptions() {
    return {
      openOnClick: true,
      linkOnPaste: true,
      autolink: true,
      inclusive: false,
      protocols: ["http", "https"],
      HTMLAttributes: {
        target: "_blank",
        rel: "noopener noreferrer nofollow",
        class:
          "text-accent-secondary underline underline-offset-[3px] hover:text-accent-primary transition-colors cursor-pointer",
      },
      validate: (url: string) => isValidHttpUrl(url).isValid,
    };
  },

  addAttributes() {
    return {
      href: {
        default: null,
      },
      target: {
        default: this.options.HTMLAttributes.target,
      },
      rel: {
        default: this.options.HTMLAttributes.rel,
      },
      class: {
        default: this.options.HTMLAttributes.class,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "a[href]",
        getAttrs: (node) => {
          if (typeof node === "string") {
            return null;
          }
          const href = node.getAttribute("href")?.toLowerCase() || "";
          if (href.startsWith("javascript:") || href.startsWith("data:") || href.startsWith("vbscript:")) {
            return false;
          }
          return {};
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const href = HTMLAttributes.href?.toLowerCase() || "";
    if (href.startsWith("javascript:") || href.startsWith("data:") || href.startsWith("vbscript:")) {
      return ["a", mergeAttributes(this.options.HTMLAttributes, { ...HTMLAttributes, href: "" }), 0];
    }
    return ["a", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setLink:
        (attributes) =>
        ({ chain }) =>
          chain().setMark(this.name, attributes).setMeta("preventAutolink", true).run(),

      toggleLink:
        (attributes) =>
        ({ chain }) =>
          chain()
            .toggleMark(this.name, attributes, { extendEmptyMarkRange: true })
            .setMeta("preventAutolink", true)
            .run(),

      unsetLink:
        () =>
        ({ chain }) =>
          chain().unsetMark(this.name, { extendEmptyMarkRange: true }).setMeta("preventAutolink", true).run(),
    };
  },

  addPasteRules() {
    return [
      markPasteRule({
        find: (text) => {
          const foundLinks: PasteRuleMatch[] = [];

          if (text) {
            const links = find(text).filter((item) => item.isLink);

            if (links.length) {
              links.forEach((link) =>
                foundLinks.push({
                  text: link.value,
                  data: {
                    href: link.href,
                  },
                  index: link.start,
                })
              );
            }
          }

          return foundLinks;
        },
        type: this.type,
        getAttributes: (match) => ({
          href: match.data?.href,
        }),
      }),
    ];
  },

  addProseMirrorPlugins() {
    const plugins: Plugin[] = [];

    if (this.options.autolink) {
      plugins.push(
        autolink({
          type: this.type,
          validate: this.options.validate,
        })
      );
    }

    if (this.options.openOnClick) {
      plugins.push(
        clickHandler({
          type: this.type,
        })
      );
    }

    if (this.options.linkOnPaste) {
      plugins.push(
        pasteHandler({
          editor: this.editor,
          type: this.type,
        })
      );
    }

    return plugins;
  },

  addStorage() {
    return {
      isPreviewOpen: false,
      isBubbleMenuOpen: false,
      posToInsert: { from: 0, to: 0 },
    };
  },
});
