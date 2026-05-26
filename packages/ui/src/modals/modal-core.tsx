/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Core modal container built on `@headlessui/react` `Dialog` + `Transition`.
 *
 * Provides a unified modal contract for the `@plane/ui` design system: focus trap on
 * open, focus restoration on close, Escape-to-close, click-outside (backdrop) to close,
 * `aria-modal="true"`, animated enter/leave transitions, and a `z-30` stacking context.
 * Specialized variants (e.g., `AlertModalCore` in `./alert-modal.tsx`) compose this shell
 * with their own panel content.
 */

import { Dialog, Transition } from "@headlessui/react";
import React, { Fragment } from "react";
// constants
import { cn } from "../utils";
import { EModalPosition, EModalWidth } from "./constants";
// helpers

type Props = {
  children: React.ReactNode;
  handleClose?: () => void;
  isOpen: boolean;
  position?: EModalPosition;
  width?: EModalWidth;
  className?: string;
};
/**
 * Core modal shell — a `@headlessui/react` `Dialog` wrapper that exposes a unified
 * accessibility + animation contract. Consumers render arbitrary panel content as
 * `children`; specialized variants (e.g., `AlertModalCore` in `./alert-modal.tsx`)
 * compose this shell with their own panel layout.
 *
 * Accessibility (inherited from HeadlessUI `Dialog`):
 *  - Focus is trapped inside the dialog on open and restored to the previously focused
 *    element on close.
 *  - Pressing Escape invokes the `onClose` handler.
 *  - Clicking the backdrop (outside the panel) invokes the `onClose` handler.
 *  - HeadlessUI sets `aria-modal="true"` on the panel, which acts as the dialog role
 *    container.
 *
 * The dialog uses `z-30` for stacking. If `handleClose` is omitted the dismissal
 * channels (Escape, backdrop click) become no-ops via the `handleClose && handleClose()`
 * guard — intentional for forced-modal scenarios where dismissal must be driven by
 * caller-controlled UI inside `children` only.
 *
 * @param props - Component props (see fields below).
 * @param props.children - Required `ReactNode` rendered inside the `<Dialog.Panel>`.
 * @param props.handleClose - Optional dismiss callback wired to Escape and backdrop
 *   click; when omitted both channels no-op.
 * @param props.isOpen - Required boolean controlling visibility via `Transition.Root`'s
 *   `show` prop; toggles the enter/leave animations.
 * @param props.position - Optional `EModalPosition` controlling outer flex alignment.
 *   Defaults to `EModalPosition.CENTER`.
 * @param props.width - Optional `EModalWidth` applied as the `max-width` token on the
 *   panel. Defaults to `EModalWidth.XXL`.
 * @param props.className - Optional extra class names merged onto the `<Dialog.Panel>`
 *   via `cn(...)`. Defaults to `""`.
 */
export function ModalCore(props: Props) {
  const {
    children,
    handleClose,
    isOpen,
    position = EModalPosition.CENTER,
    width = EModalWidth.XXL,
    className = "",
  } = props;

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-30" onClose={() => handleClose && handleClose()}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-backdrop transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-30 overflow-y-auto">
          <div className={position}>
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel
                className={cn(
                  "relative w-full transform rounded-lg bg-surface-1 text-left shadow-raised-200 transition-all",
                  width,
                  className
                )}
              >
                {children}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
