/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Popper-anchored floating popover container for tooltip-like contextual UI (not action menus).
 *
 * Composes Headless UI's `Popover` shell with `react-popper`'s `usePopper` positioning so the
 * panel is anchored to a configurable reference element and collision-aware via the
 * `preventOverflow` modifier. Use `<PopoverMenu>` instead when the panel renders a list of
 * actionable menu items.
 */

import { Popover as HeadlessReactPopover, Transition } from "@headlessui/react";
import { EllipsisVertical } from "lucide-react";
import type { Ref } from "react";
import React, { Fragment, useState } from "react";
import { usePopper } from "react-popper";
// helpers
import { cn } from "../utils";
// types
import type { TPopover } from "./types";

/**
 * Anchored floating UI assembling Headless UI's `Popover` shell, `react-popper`'s `usePopper`
 * positioning, and a Headless UI `Transition`-driven entrance/exit animation.
 *
 * The component tracks the reference element (the wrapper around `Popover.Button`) and the
 * panel element via local `useState` refs so Popper can compute placement against viewport
 * collisions through the `preventOverflow` modifier. The default trigger renders a 24×24
 * `EllipsisVertical` icon button; supply a custom `button` node to replace it.
 *
 * Props (see `TPopover` in `./types`):
 *   - `children`: panel contents.
 *   - `button` / `buttonClassName` / `buttonRefClassName` / `popoverButtonRef` / `disabled`: trigger configuration.
 *   - `popperPosition` (default `"bottom-end"`), `popperPadding` (default `0`): Popper placement + collision padding.
 *   - `panelClassName`, `popoverClassName`: extra classes merged AFTER built-in styling so consumer overrides win.
 *
 * Accessibility: Headless UI's `Popover.Button` automatically emits `aria-haspopup="dialog"`
 * and toggles `aria-expanded`; Escape and outside-click close the panel. INTENT UNCLEAR: the
 * default `EllipsisVertical` trigger has no `aria-label`, so screen readers announce it with
 * no accessible name — supply a custom `button` node carrying an explicit label when needed.
 */
export function Popover(props: TPopover) {
  const {
    popperPosition = "bottom-end",
    popperPadding = 0,
    buttonClassName = "",
    popoverClassName = "",
    button,
    disabled = false,
    panelClassName = "",
    children,
    popoverButtonRef,
    buttonRefClassName = "",
  } = props;
  // states
  const [referenceElement, setReferenceElement] = useState<HTMLDivElement | null>(null);
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);

  // react-popper derived values
  const { styles, attributes } = usePopper(referenceElement, popperElement, {
    placement: popperPosition,
    modifiers: [
      {
        name: "preventOverflow",
        options: {
          padding: popperPadding,
        },
      },
    ],
  });

  return (
    <HeadlessReactPopover className={cn("relative flex h-full w-full items-center justify-center", popoverClassName)}>
      <div ref={setReferenceElement} className={cn("w-full", buttonRefClassName)}>
        <HeadlessReactPopover.Button
          ref={popoverButtonRef as Ref<HTMLButtonElement>}
          className={cn(
            {
              "flex h-6 w-6 items-center justify-center rounded-sm bg-surface-2 text-14 transition-all hover:bg-layer-1":
                !button,
            },
            buttonClassName
          )}
          disabled={disabled}
        >
          {button ? button : <EllipsisVertical className="h-3 w-3" />}
        </HeadlessReactPopover.Button>
      </div>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-200"
        enterFrom="opacity-0 translate-y-1"
        enterTo="opacity-100 translate-y-0"
        leave="transition ease-in duration-150"
        leaveFrom="opacity-100 translate-y-0"
        leaveTo="opacity-0 translate-y-1"
      >
        <HeadlessReactPopover.Panel
          ref={setPopperElement}
          style={styles.popper}
          {...attributes.popper}
          className={cn("absolute top-full left-0 z-20 mt-2 w-screen max-w-xs", panelClassName)}
        >
          {children}
        </HeadlessReactPopover.Panel>
      </Transition>
    </HeadlessReactPopover>
  );
}
