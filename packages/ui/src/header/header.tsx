/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Page-header layout primitive supporting slot-based composition for left
 * and right content areas (e.g., breadcrumbs on left, action buttons on right).
 *
 * Exports the `Header` container with attached `Header.LeftItem` and
 * `Header.RightItem` slot subcomponents plus the `EHeaderVariant` enum.
 * A module-scoped React context broadcasts the active variant to the right
 * slot so it can apply variant-specific alignment without prop drilling.
 */

import * as React from "react";
import { ERowVariant, Row } from "../row";
import { cn } from "../utils";
import type { THeaderVariant } from "./helper";
import { EHeaderVariant, getHeaderStyle } from "./helper";

/**
 * Props accepted by the `Header` container and its slot subcomponents
 * (`Header.LeftItem`, `Header.RightItem`).
 *
 * Props:
 * - `variant` (optional, default `EHeaderVariant.PRIMARY`): selects the styling
 *   preset from `headerStyle`/`minHeights` and is broadcast via `HeaderContext`.
 * - `setHeight` (optional, default `true`): when `true`, applies the variant's
 *   minimum-height token (notably the 52px floor for `SECONDARY`).
 * - `className` (optional, default `""`): additional Tailwind classes merged
 *   after the variant base classes via `cn`.
 * - `children` (required): slot content; typically `<Header.LeftItem>` and
 *   `<Header.RightItem>` elements.
 * - `showOnMobile` (optional, default `true`): when `false`, hides the
 *   `SECONDARY` variant below the `md` breakpoint (`hidden md:flex`).
 */
export interface HeaderProps {
  variant?: THeaderVariant;
  setHeight?: boolean;
  className?: string;
  children: React.ReactNode;
  showOnMobile?: boolean;
}

/**
 * Module-scoped React context that carries the active header `variant` to
 * descendants. Set by `Header` via its `Provider`; read by `Header.RightItem`
 * to apply variant-specific alignment (e.g., `items-baseline` for `TERNARY`).
 * Default `null` indicates "not rendered inside a `Header`".
 */
const HeaderContext = React.createContext<THeaderVariant | null>(null);

/**
 * Slot-based page-header container that wraps children in a `Row` with
 * variant-aware density (`HUGGING` for `PRIMARY`, `REGULAR` otherwise) and a
 * class string composed via `getHeaderStyle`. Broadcasts the active variant
 * through `HeaderContext` so `Header.RightItem` can read it without prop drilling.
 *
 * @example
 * <Header variant={EHeaderVariant.PRIMARY}>
 *   <Header.LeftItem>{breadcrumbs}</Header.LeftItem>
 *   <Header.RightItem>{actions}</Header.RightItem>
 * </Header>
 */
function Header(props: HeaderProps) {
  const {
    variant = EHeaderVariant.PRIMARY,
    className = "",
    showOnMobile = true,
    setHeight = true,
    children,
    ...rest
  } = props;

  const style = getHeaderStyle(variant, setHeight, showOnMobile);
  return (
    <HeaderContext.Provider value={variant}>
      <Row
        variant={variant === EHeaderVariant.PRIMARY ? ERowVariant.HUGGING : ERowVariant.REGULAR}
        className={cn(style, className)}
        {...rest}
      >
        {children}
      </Row>
    </HeaderContext.Provider>
  );
}

/**
 * Left-aligned slot for header lead content (e.g., breadcrumbs, page titles).
 * Constrains to 80% max-width and applies `overflow-ellipsis whitespace-nowrap`
 * so long titles truncate rather than push the right slot off-screen. Consumes
 * only the `className` and `children` props from `HeaderProps`; other props
 * are ignored. Accessed by consumers as `Header.LeftItem`.
 */
function LeftItem(props: HeaderProps) {
  return (
    <div
      className={cn(
        "flex max-w-[80%] flex-grow flex-wrap items-center gap-2 overflow-ellipsis whitespace-nowrap",
        props.className
      )}
    >
      {props.children}
    </div>
  );
}

/**
 * Right-aligned slot for header actions (e.g., buttons, dropdowns, dropdowns
 * triggers). Reads the active variant from `HeaderContext` and applies
 * `items-baseline` for the `TERNARY` variant so wrapped action labels align
 * along their text baseline. Includes a defensive guard against use outside
 * a `Header`. Accessed by consumers as `Header.RightItem`.
 */
function RightItem(props: HeaderProps) {
  const variant = React.useContext(HeaderContext);
  if (variant === undefined) throw new Error("RightItem must be used within Header");
  return (
    <div
      className={cn(
        "flex w-auto items-center justify-end gap-2",
        {
          "items-baseline": variant === EHeaderVariant.TERNARY,
        },
        props.className
      )}
    >
      {props.children}
    </div>
  );
}

Header.LeftItem = LeftItem;
Header.RightItem = RightItem;
Header.displayName = "plane-ui-header";

export { Header, EHeaderVariant };
