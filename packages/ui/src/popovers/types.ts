/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared type contracts for the `popovers` family (`Popover`, `PopoverMenu`).
 *
 * The intersection chain (`TPopoverButtonDefaultOptions` → `TPopoverDefaultOptions` → `TPopover` /
 * `TPopoverMenu<T>`) lets the menu variant inherit every trigger and positioning option from
 * the base popover without re-declaring fields, so prop additions only need to happen once.
 */

import type { Placement } from "@popperjs/core";
import type { MutableRefObject, ReactNode } from "react";

/**
 * Trigger-button configuration shared by every popover variant.
 *
 * Models the four props that control the Headless UI `Popover.Button` rendered as the popover's
 * anchor. The `button` field, when provided, replaces the default `EllipsisVertical` lucide
 * icon trigger entirely — `buttonClassName` is still merged so callers can style either trigger.
 *
 * Fields:
 *   - `button`: optional custom trigger node; when omitted, `<Popover>` renders the default ellipsis button.
 *   - `buttonClassName`: classes merged onto the Headless UI `Popover.Button`.
 *   - `buttonRefClassName`: classes merged onto the reference-element wrapper that Popper measures for placement.
 *   - `disabled`: disables the trigger button (panel cannot be opened while truthy).
 */
export type TPopoverButtonDefaultOptions = {
  // button and button styling
  button?: ReactNode;
  buttonClassName?: string;
  buttonRefClassName?: string;
  disabled?: boolean;
};

/**
 * Full popover configuration: trigger options plus Popper positioning and panel styling hooks.
 *
 * Composes `TPopoverButtonDefaultOptions` with the panel-side options consumed by both `<Popover>`
 * and `<PopoverMenu>`. `popperPosition` accepts the upstream `@popperjs/core` `Placement` union
 * (`"top" | "top-start" | "top-end" | "bottom" | "bottom-start" | "bottom-end" | "right" | ...`)
 * and is forwarded to `usePopper`; `popperPadding` is the `preventOverflow` modifier padding in
 * pixels. `popoverButtonRef` is the imperative handle for the underlying button (e.g., focus
 * management or programmatic open/close coordination from a MobX store action).
 *
 * Fields:
 *   - `popperPosition`: Popper placement; defaults are applied by the component, not the type.
 *   - `popperPadding`: collision-avoidance padding in px.
 *   - `panelClassName`: classes merged onto the `Popover.Panel` AFTER built-in defaults so overrides win.
 *   - `popoverClassName`: classes merged onto the outer Headless UI `Popover` root.
 *   - `popoverButtonRef`: optional imperative ref to the trigger button.
 */
export type TPopoverDefaultOptions = TPopoverButtonDefaultOptions & {
  // popper styling
  popperPosition?: Placement | undefined;
  popperPadding?: number | undefined;
  // panel styling
  panelClassName?: string;
  popoverClassName?: string;
  popoverButtonRef?: MutableRefObject<HTMLButtonElement | null>;
};

/**
 * Prop contract for the base `<Popover>` component.
 *
 * Extends `TPopoverDefaultOptions` with the `children` slot rendered inside the floating
 * `Popover.Panel`. Use this for arbitrary contextual UI (forms, info cards, tooltip-like
 * content); for action lists use `TPopoverMenu<T>` instead.
 */
export type TPopover = TPopoverDefaultOptions & {
  // children
  children: ReactNode;
};

/**
 * Prop contract for the generic `<PopoverMenu<T>>` component.
 *
 * Extends `TPopoverDefaultOptions` with a typed `data: T[]` array plus the `keyExtractor` and
 * `render` callbacks the menu uses to project items into the panel. The generic parameter `T`
 * is consumer-defined; the menu imposes no structural constraint on items.
 *
 * Fields:
 *   - `data`: typed item array iterated to populate the menu panel.
 *   - `keyExtractor`: produces a stable React key per item; called once per render.
 *   - `render`: returns the per-item ReactNode; callers own per-item DOM/ARIA emission
 *     (e.g., `role="menuitem"`, keyboard handlers) because this primitive is item-shape-agnostic.
 */
export type TPopoverMenu<T> = TPopoverDefaultOptions & {
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  render: (item: T, index: number) => ReactNode;
};
