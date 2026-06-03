/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Styled wrapper around the native `<input type="color">` element, providing
 * a button-driven trigger affordance.
 *
 * Wraps the native HTML color input so the component inherits the browser's
 * built-in picker UI (color wheel, channel inputs, system eye-dropper) without
 * re-implementing those affordances or their accessibility semantics from
 * scratch.
 */

import * as React from "react";

/**
 * Props consumed by {@link ColorPicker}.
 *
 * The component is a controlled input: callers own the color string and react
 * to changes through {@link ColorPickerProps.onChange}.
 */
interface ColorPickerProps {
  /** Current color value (typically a hex string such as `#ff0000`) bound to the underlying native `<input type="color">`. */
  value: string;
  /** Fires whenever the native picker emits a `change` event; receives the freshly-selected color string. */
  onChange: (color: string) => void;
  /** Optional Tailwind/utility classes appended to the visible trigger button (e.g., to override the default `size-4 rounded-full` swatch). */
  className?: string;
}

/**
 * Visually-styled swatch button that opens the browser's native color picker.
 *
 * A small circular trigger button is rendered on top of an absolutely-
 * positioned, visually-hidden native `<input type="color">`; clicking the
 * button programmatically clicks the hidden input, which causes the browser/OS
 * to display its first-party color dialog. This preserves the design system
 * aesthetic on the trigger while inheriting the rich, accessible picker UI
 * (color wheel, channel inputs, eye-dropper) that the browser already
 * provides — re-implementing that surface from scratch would be a large
 * undertaking with significant accessibility risk.
 *
 * Accessibility:
 * - The visible button carries `aria-label="Open color picker"` so assistive
 *   technologies announce a single, named interactive control.
 * - The native input is `aria-hidden="true"` to avoid duplicate exposure in
 *   the accessibility tree; it stays in the DOM via Tailwind's `invisible`
 *   utility (`visibility: hidden`) rather than `display: none` so the
 *   browser-native picker dialog can still attach to it on programmatic click.
 *
 * Event propagation: the trigger's click handler calls `stopPropagation()`
 * and `preventDefault()` so embedding the picker inside dropdowns, popovers,
 * or accordions does not collapse the surrounding surface or submit an
 * enclosing form.
 *
 * @see ColorPickerProps for the prop contract.
 */
export function ColorPicker(props: ColorPickerProps) {
  const { value, onChange, className = "" } = props;
  // refs
  const inputRef = React.useRef<HTMLInputElement>(null);

  // handlers
  const handleOnClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    inputRef.current?.click();
  };

  return (
    <div className="relative flex items-center justify-center">
      <button
        className={`size-4 cursor-pointer rounded-full conical-gradient ${className}`}
        onClick={handleOnClick}
        aria-label="Open color picker"
      />
      <input
        ref={inputRef}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="invisible absolute inset-0 size-4"
        aria-hidden="true"
      />
    </div>
  );
}
