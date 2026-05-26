/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel module for the `popovers` family.
 *
 * Re-exports the `Popover`, `PopoverMenu` components and their shared type contracts
 * (`TPopover`, `TPopoverMenu`, `TPopoverDefaultOptions`, `TPopoverButtonDefaultOptions`)
 * so consumers can import from `@plane/ui` without depending on internal file paths.
 */

export * from "./popover";
export * from "./popover-menu";
