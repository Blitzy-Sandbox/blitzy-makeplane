/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Combobox-style dropdown providing combined text input + filtered options list.
 *
 * Wraps Headless UI `Combobox` with a deferred-mount pattern: the heavy combobox subtree is
 * only rendered after the user actually interacts with the trigger (`mouseenter` or
 * `renderByDefault=true`). Until then, only the trigger button is rendered, keeping the cost
 * of large lists out of the initial paint.
 */

import { Combobox } from "@headlessui/react";
import type { ElementType, KeyboardEventHandler, ReactNode, Ref } from "react";
import React, { Fragment, forwardRef, useEffect, useRef, useState } from "react";

type Props = {
  as?: ElementType | undefined;
  ref?: Ref<HTMLElement> | undefined;
  tabIndex?: number | undefined;
  className?: string | undefined;
  value?: string | string[] | null;
  onChange?: (value: any) => void;
  disabled?: boolean | undefined;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement> | undefined;
  multiple?: boolean;
  renderByDefault?: boolean;
  button: ReactNode;
  children: ReactNode;
};

/**
 * Ref-forwarding combobox wrapper that defers mounting the Headless UI `Combobox` tree until
 * the trigger receives a `mouseenter` (or `renderByDefault=true` is passed at construction).
 *
 * Until first hover, only the `button` slot is rendered inside a styled wrapper `<div>`. This
 * keeps initial render cost low for tables/lists that contain many dropdowns, where most rows
 * are never opened.
 *
 * Props (see local `Props` type):
 *   - `button` (required): trigger content rendered inside `Combobox.Button as={Fragment}`.
 *   - `children` (required): the combobox subtree (typically `ComboOptions` + `ComboOption`s).
 *   - `renderByDefault` (default `true`): when `false`, defer mounting the Combobox tree until
 *     the user hovers the trigger.
 *   - `value` / `onChange` / `multiple` / `disabled` / `tabIndex` / `as` / `className` /
 *     `onKeyDown`: forwarded to Headless UI `Combobox`.
 *
 * Forwarded ref: passed through to the underlying Headless UI `Combobox` for imperative focus.
 *
 * Accessibility: once mounted, Headless UI Combobox provides ARIA `combobox` role,
 * `aria-expanded`, `aria-autocomplete="list"`, arrow-key navigation, Enter to commit, Escape to
 * dismiss, and typeahead via `ComboInput`. INTENT UNCLEAR: while in deferred-mount mode the
 * placeholder wrapper is a plain `<div>` with no `tabindex` or button semantics, so keyboard-only
 * users cannot trigger the lazy mount — only pointer hover transitions to the rendered tree.
 */
const ComboDropDown = forwardRef(function ComboDropDown(props: Props, ref) {
  const { button, renderByDefault = true, children, ...rest } = props;

  const dropDownButtonRef = useRef<HTMLDivElement | null>(null);

  const [shouldRender, setShouldRender] = useState(renderByDefault);

  const onHover = () => {
    setShouldRender(true);
  };

  useEffect(() => {
    const element = dropDownButtonRef.current as any;

    if (!element) return;

    element.addEventListener("mouseenter", onHover);

    return () => {
      element?.removeEventListener("mouseenter", onHover);
    };
  }, [dropDownButtonRef, shouldRender]);

  if (!shouldRender) {
    return (
      <div ref={dropDownButtonRef} className="flex h-full items-center">
        {button}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    <Combobox {...rest} ref={ref}>
      <Combobox.Button as={Fragment}>{button}</Combobox.Button>
      {children}
    </Combobox>
  );
});

/**
 * Re-exported Headless UI Combobox subcomponents. Provided as named aliases so consumers can
 * import them from `@plane/ui` without depending on `@headlessui/react` directly. Behavior is
 * unmodified — these aliases preserve every prop, ref, and render-prop signature of the
 * underlying primitives.
 */
const ComboOptions = Combobox.Options;
const ComboOption = Combobox.Option;
const ComboInput = Combobox.Input;

ComboDropDown.displayName = "ComboDropDown";

export { ComboDropDown, ComboOptions, ComboOption, ComboInput };
