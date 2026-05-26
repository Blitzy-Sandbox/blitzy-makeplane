/**
 * Shared type contracts for the single-select and multi-select dropdown variants in
 * `@plane/ui/dropdown`.
 *
 * Consumers: `./single-select.tsx`, `./multi-select.tsx`, and the shared primitives in
 * `./common/{button,options}.tsx` import these interfaces via `import type` to stay aligned on
 * a single prop surface. The base `IDropdown` declares the prop bag every variant shares;
 * variant-specific interfaces narrow `value` and `onChange` to single vs. array shapes.
 */
import type { Placement } from "@popperjs/core";

/**
 * Root prop contract shared by every dropdown variant in this module.
 *
 * Organized into four prop groups by comment markers in the source ("root props", "button props",
 * "input props", "options props"). Variant-specific interfaces (`IMultiSelectDropdown`,
 * `ISingleSelectDropdown`) extend this base and narrow `value` / `onChange` / `options` to the
 * appropriate single-value or array shape.
 *
 * Non-obvious field semantics:
 *   - `containerClassName`: accepts either a string OR a function of `isOpen`, letting consumers
 *     toggle wrapper styles based on the panel's open state without a separate render prop.
 *   - `placement`: re-exports `@popperjs/core` `Placement` union (e.g. `"bottom-start"`,
 *     `"top-end"`). Default applied by the components is `"bottom-start"`.
 *   - `keyExtractor`: required; the components use the returned key as both the React `key` and
 *     the `Combobox.Option value`, so the function must return a stable unique identifier.
 *   - `queryArray`: when set, the search filter concatenates these `option.data` fields and runs
 *     a case-insensitive substring match against the query.
 *   - `sortByKey`: when set together with `disableSorting=false`, applied as the tertiary
 *     (case-insensitive) sort criterion. Single-select gates sorting on this being set;
 *     multi-select does not.
 *   - `firstItem`: pin-to-top predicate; options where `firstItem(option.data[option.value])`
 *     returns truthy sort to the top.
 *   - `renderItem`: when omitted, the components render `option.value` plus a checkmark for
 *     selected items.
 *   - `loader`: defaults to `false` at the call site; when neither a custom loader nor a falsy
 *     fallback is supplied, the panel renders `DropdownOptionsLoader` from `./common/loader`.
 */
export interface IDropdown {
  // root props
  onOpen?: () => void;
  onClose?: () => void;
  containerClassName?: string | ((isOpen: boolean) => string);
  tabIndex?: number;
  placement?: Placement;
  disabled?: boolean;

  // button props
  buttonContent?: (isOpen: boolean, value: string | string[] | undefined) => React.ReactNode;
  buttonContainerClassName?: string;
  buttonClassName?: string;

  // input props
  disableSearch?: boolean;
  inputPlaceholder?: string;
  inputClassName?: string;
  inputIcon?: React.ReactNode;
  inputContainerClassName?: string;

  // options props
  keyExtractor: (option: TDropdownOption) => string;
  optionsContainerClassName?: string;
  queryArray?: string[];
  sortByKey?: string;
  firstItem?: (optionValue: string) => boolean;
  renderItem?: ({
    value,
    selected,
    disabled,
  }: {
    value: string;
    selected: boolean;
    disabled?: boolean;
  }) => React.ReactNode;
  loader?: React.ReactNode;
  disableSorting?: boolean;
}

/**
 * Single option record consumed by both dropdown variants.
 *
 * Non-obvious field semantics:
 *   - `data: any`: intentionally untyped so consumers can attach arbitrary domain payloads
 *     (e.g., a full project/cycle entity). The `queryArray` and `firstItem` callbacks index
 *     into this object by string key, so the consumer is responsible for keeping field names
 *     in sync between the option array and those callbacks.
 *     INTENT UNCLEAR: `data: any` could plausibly have been a generic parameter; preserved
 *     as-is per system boundary "no refactoring".
 *   - `value: string`: paired with `data`; used as the display fallback when `renderItem` is
 *     not provided and also as a key into `data` in the sort tiebreaker logic.
 *   - `className`: function form taking `{active, selected}` so consumers can compute styling
 *     based on Headless UI's per-option `active` (hover/focus) and `selected` states.
 *   - `disabled`: when true, the option is rendered but not selectable; passed straight to
 *     `Combobox.Option`'s `disabled` prop.
 */
export interface TDropdownOption {
  data: any;
  value: string;
  className?: ({ active, selected }: { active: boolean; selected?: boolean }) => string;
  disabled?: boolean;
}

/**
 * Multi-select variant prop contract — narrows the base contract to array-valued selection.
 *
 * `value: string[]` is the full array of selected option keys; `onChange` receives the
 * updated array (not a delta), so consumers replace state rather than patching.
 */
export interface IMultiSelectDropdown extends IDropdown {
  value: string[];
  onChange: (value: string[]) => void;
  options: TDropdownOption[] | undefined;
}

/**
 * Single-select variant prop contract — narrows the base contract to a single string selection.
 *
 * `value: string` is the currently selected option key; `onChange` receives the newly selected
 * key (not a toggle/delta).
 */
export interface ISingleSelectDropdown extends IDropdown {
  value: string;
  onChange: (value: string) => void;
  options: TDropdownOption[] | undefined;
}

/**
 * Internal prop contract for the shared trigger `DropdownButton` in `./common/button.tsx`.
 *
 * Bridges parent-owned state (`isOpen`, `value`) and parent-owned handlers (`handleOnClick`,
 * `setReferenceElement`) into the Headless UI `Combobox.Button` wrapper so the parent can
 * coordinate popper-js anchoring and outside-click dismissal without lifting Headless UI's
 * internal combobox state.
 *
 * Non-obvious field semantics:
 *   - `setReferenceElement`: the parent passes the popper-js `setReferenceElement` setter
 *     here; the button uses it as its DOM `ref` so popper anchors the panel to the trigger.
 *   - `handleOnClick`: pre-wired by the parent to stop propagation, prevent default, and
 *     toggle the open state; consumers do not pass their own click handler through this prop.
 */
export interface IDropdownButton {
  isOpen: boolean;
  buttonContent?: (isOpen: boolean, value: string | string[] | undefined) => React.ReactNode;
  buttonClassName?: string;
  buttonContainerClassName?: string;
  handleOnClick: (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void;
  setReferenceElement: (element: HTMLButtonElement | null) => void;
  disabled?: boolean;
}

/**
 * Multi-select narrowing of `IDropdownButton` — `value` is the array of selected keys, used
 * only when `buttonContent` is supplied so the consumer's renderer can display chips.
 */
export interface IMultiSelectDropdownButton extends IDropdownButton {
  value: string[];
}

/**
 * Single-select narrowing of `IDropdownButton` — `value` is the single selected key, also
 * used as the default trigger label when `buttonContent` is omitted.
 */
export interface ISingleSelectDropdownButton extends IDropdownButton {
  value: string;
}

/**
 * Internal prop contract for the shared options-panel renderer `DropdownOptions` in
 * `./common/options.tsx`.
 *
 * The variant-agnostic shape supports both single-select and multi-select; variant-specific
 * interfaces (`IMultiSelectDropdownOptions`, `ISingleSelectDropdownOptions`) narrow `value`
 * to the appropriate shape.
 *
 * Non-obvious field semantics:
 *   - `query` / `setQuery`: search state is lifted to the parent dropdown so the same query
 *     survives across re-renders and so the parent can clear it on close (`handleClose`).
 *   - `handleClose`: optional; when provided, every option-row click invokes it so single-
 *     select dropdowns close the panel after selection. Multi-select intentionally omits it
 *     so the panel stays open across toggles.
 *   - `options`: when `undefined`, signals "data loading" and the renderer falls back to the
 *     `loader` node (or `DropdownOptionsLoader`). When `[]`, the renderer shows the
 *     "No matching results" placeholder instead.
 *   - `renderItem`: explicitly typed with a `| undefined` union (not just `?`) because the
 *     options-panel forwards the parent's optional value as-is rather than defaulting it.
 *   - `isMobile`: when true, the inner search input does not auto-focus on open (mobile
 *     keyboards otherwise pop up disruptively); see `./common/input-search.tsx`.
 */
export interface IDropdownOptions {
  isOpen: boolean;
  query: string;
  setQuery: (query: string) => void;

  inputPlaceholder?: string;
  inputClassName?: string;
  inputIcon?: React.ReactNode;
  inputContainerClassName?: string;
  disableSearch?: boolean;

  handleClose?: () => void;

  keyExtractor: (option: TDropdownOption) => string;
  renderItem:
    | (({ value, selected, disabled }: { value: string; selected: boolean; disabled?: boolean }) => React.ReactNode)
    | undefined;
  options: TDropdownOption[] | undefined;
  loader?: React.ReactNode;
  isMobile?: boolean;
}

/**
 * Multi-select narrowing of `IDropdownOptions` — `value` is the array of selected keys; used
 * by the renderer to flag selected rows via Headless UI's `selected` render-prop semantics.
 */
export interface IMultiSelectDropdownOptions extends IDropdownOptions {
  value: string[];
}

/**
 * Single-select narrowing of `IDropdownOptions` — `value` is the single selected key.
 */
export interface ISingleSelectDropdownOptions extends IDropdownOptions {
  value: string;
}
