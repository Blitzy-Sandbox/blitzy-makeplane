/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Headless UI Switch-based toggle primitive used for boolean settings such as notification
 * preferences and other on/off UX controls.
 */

import { Switch } from "@headlessui/react";
// helpers
import { cn } from "../utils";

interface IToggleSwitchProps {
  value: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  className?: string;
}

/**
 * Controlled animated toggle switch (alternative to a checkbox) built on top of Headless UI's
 * `Switch`. The thumb translates horizontally to reflect the boolean state, and the track color
 * shifts between the accent and a placeholder neutral.
 *
 * Use when the UX calls for an on/off setting (e.g., notification preferences) rather than a
 * boolean checkbox in a form. State is fully controlled — callers own `value` and react to
 * `onChange`.
 *
 * Props (see local `IToggleSwitchProps`):
 *   - `value`: controlled checked state.
 *   - `onChange`: invoked with the new boolean on user toggle.
 *   - `label` (optional): visually hidden screen-reader accessible name.
 *   - `size` (default `"sm"`): one of `"sm" | "md" | "lg"` controlling track and thumb dimensions.
 *   - `disabled` (optional): disables the underlying Switch and applies muted styling.
 *   - `className` (optional): extra Tailwind classes merged onto the Switch element.
 *
 * Accessibility: Headless UI Switch supplies `role="switch"` and `aria-checked` automatically,
 * and Space toggles the switch when focused. The optional `label` is rendered inside an
 * `sr-only` span so it acts as the accessible name without being visible.
 */
function ToggleSwitch(props: IToggleSwitchProps) {
  const { value, onChange, label, size = "sm", disabled, className } = props;

  return (
    <Switch
      checked={value}
      disabled={disabled}
      onChange={onChange}
      className={cn(
        "relative inline-flex h-6 w-10 flex-shrink-0 cursor-pointer rounded-full border border-subtle bg-layer-1 transition-colors duration-200 ease-in-out focus:outline-none",
        {
          "h-4 w-7": size === "sm",
          "h-5 w-9": size === "md",
          "bg-accent-primary": value && !disabled,
          "bg-(--text-color-icon-placeholder)": !value && !disabled,
          "cursor-not-allowed bg-accent-primary opacity-50": value && disabled,
          "cursor-not-allowed bg-(--text-color-icon-placeholder) opacity-50": !value && disabled,
        },
        className
      )}
    >
      <span className="sr-only">{label}</span>
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-5 w-5 transform self-center rounded-full bg-(--text-color-icon-on-color) ring-0 transition duration-200 ease-in-out",
          {
            "h-3 w-3 translate-x-3.5": size === "sm" && value,
            "h-3 w-3 translate-x-0.5": size === "sm" && !value,
            "h-4 w-4 translate-x-4": size === "md" && value,
            "h-4 w-4 translate-x-0.5": size === "md" && !value,
            "translate-x-4": size === "lg" && value,
            "translate-x-0.5": size === "lg" && !value,
          }
        )}
      />
    </Switch>
  );
}

ToggleSwitch.displayName = "plane-ui-toggle-switch";

export { ToggleSwitch };
