/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared sizing and positioning tokens for the modal subsystem.
 *
 * Each enum member maps a semantic name to a Tailwind utility-class string. The tokens
 * are consumed by `ModalCore` (`./modal-core.tsx`) for its `position` and `width` props and
 * forwarded through preset variants such as `AlertModalCore` (`./alert-modal.tsx`).
 * Centralizing them here keeps hardcoded utility strings out of individual modal components.
 */

/**
 * Outer-container flex-alignment tokens applied around the modal panel.
 *
 *  - `TOP` — pins the dialog near the top of the viewport with horizontal centering.
 *  - `CENTER` — vertically and horizontally centers the dialog (the `ModalCore` default).
 */
export enum EModalPosition {
  TOP = "flex items-center justify-center text-center mx-4 my-10 md:my-20",
  CENTER = "flex items-end sm:items-center justify-center p-4 min-h-full",
}

/**
 * Responsive `max-width` tokens applied to the modal `<Dialog.Panel>` at the `sm` breakpoint
 * and above; below `sm` the panel uses `w-full` (set by `ModalCore`).
 *
 * Members mirror Tailwind's `max-w-*` scale:
 *  - `SM` → `sm:max-w-sm`, `MD` → `sm:max-w-md`, `LG` → `sm:max-w-lg`,
 *    `XL` → `sm:max-w-xl`, `XXL` → `sm:max-w-2xl`, `XXXL` → `sm:max-w-3xl`,
 *    `XXXXL` → `sm:max-w-4xl`, `VXL` → `sm:max-w-5xl`, `VIXL` → `sm:max-w-6xl`,
 *    `VIIXL` → `sm:max-w-7xl`.
 *
 * `ModalCore` defaults to `XXL`; `AlertModalCore` defaults to `XL`.
 */
export enum EModalWidth {
  SM = "sm:max-w-sm",
  MD = "sm:max-w-md",
  LG = "sm:max-w-lg",
  XL = "sm:max-w-xl",
  XXL = "sm:max-w-2xl",
  XXXL = "sm:max-w-3xl",
  XXXXL = "sm:max-w-4xl",
  VXL = "sm:max-w-5xl",
  VIXL = "sm:max-w-6xl",
  VIIXL = "sm:max-w-7xl",
}
