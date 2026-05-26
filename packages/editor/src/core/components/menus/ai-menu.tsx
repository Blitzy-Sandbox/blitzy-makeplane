/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `AIFeaturesMenu` — UI bridge that surfaces the editor's block-level AI menu inside the `@plane/editor` TipTap wrapper.
 *
 * The component anchors a manual `tippy.js` popup to the editor's `#ai-handle` element (rendered block-level by the
 * side-menu extension) and renders whatever React content the consumer supplies via the `aiHandler.menu` callback
 * contract (`TAIHandler["menu"]` from `@/types`).
 *
 * This is the only menu component in this directory that directly imports `tippy.js`; the surrounding floating-UI
 * primitives in `menus/` use `@floating-ui/react`. The exception exists because the AI handle is block-level
 * (not selection-level), so the popup uses tippy's `appendTo: () => document.querySelector(".frame-renderer")`
 * to attach inside the editor frame and inherit its stacking context, theme tokens, and CSS variables — rather
 * than positioning at the selection cursor.
 *
 * Consumer surface: only the document-editor variant under `editors/document/` opts into AI features and mounts
 * this component; lite-text and rich-text variants do not.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import tippy from "tippy.js";
import type { Instance } from "tippy.js";
// plane utils
import { cn } from "@plane/utils";
// types
import type { TAIHandler } from "@/types";

type Props = {
  menu: TAIHandler["menu"];
};

/**
 * Floating AI features popup anchored to the editor's block-level `#ai-handle` DOM element; renders whatever
 * React content the consumer supplies through the `aiHandler.menu` callback owned by the editor's AI extension.
 *
 * Props: see local {@link Props} (forwarded `TAIHandler["menu"]` from `@/types`). The `menu` callback receives
 * `{ isOpen, onClose }` and returns `React.ReactNode` — the single integration point through which consumers
 * inject AI UI (e.g., generation prompts, model selection, output preview).
 *
 * Side effects:
 * - On mount, detaches `menuRef.current` from its initial DOM position so tippy can own the content node, then
 *   constructs a manual `tippy(document.body, ...)` (`Instance` from `tippy.js`) with `trigger: "manual"`,
 *   `interactive: true`, `arrow: false`, `placement: "bottom-start"`, `animation: "shift-away"`,
 *   `hideOnClick: true`, `appendTo: () => document.querySelector(".frame-renderer")`, and
 *   `onShown: () => menuRef.current?.focus()` so the menu is keyboard-targetable the moment it appears.
 * - On unmount, destroys the tippy instance and nulls the ref so the popup's DOM reference can be GC'd.
 * - Installs document-level `click`, `contextmenu`, and `keydown` listeners: opening is gated on
 *   `target.matches("#ai-handle") || menuRef.current?.contains(e.target as Node)`, so clicks elsewhere
 *   dismiss the popup, and any keydown also dismisses.
 * - Renders a fixed full-screen overlay (`z-10`, `inset-0`) that is `pointer-events-none` while closed (so the
 *   editor underneath stays interactive) and `pointer-events-auto` while open (so the document-level dismiss
 *   handler captures outside clicks reliably without conflicting with TipTap's own click-to-blur logic).
 *
 * TipTap behavior:
 * - Exposes the `TAIHandler["menu"]` callback to the editor's AI extension; the extension invokes this menu
 *   whenever the AI handle is interacted with.
 * - Overrides the standard menu-placement convention (bubble menus anchor at the current selection's bounding
 *   rect) by anchoring instead to the dedicated `#ai-handle` element via a dynamic `getReferenceClientRect`.
 * - Hides TipTap's default bubble-menu invocation pathway for AI: the menu is deliberately block-level because
 *   AI generation operates on the surrounding block context rather than on inline marks.
 *
 * Behavior notes (why the code looks the way it does):
 * - The `@ts-expect-error - Tippy types are incorrect` annotation is required because `tippy.js` v6's `Target`
 *   generic does not list `document.body` as a valid argument, even though the runtime accepts it; this is the
 *   canonical workaround.
 * - `getReferenceClientRect: null` is set at construction (tippy validates the field's presence then) and
 *   re-bound to a real `() => target.getBoundingClientRect()` only when opening, because the actual reference
 *   is dynamic per `#ai-handle` interaction.
 * - The `menuRef.current.remove()` + `style.visibility = "visible"` + `content: menuRef.current` sequence is
 *   the standard manual-content-handoff pattern recommended by tippy.js for React-managed content nodes.
 *
 * Consumer surface: mounted by the document-editor variant when `aiHandler` is provided; not mounted by
 * lite-text or rich-text variants.
 */
export function AIFeaturesMenu(props: Props) {
  const { menu } = props;
  // states
  const [isPopupVisible, setIsPopupVisible] = useState(false);
  // refs
  const menuRef = useRef<HTMLDivElement>(null);
  const popup = useRef<Instance | null>(null);

  useEffect(() => {
    if (!menuRef.current) return;

    menuRef.current.remove();
    menuRef.current.style.visibility = "visible";

    // @ts-expect-error - Tippy types are incorrect
    popup.current = tippy(document.body, {
      getReferenceClientRect: null,
      content: menuRef.current,
      appendTo: () => document.querySelector(".frame-renderer"),
      trigger: "manual",
      interactive: true,
      arrow: false,
      placement: "bottom-start",
      animation: "shift-away",
      hideOnClick: true,
      onShown: () => menuRef.current?.focus(),
    });

    return () => {
      popup.current?.destroy();
      popup.current = null;
    };
  }, []);

  const hidePopup = useCallback(() => {
    popup.current?.hide();
    setIsPopupVisible(false);
  }, []);

  useEffect(() => {
    const handleClickAIHandle = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.matches("#ai-handle") || menuRef.current?.contains(e.target as Node)) {
        e.preventDefault();

        if (!isPopupVisible) {
          popup.current?.setProps({
            getReferenceClientRect: () => target.getBoundingClientRect(),
          });
          popup.current?.show();
          setIsPopupVisible(true);
        }
        return;
      }

      hidePopup();
      return;
    };

    document.addEventListener("click", handleClickAIHandle);
    document.addEventListener("contextmenu", handleClickAIHandle);
    document.addEventListener("keydown", hidePopup);

    return () => {
      document.removeEventListener("click", handleClickAIHandle);
      document.removeEventListener("contextmenu", handleClickAIHandle);
      document.removeEventListener("keydown", hidePopup);
    };
  }, [hidePopup, isPopupVisible]);

  return (
    <div
      className={cn("pointer-events-none fixed inset-0 z-10 size-full opacity-0 transition-opacity", {
        "pointer-events-auto opacity-100": isPopupVisible,
      })}
    >
      <div ref={menuRef} className="z-10">
        {menu?.({
          isOpen: isPopupVisible,
          onClose: hidePopup,
        })}
      </div>
    </div>
  );
}
