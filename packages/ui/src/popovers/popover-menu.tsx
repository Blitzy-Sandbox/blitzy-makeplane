/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Popper-anchored menu variant rendering an interactive list of menu items inside a popover.
 *
 * Builds on top of `<Popover>` and standardizes the panel chrome (width, border, shadow, padding)
 * so callers only have to supply the typed `data` array and a `render(item, index)` function.
 */

import React, { Fragment } from "react";
// components
import { cn } from "../utils";
import { Popover } from "./popover";
// helpers
// types
import type { TPopoverMenu } from "./types";

/**
 * Generic Popper-anchored menu rendered inside a `<Popover>` panel with menu-specific chrome
 * (fixed `w-48` width, rounded border, surface background, raised shadow).
 *
 * Iterates the typed `data: T[]` array via the caller-supplied `render(item, index)` while
 * `keyExtractor(item, index)` produces stable React keys. The component delegates per-item DOM
 * and ARIA emission to the caller, making it suitable for kebab menus, more-actions lists, and
 * any typed action list whose items have a custom shape.
 *
 * Props (see `TPopoverMenu<T>` in `./types`):
 *   - `data`, `keyExtractor`, `render`: required typed-item plumbing.
 *   - `popperPosition` (default `"bottom-end"`), `popperPadding` (default `0`): forwarded Popper config.
 *   - `button`, `buttonClassName`, `popoverButtonRef`, `disabled`: forwarded trigger configuration.
 *   - `panelClassName`: merged AFTER the built-in menu styling so consumer overrides win on conflicting tokens.
 *   - `popoverClassName`: extra classes on the outer Headless UI `Popover` root.
 *
 * Accessibility: trigger semantics (focus, Enter/Space, `aria-haspopup`, `aria-expanded`) are
 * inherited from the underlying `<Popover>`'s Headless UI `Popover.Button`. INTENT UNCLEAR: the
 * component does not apply `role="menu"` to its panel content nor enforce `role="menuitem"` /
 * arrow-key navigation on items — those semantics are the responsibility of `render`.
 */
export function PopoverMenu<T>(props: TPopoverMenu<T>) {
  const {
    popperPosition = "bottom-end",
    popperPadding = 0,
    buttonClassName = "",
    button,
    disabled,
    panelClassName = "",
    data,
    popoverClassName = "",
    keyExtractor,
    render,
    popoverButtonRef,
  } = props;

  return (
    <Popover
      popperPosition={popperPosition}
      popperPadding={popperPadding}
      buttonClassName={buttonClassName}
      button={button}
      disabled={disabled}
      panelClassName={cn(
        "my-1 w-48 rounded-sm border-[0.5px] border-strong bg-surface-1 px-2 py-2 text-11 shadow-raised-200 focus:outline-none",
        panelClassName
      )}
      popoverClassName={popoverClassName}
      popoverButtonRef={popoverButtonRef}
    >
      <Fragment>
        {data.map((item, index) => (
          <Fragment key={keyExtractor(item, index)}>{render(item, index)}</Fragment>
        ))}
      </Fragment>
    </Popover>
  );
}
