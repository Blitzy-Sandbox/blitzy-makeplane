/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Floating-menu shell module for `@plane/editor`.
 *
 * Exports {@link FloatingMenuRoot}, the structural React shell used by every
 * dropdown-style menu in the editor's menus surface — `../bubble-menu/`
 * `node-selector.tsx`, `color-selector.tsx`, and `link-selector.tsx` all
 * compose this shell with the `useFloatingMenu` hook (see
 * `./use-floating-menu`) so the trigger button and floating panel share one
 * Floating UI controller. Any consumer needing an accessible,
 * portal-rendered floating panel anchored to a trigger button should reuse
 * this shell rather than reimplementing the wiring.
 *
 * TipTap behavior: N/A — this module is TipTap-agnostic infrastructure built
 * directly on `@floating-ui/react`. It does NOT import, wrap, or extend any
 * TipTap APIs; it is consumed BY TipTap-wrapping selectors that surface
 * formatting commands. Keep this layer free of TipTap coupling so it
 * remains reusable for any floating UI need in the editor.
 */

import { FloatingOverlay, FloatingPortal } from "@floating-ui/react";
import type { UseInteractionsReturn, UseFloatingReturn } from "@floating-ui/react";

/**
 * Prop contract for {@link FloatingMenuRoot}.
 *
 * `children` is the floating panel content; `menuButton` is the trigger
 * button content. `getFloatingProps` and `getReferenceProps` are the
 * `UseInteractionsReturn` getters sourced from `useFloatingMenu` (see
 * `./use-floating-menu`), and `options` is the `UseFloatingReturn`
 * controller from the same hook — passing all three through together is
 * what keeps the trigger and panel in a single Floating UI session.
 * `classNames.buttonContainer` and `classNames.button` style the trigger's
 * wrapper element and the trigger button respectively. `onClick` is
 * forwarded to the trigger button AFTER the open-state toggle so consumers
 * can observe button clicks (e.g. for telemetry) without intercepting the
 * menu's open/close behavior.
 */
type Props = {
  children: React.ReactNode;
  classNames?: {
    buttonContainer?: string;
    button?: string;
  };
  getFloatingProps: UseInteractionsReturn["getFloatingProps"];
  getReferenceProps: UseInteractionsReturn["getReferenceProps"];
  menuButton: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  options: UseFloatingReturn;
};

/**
 * Structural shell that anchors a trigger button to a floating panel via
 * Floating UI. When the menu is open, the panel is rendered through
 * `FloatingPortal` and stacked above a `FloatingOverlay` backdrop
 * (`lockScroll: true`) so the background cannot scroll while the menu is
 * visible.
 *
 * Props (see {@link Props}):
 * - `children` — the floating panel content.
 * - `menuButton` — the trigger button content.
 * - `getFloatingProps`, `getReferenceProps` — interaction prop getters from
 *   `useFloatingMenu`; spread onto the floating panel and trigger.
 * - `options` — the `UseFloatingReturn` controller; `refs`, `floatingStyles`,
 *   and `context` are destructured here.
 * - `classNames` (optional) — `buttonContainer` and `button` class names.
 * - `onClick` (optional) — forwarded to the trigger button AFTER toggling
 *   open state via `context.onOpenChange(!context.open)`.
 *
 * Side effects:
 * - Binds the trigger to the Floating UI reference via `refs.setReference`.
 * - Merges interaction handlers onto the trigger via `getReferenceProps()`.
 * - Toggles open state on trigger click via `context.onOpenChange(!context.open)`,
 *   then forwards the event to `onClick` if provided.
 * - Renders the panel into `FloatingPortal` and stacks it above the overlay
 *   (`zIndex: 100` on the panel vs `zIndex: 99` on the overlay).
 *
 * TipTap behavior: N/A — this component does not import or reference any
 * TipTap APIs. Do not add TipTap-specific assumptions here; this shell
 * must remain reusable for any floating UI need in the editor.
 *
 * Why `lockScroll: true`: the editor's content area is itself scrollable;
 * unanchored background scroll would visually detach the floating panel
 * from its trigger.
 *
 * Why portal rendering: the panel must escape the editor's clipping
 * ancestors (e.g. `overflow: hidden` on the editor container), which
 * would otherwise cut it off.
 *
 * Why `onClick` runs AFTER the open-state toggle: lets consumers observe
 * button clicks for telemetry/analytics without intercepting the menu's
 * open/close behavior.
 */
export function FloatingMenuRoot(props: Props) {
  const { children, classNames, getFloatingProps, getReferenceProps, menuButton, onClick, options } = props;
  // derived values
  const { refs, floatingStyles, context } = options;

  return (
    <>
      <div className={classNames?.buttonContainer}>
        <button
          ref={refs.setReference}
          {...getReferenceProps()}
          type="button"
          className={classNames?.button}
          onClick={(e) => {
            context.onOpenChange(!context.open);
            onClick?.(e);
          }}
        >
          {menuButton}
        </button>
      </div>
      {context.open && (
        <FloatingPortal>
          {/* Backdrop */}
          <FloatingOverlay
            style={{
              zIndex: 99,
            }}
            lockScroll
          />
          <div
            ref={refs.setFloating}
            {...getFloatingProps()}
            style={{
              ...floatingStyles,
              zIndex: 100,
            }}
          >
            {children}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
