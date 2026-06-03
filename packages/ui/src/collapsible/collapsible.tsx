/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Accessible disclosure container with animated expand/collapse behavior.
 *
 * Wraps Headless UI's `Disclosure` + `Transition` primitives to provide a controlled or
 * uncontrolled collapsible panel; ARIA semantics (`aria-expanded`, `aria-controls`) are
 * supplied automatically by `Disclosure.Button` and do not need to be hand-rolled.
 */

import { Disclosure, Transition } from "@headlessui/react";
import React, { useState, useEffect, useCallback } from "react";

/**
 * Prop contract for the `Collapsible` disclosure container.
 *
 * Supports both controlled usage (provide `isOpen` + `onToggle`) and uncontrolled usage
 * (provide `defaultOpen`, omit `isOpen`); the two modes are mutually exclusive.
 */
export type TCollapsibleProps = {
  title: string | React.ReactNode;
  children: React.ReactNode;
  buttonRef?: React.RefObject<HTMLButtonElement>;
  className?: string;
  buttonClassName?: string;
  isOpen?: boolean;
  onToggle?: () => void;
  defaultOpen?: boolean;
};

/**
 * Animated disclosure container that expands and collapses its `children` between the
 * collapsed (height 0, opacity 0) and expanded (height auto, opacity 1) states over 300ms.
 *
 * Operates in either controlled or uncontrolled mode based on whether `isOpen` is provided:
 * controlled mode delegates state to the parent via `onToggle`; uncontrolled mode owns local
 * state seeded from `defaultOpen`. The trigger is rendered inline as a `Disclosure.Button`
 * showing `title`; pair with `CollapsibleButton` (from `./collapsible-button`) for the
 * standardized header styling.
 *
 * @param props.title - Required. Content of the trigger button (string or any React node).
 * @param props.children - Required. Panel content revealed when expanded.
 * @param props.buttonRef - Optional. Forwarded `ref` to the underlying trigger button element.
 * @param props.className - Optional. Classes applied to the outer `Disclosure` wrapper `<div>`.
 * @param props.buttonClassName - Optional. Classes applied to the `Disclosure.Button` trigger.
 * @param props.isOpen - Optional. When provided, switches the component to controlled mode and follows this value via `useEffect`.
 * @param props.onToggle - Optional. Invoked on trigger click in controlled mode; ignored in uncontrolled mode.
 * @param props.defaultOpen - Optional. Initial open state for uncontrolled mode; ignored when `isOpen` is provided.
 */
export function Collapsible(props: TCollapsibleProps) {
  const { title, children, buttonRef, className, buttonClassName, isOpen, onToggle, defaultOpen } = props;
  // state
  const [localIsOpen, setLocalIsOpen] = useState<boolean>(isOpen || defaultOpen ? true : false);

  useEffect(() => {
    if (isOpen !== undefined) {
      setLocalIsOpen(isOpen);
    }
  }, [isOpen]);

  // handlers
  const handleOnClick = useCallback(() => {
    if (isOpen !== undefined) {
      if (onToggle) onToggle();
    } else {
      setLocalIsOpen((prev) => !prev);
    }
  }, [isOpen, onToggle]);

  return (
    <Disclosure as="div" className={className}>
      <Disclosure.Button ref={buttonRef} className={buttonClassName} onClick={handleOnClick}>
        {title}
      </Disclosure.Button>
      <Transition
        show={localIsOpen}
        enter="transition-all duration-300 ease-in-out"
        enterFrom="grid-rows-[0fr] opacity-0"
        enterTo="grid-rows-[1fr] opacity-100"
        leave="transition-all duration-300 ease-in-out"
        leaveFrom="grid-rows-[1fr] opacity-100"
        leaveTo="grid-rows-[0fr] opacity-0"
        className="grid overflow-hidden"
      >
        <Disclosure.Panel static className="min-h-0">
          {children}
        </Disclosure.Panel>
      </Transition>
    </Disclosure>
  );
}
