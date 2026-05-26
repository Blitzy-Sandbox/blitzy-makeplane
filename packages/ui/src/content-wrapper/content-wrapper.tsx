/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Scrollable full-height content wrapper providing the canonical page-content
 * layout container for `apps/web` route shells.
 *
 * Built on the internal `Row` primitive; layers a fixed flex-column scroll
 * region (`h-full w-full overflow-y-auto`) over the row's horizontal padding
 * contract and adds vertical `py-page-y` padding for the `REGULAR` variant.
 */

import * as React from "react";
import { Row } from "../row";
import type { TRowVariant } from "../row/helper";
import { ERowVariant } from "../row/helper";
import { cn } from "../utils";

export interface ContentWrapperProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: TRowVariant;
  className?: string;
  children: React.ReactNode;
}
const DEFAULT_STYLE = "flex flex-col vertical-scrollbar scrollbar-lg h-full w-full overflow-y-auto";

/**
 * Flex-column layout container that fills available height and enables
 * internal vertical scrolling for long route bodies.
 *
 * Composes the internal `Row` primitive: `Row` supplies horizontal padding
 * per `variant`, and `ContentWrapper` layers `h-full w-full overflow-y-auto`
 * plus `py-page-y` for the `REGULAR` variant. Forwards refs to the underlying
 * `div` rendered by `Row` and spreads all standard `HTMLDivElement` attributes.
 *
 * @param props - Component props.
 * @param props.children - Content rendered inside the scroll region. Required.
 * @param props.variant - Row spacing variant from `ERowVariant`; defaults to
 *   `ERowVariant.REGULAR`. `REGULAR` applies `px-page-x` (via `Row`) and
 *   `py-page-y`; `HUGGING` applies `px-0` and no vertical page padding.
 * @param props.className - Additional class names merged via `cn` after the
 *   base layout classes so callers can override or extend styling.
 * @param ref - Forwarded ref attached to the underlying `HTMLDivElement`.
 *
 * Accessibility: renders a plain `div`; no ARIA role is applied at the
 * wrapper level — the consumer route shell is responsible for landmark
 * roles such as `role="main"`.
 */
// INTENT UNCLEAR: no role="main" applied at wrapper level (relies on consumer's route shell)
const ContentWrapper = React.forwardRef(function ContentWrapper(
  props: ContentWrapperProps,
  ref: React.ForwardedRef<HTMLDivElement>
) {
  const { variant = ERowVariant.REGULAR, className = "", children, ...rest } = props;

  return (
    <Row
      ref={ref}
      variant={variant}
      className={cn(
        DEFAULT_STYLE,
        {
          "py-page-y": variant === ERowVariant.REGULAR,
        },
        className
      )}
      {...rest}
    >
      {children}
    </Row>
  );
});

ContentWrapper.displayName = "plane-ui-wrapper";

export { ContentWrapper };
