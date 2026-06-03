/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `FiltersDropdown` — Headless UI Popover wrapper with popper.js positioning. The outer dropdown
 * shell used by the filters Popover and the display-filters dropdown.
 *
 * Rendered purpose: presents a trigger button (icon or text) that toggles a popper-positioned panel
 * containing the supplied `children` (the filter or display-filter dropdown body).
 *
 * Props (`Props`):
 *   - `children` (`ReactNode`, required): the dropdown body — a filter or display-filter section.
 *   - `icon` (`ReactElement`, optional): the trigger button's icon.
 *   - `miniIcon` (`ReactNode`, optional): an adjacent small icon (e.g. filter-applied indicator
 *     badge).
 *   - `title` (`string`, optional, default `"Dropdown"`): the trigger button's text label.
 *   - `placement` (`Placement`, optional, default `"auto"`): popper.js placement for the panel.
 *   - `disabled` (`boolean`, optional, default `false`): disables the trigger button.
 *   - `tabIndex` (`number`, optional): tab index for the trigger button.
 *   - `menuButton` (`ReactNode`, optional): a custom trigger button that replaces the default.
 *   - `isFiltersApplied` (`boolean`, optional, default `false`): when `true`, the trigger displays
 *     the "filters-applied" visual indicator (typically a dot or accent on the icon).
 *
 * MobX stores read: none.
 *
 * Side effects: none — purely a UI primitive.
 *
 * Accessibility considerations:
 *   - Built on Headless UI `Popover` and `Transition` — both ship with ARIA roles
 *     (`role="dialog"`/`aria-haspopup="dialog"` semantics) and keyboard handling (Tab / Shift+Tab to
 *     traverse, Esc to close) built in.
 *   - The trigger button accepts `tabIndex` so callers can place the dropdown in a custom focus order
 *     within the header.
 */

import React, { Fragment, useState } from "react";
import type { Placement } from "@popperjs/core";
import { usePopper } from "react-popper";
// headless ui
import { Popover, Transition } from "@headlessui/react";
// ui
import { Button } from "@plane/propel/button";

type Props = {
  children: React.ReactNode;
  icon?: React.ReactElement;
  miniIcon?: React.ReactNode;
  title?: string;
  placement?: Placement;
  disabled?: boolean;
  tabIndex?: number;
  menuButton?: React.ReactNode;
  isFiltersApplied?: boolean;
};

export function FiltersDropdown(props: Props) {
  const {
    children,
    miniIcon,
    icon,
    title = "Dropdown",
    placement,
    disabled = false,
    tabIndex,
    menuButton,
    isFiltersApplied = false,
  } = props;

  const [referenceElement, setReferenceElement] = useState<HTMLButtonElement | HTMLDivElement | null>(null);
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);

  const { styles, attributes } = usePopper(referenceElement, popperElement, {
    placement: placement ?? "auto",
  });

  return (
    <Popover as="div">
      {({ open }) => (
        <>
          <Popover.Button as={React.Fragment}>
            {menuButton ? (
              <button type="button" ref={setReferenceElement}>
                {menuButton}
              </button>
            ) : (
              <div ref={setReferenceElement}>
                <div className="hidden @4xl:flex">
                  <Button
                    disabled={disabled}
                    variant="secondary"
                    prependIcon={icon}
                    tabIndex={tabIndex}
                    className="relative"
                    size="lg"
                  >
                    <>
                      <div className={`${open ? "text-primary" : "text-secondary"}`}>
                        <span>{title}</span>
                      </div>
                      {isFiltersApplied && (
                        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-accent-primary" />
                      )}
                    </>
                  </Button>
                </div>
                <div className="flex @4xl:hidden">
                  <Button
                    disabled={disabled}
                    ref={setReferenceElement}
                    variant="secondary"
                    tabIndex={tabIndex}
                    size="lg"
                  >
                    {miniIcon || title}
                  </Button>
                </div>
              </div>
            )}
          </Popover.Button>
          <Transition
            as={Fragment}
            enter="transition ease-out duration-200"
            enterFrom="opacity-0 translate-y-1"
            enterTo="opacity-100 translate-y-0"
            leave="transition ease-in duration-150"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 translate-y-1"
          >
            {/** translate-y-0 is a hack to create new stacking context. Required for safari  */}
            <Popover.Panel className="fixed z-10 translate-y-0">
              <div
                className="my-1 overflow-hidden rounded-sm border border-subtle bg-surface-1 shadow-raised-100"
                ref={setPopperElement}
                style={styles.popper}
                {...attributes.popper}
              >
                <div className="flex max-h-[30rem] w-[18.75rem] flex-col overflow-hidden lg:max-h-[37.5rem]">
                  {children}
                </div>
              </div>
            </Popover.Panel>
          </Transition>
        </>
      )}
    </Popover>
  );
}
