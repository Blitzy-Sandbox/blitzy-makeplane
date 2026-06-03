/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared helper types and prop contracts for the `@plane/ui` dropdowns family.
 *
 * Consumed by: `combo-box.tsx` (uses its own local `Props` type — NOT this module),
 * `custom-menu.tsx`, `custom-select.tsx`, `custom-search-select.tsx`, and the
 * `context-menu/` subsystem. Defines the shared `Placement` union, the `IDropdownProps` base
 * applied to every Headless UI-based dropdown, and the discriminated `ICustomSearchSelectProps`
 * union for single- vs. multi-select.
 *
 * Purely declarative: this module has no runtime exports.
 */

// FIXME: fix this!!!
import type { ICustomSearchSelectOption } from "@plane/types";

/**
 * Popper.js placement union shared across every dropdown in this folder. Mirrors the
 * `react-popper` `Placement` type but is redeclared locally to keep the type independent of
 * a specific popper version. Used by `IDropdownProps.placement` and submenu props.
 */
type Placement =
  | "top"
  | "top-start"
  | "top-end"
  | "bottom"
  | "bottom-start"
  | "bottom-end"
  | "left"
  | "left-start"
  | "left-end"
  | "right"
  | "right-start"
  | "right-end";

/**
 * Base prop contract shared by every Headless UI-based dropdown in this folder
 * (`CustomSelect`, `CustomSearchSelect`, `CustomMenu`). The actual select/menu interfaces
 * extend this with their own additional fields. Naming follows the `I`-prefix legacy
 * convention used throughout `@plane/types`.
 *
 * Field semantics:
 *   - `customButtonClassName` / `customButtonTabIndex`: applied to the consumer-supplied
 *     `customButton` trigger.
 *   - `buttonClassName`: applied to the default trigger button when `customButton` is absent.
 *   - `className`: applied to the dropdown root (`Combobox` / `Menu` `as="div"`).
 *   - `customButton`: optional trigger content; takes precedence over `label` + chevron.
 *   - `disabled`: blocks open + applies the disabled visual treatment.
 *   - `input`: trigger size variant — larger padding/13px font when `true`, compact 11px otherwise.
 *   - `label`: default trigger text shown when no `customButton` is supplied.
 *   - `maxHeight`: scrollable panel height preset. `CustomSearchSelect` supports the full
 *     `sm | rg | md | lg | xl | 2xl` range; `CustomSelect` and `CustomMenu` only use `sm | rg | md | lg`.
 *   - `noChevron` / `chevronClassName`: hide or restyle the trailing chevron icon on the default trigger.
 *   - `onOpen`: callback invoked when the dropdown opens.
 *     INTENT UNCLEAR: `CustomSearchSelect` fires `onOpen` twice on first open (imperative call
 *     plus Headless UI render-prop transition); consumers must treat the callback as non-unique.
 *   - `optionsClassName`: applied to the floating options/menu panel wrapper.
 *   - `placement`: popper placement; defaults vary per component (`bottom-start` for selects,
 *     `auto` for `CustomMenu`).
 *   - `tabIndex`: forwarded to the dropdown root.
 *   - `useCaptureForOutsideClick`: when `true`, the outside-click `mousedown` listener fires in
 *     the capture phase rather than the bubble phase.
 *   - `defaultOpen`: initial open state (currently only honored by `CustomSearchSelect`).
 */
export interface IDropdownProps {
  customButtonClassName?: string;
  customButtonTabIndex?: number;
  buttonClassName?: string;
  className?: string;
  customButton?: React.ReactNode;
  disabled?: boolean;
  input?: boolean;
  label?: string | React.ReactNode;
  maxHeight?: "sm" | "rg" | "md" | "lg" | "xl" | "2xl";
  noChevron?: boolean;
  chevronClassName?: string;
  onOpen?: () => void;
  optionsClassName?: string;
  placement?: Placement;
  tabIndex?: number;
  useCaptureForOutsideClick?: boolean;
  defaultOpen?: boolean;
}

/**
 * Prop contract for the local `Portal` helper used by `CustomMenu` (file
 * `custom-menu.tsx`) and `SubMenu`. Defined here for re-use even though the runtime `Portal`
 * is declared inside `custom-menu.tsx` itself.
 *
 *   - `container`: target DOM element for the portal; defaults to `document.body`.
 *   - `asChild` (default `false`): when `true`, children are portaled directly. When `false`,
 *     they are wrapped in `<div data-radix-portal="">` for compatibility with consumers that
 *     scope styles or event delegation by that attribute.
 */
export interface IPortalProps {
  children: React.ReactNode;
  container?: Element | null;
  asChild?: boolean;
}

/**
 * Prop contract for `CustomMenu` (action-menu dropdown). Extends `IDropdownProps` with
 * menu-specific fields:
 *
 *   - `children` (required): typically `CustomMenu.MenuItem` and `CustomMenu.SubMenu` entries.
 *   - `ellipsis` / `verticalEllipsis`: render the trigger as a `MoreHorizontal` icon
 *     (horizontal or 90°-rotated). Mutually exclusive in practice; `verticalEllipsis` wins if both are set.
 *   - `noBorder`: omit the trigger button's shadow + border.
 *   - `menuButtonOnClick`: extra callback fired after the menu toggles, in addition to the
 *     standard open/close transition.
 *   - `menuItemsClassName`: applied to the outer `Menu.Items` wrapper (BEFORE the inner styled
 *     panel `<div>` that consumes `optionsClassName`).
 *   - `onMenuClose`: callback fired when the menu transitions from open to closed.
 *   - `closeOnSelect`: when `true`, clicks on the `Menu` root (not just items) close the menu.
 *   - `portalElement`: when supplied, `Menu.Items` is portaled into this element instead of
 *     rendering in place.
 *   - `openOnHover`: when `true`, opens on `mouseenter` and closes 150 ms after `mouseleave`
 *     (the grace period allows moving the cursor to a submenu).
 *   - `ariaLabel`: forwarded to the trigger button; required when using icon-only ellipsis triggers.
 */
export interface ICustomMenuDropdownProps extends IDropdownProps {
  children: React.ReactNode;
  ellipsis?: boolean;
  noBorder?: boolean;
  verticalEllipsis?: boolean;
  menuButtonOnClick?: (...args: any) => void;
  menuItemsClassName?: string;
  onMenuClose?: () => void;
  closeOnSelect?: boolean;
  portalElement?: Element | null;
  openOnHover?: boolean;
  ariaLabel?: string;
}

/**
 * Prop contract for `CustomSelect` (non-search single-value select). Extends `IDropdownProps`
 * with the value-binding fields:
 *
 *   - `children` (required): typically `<CustomSelect.Option value={...}>` elements.
 *   - `value` (required): currently selected value. Typed `any` to support arbitrary value
 *     shapes; consumers should narrow it via the option `value` types they render.
 *   - `onChange` (required): fires with the new selected value; the panel auto-closes after
 *     the call returns. Typed `any` for the same reason as `value`.
 *
 * INTENT UNCLEAR: `value` and `onChange` are typed `any` — consumers cannot enforce option/value
 * type alignment at the prop boundary. This is a known limitation of the legacy `@plane/ui`
 * surface and is intentionally NOT refactored per the documentation directive's system boundary.
 */
export interface ICustomSelectProps extends IDropdownProps {
  children: React.ReactNode;
  value: any;
  onChange: any;
}

/**
 * Search-select-specific fields combined with `IDropdownProps` and the
 * `SingleValueProps | MultipleValuesProps` discriminator to form `ICustomSearchSelectProps`
 * below. Not exported on its own.
 *
 *   - `footerOption`: optional React node rendered AFTER the filtered list inside the panel.
 *   - `onChange` (required): fires with the new value (single) or `value[]` (multi).
 *   - `onClose`: fires when the panel closes; useful for committing pending changes.
 *   - `noResultsMessage` (default `"No matches found"`): shown when filtering yields zero results.
 *   - `options`: `ICustomSearchSelectOption[]` (from `@plane/types`); pass `undefined` to render
 *     the panel's `Loading...` state.
 */
interface CustomSearchSelectProps {
  footerOption?: React.ReactNode;
  onChange: any;
  onClose?: () => void;
  noResultsMessage?: string;
  options?: ICustomSearchSelectOption[];
}

/**
 * Discriminator branches for `ICustomSearchSelectProps`. The presence of `multiple: true` flips
 * the `value` type from a scalar `any` to `any[] | null` (null is the canonical "nothing selected"
 * marker for multi-select). Neither branch is exported; they are consumed only through
 * `ICustomSearchSelectProps` below.
 */
interface SingleValueProps {
  multiple?: false;
  value: any;
}

interface MultipleValuesProps {
  multiple?: true;
  value: any[] | null;
}

/**
 * Discriminated-union prop contract for `CustomSearchSelect`. The discriminator `multiple`
 * flips between single-value (`value: any`) and multi-value (`value: any[] | null`) shapes,
 * letting TypeScript narrow the `value` type at the call site based on whether the caller
 * sets `multiple={true}`.
 */
export type ICustomSearchSelectProps = IDropdownProps &
  CustomSearchSelectProps &
  (SingleValueProps | MultipleValuesProps);

/**
 * Prop contract for `CustomMenu.MenuItem`. Each menu row is a single actionable button.
 *
 *   - `children` (required): row content (label + optional icon).
 *   - `disabled`: greys out the row and blocks click.
 *   - `onClick`: invoked with the raw mouse event; the menu auto-closes via Headless UI
 *     `close()` after the call.
 *   - `className`: extra Tailwind classes merged onto the row button.
 */
export interface ICustomMenuItemProps {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: (args?: any) => void;
  className?: string;
}

/**
 * Prop contract for `CustomSelect.Option`.
 *
 *   - `children` (required): option content.
 *   - `value` (required): option value; compared against `CustomSelect`'s `value` to determine
 *     the `selected` state and toggle the `CheckIcon`. Typed `any` to match `ICustomSelectProps`.
 *   - `className`: extra Tailwind classes merged onto the option row.
 */
export interface ICustomSelectItemProps {
  children: React.ReactNode;
  value: any;
  className?: string;
}

/**
 * Submenu prop contracts for `CustomMenu.SubMenu`, `CustomMenu.SubMenuTrigger`, and
 * `CustomMenu.SubMenuContent`. Note: `SubMenu` owns popper positioning and open state, while
 * `SubMenuTrigger` and `SubMenuContent` are presentational shells.
 */
// Submenu interfaces
/**
 * Prop contract for `CustomMenu.SubMenu` — the active submenu component that owns open state,
 * popper positioning, and parent-menu coordination via `MenuContext`.
 *
 *   - `trigger` (required): row content shown in the parent menu (typically text + chevron).
 *   - `children` (required): submenu panel content (usually `CustomMenu.MenuItem` entries).
 *   - `disabled`: greys out the trigger and blocks open.
 *   - `className` / `contentClassName`: trigger / panel class overrides.
 *   - `placement` (default `"right-start"` in the implementation): popper placement for the panel.
 */
export interface ICustomSubMenuProps {
  children: React.ReactNode;
  trigger: React.ReactNode;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  placement?: Placement;
}

/**
 * Prop contract for `CustomMenu.SubMenuTrigger` — a presentational row that mimics a submenu
 * trigger's appearance without owning submenu state. For active submenu behavior, use
 * `CustomMenu.SubMenu` instead.
 */
export interface ICustomSubMenuTriggerProps {
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * Prop contract for `CustomMenu.SubMenuContent` — a presentational shell for submenu content.
 *
 * INTENT UNCLEAR: the `placement`, `sideOffset`, and `alignOffset` fields are declared but
 * NOT consumed by the runtime `SubMenuContent` component in `custom-menu.tsx`. They are present
 * for API parity with `SubMenu` and may be wired up in a future refactor.
 */
export interface ICustomSubMenuContentProps {
  children: React.ReactNode;
  className?: string;
  placement?: Placement;
  sideOffset?: number;
  alignOffset?: number;
}
