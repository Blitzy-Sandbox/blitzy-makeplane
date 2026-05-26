/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Ref-forwarding anchor wrapper providing controlled-click navigation handoff
 * (typically to React Router) while preserving native anchor semantics.
 */

import * as React from "react";

export type TControlLink = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  onClick: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  children: React.ReactNode;
  target?: string;
  disabled?: boolean;
  className?: string;
  draggable?: boolean;
};

/**
 * Ref-forwarding anchor that intercepts plain left-clicks to hand navigation off
 * to the supplied `onClick` (typically a router `navigate(...)` call) while letting
 * Cmd/Ctrl+left-click fall through to the browser so "open in new tab" still works.
 *
 * When `disabled` is true the component renders a surrogate element without an
 * `href` (focus-suppressing) — preserving layout/styling but removing navigation.
 *
 * Props (see `TControlLink`):
 *   - `href` (required): destination URL bound to the underlying `<a href>` when enabled.
 *   - `onClick` (required): invoked AFTER `preventDefault()` for plain left-clicks;
 *     typical consumer dispatches SPA navigation here.
 *   - `children` (required): rendered link content.
 *   - `target` (optional, default `"_blank"`): native `target` attribute; the default
 *     pairs with the Cmd/Ctrl+click pass-through so new-tab opens go to a new tab.
 *   - `disabled` (optional, default `false`): when true, renders a non-navigable
 *     surrogate (anchor without `href` if a ref/className is present, otherwise a
 *     bare fragment).
 *   - `className` (optional): forwarded to the rendered element.
 *   - `draggable` (optional, default `false`): forwarded to the rendered anchor.
 *   - All other `React.AnchorHTMLAttributes<HTMLAnchorElement>` props spread via `...rest`.
 *
 * Click handling: the handler short-circuits ONLY when `(metaKey || ctrlKey) && button === 0`
 * (Cmd/Ctrl + left-click), letting the browser handle "open in new tab" natively. For plain
 * left-clicks `event.preventDefault()` blocks native navigation and the consumer's `onClick`
 * is invoked instead — this is the SPA-navigation handoff point. Middle- and right-clicks
 * are not bound here and therefore fall through to native behavior unmodified.
 *
 * Accessibility: native anchor semantics (focusable, screen-reader-announced as a link)
 * are preserved in the enabled branch. The disabled branches intentionally drop focusability
 * by omitting `href` (per the HTML spec an `<a>` without `href` is not tab-focusable) or by
 * rendering only children inside a fragment.
 * // INTENT UNCLEAR: disabled branch removes focusability rather than applying aria-disabled
 *
 * Ref: `React.ForwardedRef<HTMLAnchorElement>` — exposes the underlying anchor element to
 * parent components for tooltip anchoring, focus management, and external positioning. When
 * `disabled && (ref || className)`, the ref is still attached to the surrogate `<a>` so
 * parents receive a stable DOM node; when `disabled` with neither ref nor className, only
 * a fragment is rendered and the ref attaches to nothing.
 */
export const ControlLink = React.forwardRef(function ControlLink(
  props: TControlLink,
  ref: React.ForwardedRef<HTMLAnchorElement>
) {
  const { href, onClick, children, target = "_blank", disabled = false, className, draggable = false, ...rest } = props;
  const LEFT_CLICK_EVENT_CODE = 0;

  const handleOnClick = (event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
    const clickCondition = (event.metaKey || event.ctrlKey) && event.button === LEFT_CLICK_EVENT_CODE;
    if (!clickCondition) {
      event.preventDefault();
      onClick(event);
    }
  };

  // if disabled but still has a ref or a className then it has to be rendered without a href
  if (disabled && (ref || className))
    return (
      <a ref={ref} className={className}>
        {children}
      </a>
    );

  // else if just disabled return without the parent wrapper
  if (disabled) return <>{children}</>;

  return (
    <a
      href={href}
      target={target}
      onClick={handleOnClick}
      {...rest}
      ref={ref}
      className={className}
      draggable={draggable}
    >
      {children}
    </a>
  );
});

ControlLink.displayName = "ControlLink";
