/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Textarea primitive matching the `Input` design language, with always-on height auto-resize
 * driven by the `useAutoResizeTextArea` hook.
 *
 * Auto-resize keeps the field height matching content so users authoring variable-length input
 * (issue descriptions, comments, sticky-note bodies) do not have to scroll inside a small fixed
 * box; the height tracks `value` on every render via `useLayoutEffect`.
 */

import React, { useRef } from "react";
// helpers
import { useAutoResizeTextArea } from "../hooks/use-auto-resize-textarea";
import { cn } from "../utils";
// hooks

/**
 * Props for the `TextArea` component. Extends all native
 * `React.TextareaHTMLAttributes<HTMLTextAreaElement>`, so every standard textarea attribute
 * (`placeholder`, `rows`, `disabled`, `onChange`, `value`, `name`, `aria-*`, ...) passes
 * through. Four Plane-specific fields layer the design system's chrome on top:
 *
 *   - `mode` (default `"primary"` in the component): visual variant — `"primary"` is bordered,
 *     `"transparent"` is borderless with a focus ring, `"true-transparent"` is borderless with
 *     no focus ring (used in headers/titles).
 *   - `textAreaSize` (default `"sm"` in the component): padding preset (`xs` | `sm` | `md`).
 *   - `hasError` (default `false` in the component): applies the error border; in `"primary"`
 *     mode also tints the background `bg-danger-subtle` (unlike `Input`, which only adjusts the border).
 *   - `className`: extra Tailwind classes merged onto the textarea.
 */
export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  mode?: "primary" | "transparent" | "true-transparent";
  textAreaSize?: "xs" | "sm" | "md";
  hasError?: boolean;
  className?: string;
}

/**
 * Ref-forwarding textarea that mirrors the `Input` primitive's visual language and keeps its
 * height in sync with `value` so authors do not need to scroll inside a small fixed box.
 *
 * The component extends `React.TextareaHTMLAttributes<HTMLTextAreaElement>`, so every native
 * textarea attribute (`placeholder`, `rows`, `disabled`, `onChange`, `aria-*`, ...) passes
 * through `{...rest}`. The forwarded ref is mirrored into an internal `useRef` that
 * `useAutoResizeTextArea` reads on every render.
 *
 * Props (see local `TextAreaProps`):
 *   - `value` (default `""`): controlled value; auto-resize re-runs whenever it changes.
 *   - `mode` (default `"primary"`): visual chrome — bordered, transparent-with-focus-ring, or fully transparent.
 *   - `textAreaSize` (default `"sm"`): padding preset (`xs` | `sm` | `md`).
 *   - `hasError` (default `false`): paints the error border; in `primary` mode also tints the background.
 *   - `className`: extra Tailwind merged onto the textarea.
 *
 * Accessibility: native textarea semantics; ref is forwarded for autofocus/imperative reads.
 * INTENT UNCLEAR: `hasError=true` paints the error border but does not auto-apply `aria-invalid`;
 * callers must pass `aria-invalid` themselves through `{...rest}` for screen-reader announcement.
 */
const TextArea = React.forwardRef(function TextArea(
  props: TextAreaProps,
  ref: React.ForwardedRef<HTMLTextAreaElement>
) {
  const {
    id,
    name,
    value = "",
    mode = "primary",
    textAreaSize = "sm",
    hasError = false,
    className = "",
    ...rest
  } = props;
  // refs
  const textAreaRef = useRef<any>(ref);
  // auto re-size
  useAutoResizeTextArea(textAreaRef, value);

  return (
    <textarea
      id={id}
      name={name}
      ref={textAreaRef}
      value={value}
      className={cn(
        "no-scrollbar w-full bg-layer-2 placeholder-(--text-color-placeholder) outline-none",
        {
          "rounded-md border-[0.5px] border-subtle-1": mode === "primary",
          "focus:ring-theme rounded-sm border-none bg-transparent ring-0 transition-all focus:ring-1":
            mode === "transparent",
          "rounded-sm border-none bg-transparent ring-0": mode === "true-transparent",
          "px-1.5 py-1": textAreaSize === "xs",
          "px-3 py-2": textAreaSize === "sm",
          "p-3": textAreaSize === "md",
          "border-danger-strong": hasError,
          "bg-danger-subtle": hasError && mode === "primary",
        },
        className
      )}
      {...rest}
    />
  );
});

TextArea.displayName = "TextArea";

export { TextArea };
