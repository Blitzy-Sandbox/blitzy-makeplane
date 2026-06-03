/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Floating-menu hook module for `@plane/editor`.
 *
 * Exports {@link useFloatingMenu}, the reusable React hook that centralizes
 * Floating UI configuration (placement, collision-handling middleware, and
 * interaction handlers) for every floating-menu consumer in the editor's
 * menus surface. Every bubble-menu selector
 * (`../bubble-menu/{node,color,link}-selector.tsx`) consumes this hook to
 * obtain a configured Floating UI controller plus `getReferenceProps` /
 * `getFloatingProps`; the hook owns the open-state visibility for the
 * dropdown and the `FloatingMenuRoot` shell (see `./root`) is rendered with
 * the same `options` controller so trigger and panel share state.
 *
 * TipTap behavior: N/A — this module is TipTap-agnostic. It builds on
 * `@floating-ui/react` primitives (`useFloating`, `useInteractions`,
 * `useDismiss`, `useClick`, `useRole`, `flip`, `shift`, `autoUpdate`) and
 * does not import or extend any TipTap APIs. Keep this layer free of TipTap
 * coupling so it remains reusable for any floating UI need in the editor.
 */

import {
  shift,
  flip,
  useDismiss,
  useFloating,
  useInteractions,
  autoUpdate,
  useClick,
  useRole,
} from "@floating-ui/react";
import type { UseInteractionsReturn, UseFloatingReturn } from "@floating-ui/react";
import { useState } from "react";

/**
 * Arguments accepted by {@link useFloatingMenu}.
 *
 * The optional `handleOpenChange(open)` callback lets consumers observe
 * open/close transitions (e.g. focusing an input on open, persisting state
 * to the URL on close) without owning the state — the hook remains the
 * canonical source of truth for the dropdown's visibility.
 */
type TArgs = {
  handleOpenChange?: (open: boolean) => void;
};

/**
 * Return contract for {@link useFloatingMenu}.
 *
 * Spread `getReferenceProps()` onto the trigger button and
 * `getFloatingProps()` onto the floating panel; pass `options` (the
 * `UseFloatingReturn` controller) to `FloatingMenuRoot` (see `./root`) so the
 * shell shares interaction state with the hook.
 */
type TReturn = {
  options: UseFloatingReturn;
  getReferenceProps: UseInteractionsReturn["getReferenceProps"];
  getFloatingProps: UseInteractionsReturn["getFloatingProps"];
};

/**
 * Reusable React hook that centralizes Floating UI configuration for editor
 * dropdown menus — placement, collision-handling middleware, and interaction
 * handlers — so every selector in `../bubble-menu/` plus the
 * `FloatingMenuRoot` shell (see `./root`) shares one consistent positioning
 * and dismissal contract.
 *
 * @param args - See {@link TArgs}. The optional `handleOpenChange` callback
 *   is invoked from the internal `onOpenChange` handler so consumers can
 *   observe open/close transitions without owning the state.
 * @returns See {@link TReturn}. Spread `getReferenceProps()` onto the trigger
 *   button and `getFloatingProps()` onto the floating panel; pass `options`
 *   to `FloatingMenuRoot` so the shell shares interaction state with the hook.
 *
 * Side effects:
 * - Owns dropdown open visibility via `useState(false)` — the canonical
 *   source of truth for the menu's open state.
 * - Calls `useFloating` with `placement: "bottom-start"`,
 *   `whileElementsMounted: autoUpdate`, and middleware
 *   `flip({ fallbackPlacements: ["top-start", "bottom-start", "top-end", "bottom-end"] })`
 *   plus `shift({ padding: 8 })`.
 * - Wires `open`/`onOpenChange` to local state; `onOpenChange` updates state
 *   AND forwards to `args.handleOpenChange` when provided.
 * - Creates interaction handlers via `useDismiss(context)`,
 *   `useClick(context)`, and `useRole(context)` (default role `"dialog"` —
 *   no `role` option is passed, so Floating UI's default applies) and merges
 *   them with `useInteractions([dismiss, click, role])`.
 *
 * TipTap behavior: N/A — this hook does not import or reference any TipTap
 * APIs and must stay TipTap-agnostic so it remains reusable for any floating
 * UI need in the editor.
 *
 * Why the fallback placement order: Floating UI tries placements in array
 * order until one fits the viewport. The order is weighted toward
 * bottom-aligned positions first because most editor menus open below their
 * triggers (matches reading order); top-aligned positions are fallbacks for
 * viewport-constrained cases.
 *
 * Why `padding: 8` on `shift`: empirically tuned to keep the panel at least
 * 8px from the viewport edges so it feels comfortable in the editor's
 * typical layout without crowding content.
 *
 * Why `whileElementsMounted: autoUpdate`: the editor's content area is
 * internally scrollable, so the trigger can move while the menu is open;
 * without auto-update the panel would drift away from its trigger as the
 * user scrolls.
 *
 * Why `useState(false)` (no controlled-open argument): consumers needing a
 * controlled open state should bypass this hook entirely and call
 * `useFloating` directly with their own state, keeping this hook's contract
 * intentionally narrow.
 */
export const useFloatingMenu = (args: TArgs): TReturn => {
  const { handleOpenChange } = args;
  // states
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  // floating ui
  const options = useFloating({
    placement: "bottom-start",
    middleware: [
      flip({
        fallbackPlacements: ["top-start", "bottom-start", "top-end", "bottom-end"],
      }),
      shift({
        padding: 8,
      }),
    ],
    open: isDropdownOpen,
    onOpenChange: (open) => {
      setIsDropdownOpen(open);
      handleOpenChange?.(open);
    },
    whileElementsMounted: autoUpdate,
  });
  const { context } = options;
  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss, click, role]);

  return {
    options,
    getReferenceProps,
    getFloatingProps,
  };
};
