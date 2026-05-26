/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Form-field scaffolding primitives composing label, field, and inline validation messaging
 * into a unified vertical layout.
 *
 * Exports three primitives:
 *   - `Label`: semantic `<label htmlFor=...>` styled with design-token typography.
 *   - `FormField`: vertical group wrapping a `Label` + arbitrary input children, with optional "(optional)" annotation.
 *   - `ValidationMessage`: inline `<p>` for error or success feedback below a field.
 *
 * These primitives are composed by higher-level surfaces (e.g., `apps/web/core/components/...`
 * forms) and pair naturally with `Input`, `TextArea`, `Checkbox`, and `PasswordInput` from this
 * same `form-fields` package.
 */

import React from "react";
import { cn } from "@plane/utils";

// Reusable Label Component
interface LabelProps {
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Semantic `<label>` styled with the design system's `text-13 font-medium` typography token.
 *
 * Props (see local `LabelProps`):
 *   - `htmlFor` (required): id of the associated form control — drives screen-reader label
 *     association and click-to-focus behavior.
 *   - `children` (required): label text or composed nodes.
 *   - `className`: optional Tailwind override merged onto the label.
 *
 * Accessibility: native `<label htmlFor>` association — clicking the label focuses the
 * referenced input, and assistive tech announces the label text when the control receives focus.
 */
export function Label({ htmlFor, children, className }: LabelProps) {
  return (
    <label htmlFor={htmlFor} className={cn("block text-13 font-medium text-primary", className)}>
      {children}
    </label>
  );
}

// Reusable Form Field Component
interface FormFieldProps {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
  optional?: boolean;
}

/**
 * Vertical grouping that pairs a `Label` with one or more form-control children and an
 * optional "(optional)" annotation, standardizing field spacing across the design system.
 *
 * Props (see local `FormFieldProps`):
 *   - `label` (required): text rendered inside the `Label`.
 *   - `htmlFor` (required): forwarded to the inner `Label` for accessible association.
 *   - `children` (required): the input control(s) that this label describes (typically `Input`,
 *     `TextArea`, `Checkbox`, etc.).
 *   - `optional` (default `false`): when true, appends " (optional)" suffix to the label using
 *     muted typography — used to signal non-required fields without cluttering required ones.
 *   - `className`: optional Tailwind override merged onto the outer `<div>`.
 *
 * Accessibility: the inner `Label` carries the `htmlFor` association; consumers must ensure
 * the wrapped input element's `id` matches.
 */
export function FormField({ label, htmlFor, children, className, optional = false }: FormFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {optional && <span className="text-13 text-placeholder"> (optional)</span>}
      </Label>
      {children}
    </div>
  );
}

// Reusable Validation Message Component
interface ValidationMessageProps {
  type: "error" | "success";
  message: string;
  className?: string;
}

/**
 * Inline validation feedback paragraph rendered below a form control, colored by feedback type.
 *
 * Props (see local `ValidationMessageProps`):
 *   - `type` (required): `"error"` paints `text-danger-primary`; `"success"` paints
 *     `text-success-primary` — the only two states supported.
 *   - `message` (required): user-facing feedback text.
 *   - `className`: optional Tailwind override.
 *
 * Accessibility: INTENT UNCLEAR: no `role="alert"` or `aria-live="polite"` is applied, so
 * screen readers do not announce the message when it appears or changes. Callers needing
 * accessible inline validation should wrap with `aria-describedby` from the related input or
 * add their own live-region semantics.
 */
export function ValidationMessage({ type, message, className }: ValidationMessageProps) {
  return (
    <p
      className={cn(
        "text-13",
        {
          "text-danger-primary": type === "error",
          "text-success-primary": type === "success",
        },
        className
      )}
    >
      {message}
    </p>
  );
}
