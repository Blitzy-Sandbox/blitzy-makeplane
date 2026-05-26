/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Styled checkbox primitive with custom check/indeterminate SVG overlays on top of a native
 * `<input type="checkbox">`.
 */

import * as React from "react";
// helpers
import { cn } from "../utils";

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  containerClassName?: string;
  iconClassName?: string;
  indeterminate?: boolean;
}

/**
 * Ref-forwarding checkbox that overlays brand-styled SVG icons on top of a native
 * `<input type="checkbox">` so the field preserves native form/accessibility semantics while
 * matching the design system's visual language.
 *
 * The native input has `appearance-none` to strip browser chrome; two absolutely-positioned
 * SVGs (a checkmark polyline and a minus path) toggle their `block` class based on `checked`
 * and `indeterminate` to render the appropriate visual.
 *
 * The `indeterminate` prop is a **visual-only** toggle that controls SVG selection — it does
 * NOT set the DOM `indeterminate` property and does NOT emit `aria-checked="mixed"`. Consumers
 * needing strict ARIA conformance for tri-state checkboxes must pass `aria-checked` through
 * `{...rest}`.
 *
 * Props (see local `CheckboxProps` — extends all native input HTML attrs):
 *   - `checked`: controlled checked state.
 *   - `indeterminate` (default `false`): visual minus overlay when true and `checked` is false.
 *   - `disabled`: disables interaction and mutes overlay colors.
 *   - `containerClassName` / `className` / `iconClassName`: scoped Tailwind overrides for the
 *     wrapper, the native input, and the SVG overlays respectively.
 *   - All other props (e.g., `id`, `name`, `onChange`, `aria-*`) pass through to the native input.
 *
 * Accessibility: native checkbox semantics inherited; Space-key toggle and label association
 * work as standard. INTENT UNCLEAR: `aria-checked="mixed"` is not emitted for the indeterminate
 * visual state; the SVG overlay diverges from the announced ARIA state in that case.
 */
const Checkbox = React.forwardRef(function Checkbox(props: CheckboxProps, ref: React.ForwardedRef<HTMLInputElement>) {
  const {
    id,
    name,
    checked,
    indeterminate = false,
    disabled,
    containerClassName,
    iconClassName,
    className,
    ...rest
  } = props;

  return (
    <div className={cn("relative flex flex-shrink-0 gap-2", containerClassName)}>
      <input
        id={id}
        ref={ref}
        type="checkbox"
        name={name}
        checked={checked}
        className={cn(
          "size-4 shrink-0 cursor-pointer appearance-none rounded-[3px] border focus:outline-1 focus:outline-offset-4 focus:outline-accent-strong",
          {
            "cursor-not-allowed border-subtle bg-layer-1": disabled,
            "border-strong bg-transparent hover:border-strong-1": !disabled,
            "border-accent-strong-40 hover:border-accent-strong-40 bg-accent-primary hover:bg-accent-primary/80":
              !disabled && (checked || indeterminate),

            "border-none": checked,
          },
          className
        )}
        disabled={disabled}
        {...rest}
      />
      <svg
        className={cn(
          "pointer-events-none absolute top-1/2 left-1/2 hidden size-4 -translate-x-1/2 -translate-y-1/2 p-0.5 text-on-color outline-none",
          {
            block: checked,
            "text-placeholder opacity-40": disabled,
          },
          iconClassName
        )}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <svg
        className={cn(
          "pointer-events-none absolute top-1/2 left-1/2 hidden size-4 -translate-x-1/2 -translate-y-1/2 stroke-white p-0.5 outline-none",
          {
            "stroke-placeholder opacity-40": disabled,
            block: indeterminate && !checked,
          },
          iconClassName
        )}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5.75 4H2.25" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
});
Checkbox.displayName = "form-checkbox-field";

export { Checkbox };
