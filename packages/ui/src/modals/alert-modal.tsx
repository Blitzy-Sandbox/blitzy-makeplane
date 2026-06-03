/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Preset alert/confirmation modal used for destructive or confirmation flows across Plane
 * (delete project, archive cycle, leave workspace, remove member, etc.).
 *
 * Composes `ModalCore` (the underlying HeadlessUI `Dialog` wrapper from `./modal-core`)
 * with a fixed layout — leading icon + title + body content + secondary/primary button bar
 * — and exposes variant-driven styling via `TModalVariant` (`"danger" | "primary"`).
 *
 * Accessibility (focus trap on open, focus restoration on close, Escape closes,
 * `aria-modal="true"`, click-outside on the backdrop closes) is inherited from
 * `ModalCore` / HeadlessUI `Dialog` and is intentionally not re-implemented here.
 */

import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Info } from "lucide-react";
import React from "react";
// components
import type { TButtonVariant } from "@plane/propel/button";
import { Button } from "@plane/propel/button";
import { cn } from "../utils";
import { EModalPosition, EModalWidth } from "./constants";
import { ModalCore } from "./modal-core";
// constants
// helpers

/**
 * Visual variant discriminant for `AlertModalCore` — selects between a destructive
 * (`"danger"`) and a non-destructive informational (`"primary"`) presentation. Drives the
 * icon (`AlertTriangle` vs `Info`), the primary-button color (`error-fill` vs `primary`),
 * and the icon background class.
 */
export type TModalVariant = "danger" | "primary";

type Props = {
  content: React.ReactNode | string;
  handleClose: () => void;
  handleSubmit: () => void;
  hideIcon?: boolean;
  isSubmitting: boolean;
  isOpen: boolean;
  position?: EModalPosition;
  primaryButtonText?: {
    loading: string;
    default: string;
  };
  secondaryButtonText?: string;
  title: string;
  variant?: TModalVariant;
  width?: EModalWidth;
  customIcon?: React.ReactNode;
};

/**
 * Variant-keyed presentation tables for `AlertModalCore`. Co-varying — any change to the
 * `TModalVariant` discriminant must keep `VARIANT_ICONS`, `BUTTON_VARIANTS`, and
 * `VARIANT_CLASSES` in lockstep so every variant has a defined icon, button color, and
 * background class. Intentionally module-local; not exported.
 */
const VARIANT_ICONS: Record<TModalVariant, LucideIcon> = {
  danger: AlertTriangle,
  primary: Info,
};

const BUTTON_VARIANTS: Record<TModalVariant, TButtonVariant> = {
  danger: "error-fill",
  primary: "primary",
};

const VARIANT_CLASSES: Record<TModalVariant, string> = {
  danger: "bg-danger-subtle text-danger-primary",
  primary: "bg-accent-primary/20 text-accent-primary",
};

/**
 * Preset alert/confirmation modal. Composes `ModalCore` with a fixed icon + title + body
 * layout and a secondary/primary button bar; used for destructive (delete, archive,
 * remove, leave) or confirmation flows throughout Plane.
 *
 * Accessibility is inherited from `ModalCore` / HeadlessUI `Dialog`: focus trap on open,
 * focus restoration on close, Escape closes, click on the backdrop closes,
 * `aria-modal="true"`. The primary `<Button>` carries `tabIndex={1}` so keyboard focus
 * lands on the primary action after HeadlessUI's initial focus pass; the leading icon
 * span is marked `aria-hidden="true"` because it is decorative.
 *
 * @param props - Component props (see fields below).
 * @param props.content - Body text or arbitrary `ReactNode` rendered below the title.
 * @param props.handleClose - Required close callback invoked on Escape, backdrop click, or the secondary ("Cancel") button.
 * @param props.handleSubmit - Required confirm callback invoked when the primary action button is clicked.
 * @param props.hideIcon - Optional; when `true` the leading icon span is omitted. Defaults to `false`.
 * @param props.isSubmitting - When `true`, the primary button enters its loading state and renders `primaryButtonText.loading`.
 * @param props.isOpen - Controls modal visibility; forwarded to `ModalCore`.
 * @param props.position - Optional `EModalPosition`; forwarded to `ModalCore`. Defaults to `EModalPosition.CENTER`.
 * @param props.primaryButtonText - Optional `{ loading, default }` labels for the primary button (loading label shown while `isSubmitting`). Defaults to `{ loading: "Deleting", default: "Delete" }`.
 * @param props.secondaryButtonText - Optional label for the cancel button. Defaults to `"Cancel"`.
 * @param props.title - Required heading rendered as an `<h3>` above the content.
 * @param props.variant - Optional `TModalVariant`; selects icon, primary button color, and icon background. Defaults to `"danger"`.
 * @param props.width - Optional `EModalWidth`; forwarded to `ModalCore`. Defaults to `EModalWidth.XL`.
 * @param props.customIcon - Optional `ReactNode` rendered in place of the variant icon (only when `hideIcon` is `false`).
 */
export function AlertModalCore(props: Props) {
  const {
    content,
    handleClose,
    handleSubmit,
    hideIcon = false,
    isSubmitting,
    isOpen,
    position = EModalPosition.CENTER,
    primaryButtonText = {
      loading: "Deleting",
      default: "Delete",
    },
    secondaryButtonText = "Cancel",
    title,
    variant = "danger",
    width = EModalWidth.XL,
    customIcon,
  } = props;

  const Icon = VARIANT_ICONS[variant];

  return (
    <ModalCore isOpen={isOpen} handleClose={handleClose} position={position} width={width}>
      <div className="flex flex-col items-center gap-4 p-5 sm:flex-row sm:items-start">
        {!hideIcon && (
          <span
            className={cn(
              "grid size-12 flex-shrink-0 place-items-center rounded-full sm:size-10",
              VARIANT_CLASSES[variant]
            )}
          >
            {customIcon ? <>{customIcon}</> : <Icon className="size-5" aria-hidden="true" />}
          </span>
        )}
        <div className="text-center sm:text-left">
          <h3 className="text-16 font-medium">{title}</h3>
          <p className="mt-1 text-13 text-secondary">{content}</p>
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t-[0.5px] border-subtle px-5 py-4 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={handleClose}>
          {secondaryButtonText}
        </Button>
        <Button variant={BUTTON_VARIANTS[variant]} tabIndex={1} onClick={handleSubmit} loading={isSubmitting}>
          {isSubmitting ? primaryButtonText.loading : primaryButtonText.default}
        </Button>
      </div>
    </ModalCore>
  );
}
