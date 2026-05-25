/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Rich-filter option contracts and default values.
 *
 * Defines the typed configuration model that drives the clear, save-view,
 * update-view, and visibility behaviors of the rich-filter chip UI, plus the
 * canonical empty/automatic defaults used as initial state by the backing stores.
 *
 * Consumers: `packages/shared-state/src/store/rich-filters/` (filter,
 * config-manager, filter-helpers), `packages/shared-state/src/store/work-item-filters/filter.store.ts`,
 * and `apps/web/core/components/work-item-filters/filters-hoc/`.
 */

import type { TExternalFilter } from "@plane/types";

/**
 * Generic configuration bag for rich-filter behavior.
 *
 * Controls: arbitrary per-filter configuration overrides keyed by string.
 * Consumers: `packages/shared-state/src/store/rich-filters/config-manager.ts`
 * uses this as the shape for per-filter configuration storage.
 */
export type TConfigOptions = Record<string, unknown>;

/**
 * Canonical empty config baseline used when no per-filter configuration is provided.
 *
 * Controls: initial value of the config slice on a freshly created filter instance.
 * Consumers: `packages/shared-state/src/store/rich-filters/config-manager.ts`
 * falls back to this value during initialization.
 */
export const DEFAULT_FILTER_CONFIG_OPTIONS: TConfigOptions = {};

/**
 * Contract for the "Clear filters" affordance on a rich-filter expression.
 *
 * Controls: optional label override, the clear callback the chip invokes,
 * and an optional disabled flag.
 * Consumers: `packages/shared-state/src/store/rich-filters/filter.ts` and the
 * filter-clear chip rendered under `apps/web/core/components/work-item-filters/`.
 */
export type TClearFilterOptions = {
  label?: string;
  onFilterClear: () => void | Promise<void>;
  isDisabled?: boolean;
};

/**
 * Contract for the "Save view" affordance triggered from a rich-filter expression.
 *
 * Controls: optional label override, the save callback (receives the current
 * expression typed as `E extends TExternalFilter` to stay aligned with the
 * shared external filter model from `@plane/types`), and an optional disabled flag.
 * Consumers: `apps/web/core/components/work-item-filters/filters-hoc/shared.ts`
 * (`TEnableSaveViewProps`) and `packages/shared-state/src/store/rich-filters/filter.ts`.
 */
export type TSaveViewOptions<E extends TExternalFilter> = {
  label?: string;
  onViewSave: (expression: E) => void | Promise<void>;
  isDisabled?: boolean;
};

/**
 * Contract for the "Update view" affordance triggered from a rich-filter expression.
 *
 * Controls: optional label override, an `hasAdditionalChanges` signal so callers
 * can keep the chip enabled when non-filter changes (e.g., layout) are pending,
 * the update callback (receives the current expression typed as `E`), and an
 * optional disabled flag.
 * Consumers: `apps/web/core/components/work-item-filters/filters-hoc/shared.ts`
 * (`TEnableUpdateViewProps`) and `packages/shared-state/src/store/rich-filters/filter.ts`.
 */
export type TUpdateViewOptions<E extends TExternalFilter> = {
  label?: string;
  hasAdditionalChanges?: boolean;
  onViewUpdate: (expression: E) => void | Promise<void>;
  isDisabled?: boolean;
};

/**
 * Aggregate contract for the expression-level affordances a rich-filter surface
 * may expose (clear / save view / update view).
 *
 * Controls: which of the three optional affordances are wired into the chip and
 * how each one behaves.
 * Consumers: `packages/shared-state/src/store/rich-filters/filter.ts` accepts a
 * `Partial<TExpressionOptions<E>>` on instantiation and seeds it from the
 * default below; `packages/shared-state/src/store/work-item-filters/filter.store.ts`
 * forwards work-item-specific options into the same shape.
 */
export type TExpressionOptions<E extends TExternalFilter> = {
  clearFilterOptions?: TClearFilterOptions;
  saveViewOptions?: TSaveViewOptions<E>;
  updateViewOptions?: TUpdateViewOptions<E>;
};

/**
 * Canonical empty expression-options baseline — no clear / save / update affordances.
 *
 * Controls: initial value of the expression-options slice on a freshly created
 * filter instance, typed against `TExternalFilter` so it composes with any
 * concrete `E extends TExternalFilter`.
 * Consumers: `packages/shared-state/src/store/rich-filters/filter.ts` and
 * `filter-helpers.ts` use this as the fallback initial value.
 */
export const DEFAULT_FILTER_EXPRESSION_OPTIONS: TExpressionOptions<TExternalFilter> = {};

/**
 * Discriminated union describing how rich-filter visibility is controlled at mount.
 *
 * Controls: the visibility lifecycle of the rich-filter surface.
 * - `autoSetVisibility: true` — visibility is managed automatically by the host
 *   (e.g., derived from whether any filter is currently applied).
 * - `autoSetVisibility: false` — the caller pins the initial visible state via
 *   `isVisibleOnMount` and takes ownership of subsequent visibility changes.
 *
 * Consumers: `packages/shared-state/src/store/rich-filters/filter-helpers.ts`
 * (`setInitialVisibility`) and rich-filter host components under
 * `apps/web/core/components/work-item-filters/`.
 */
export type TAutoVisibilityOptions =
  | {
      autoSetVisibility: true;
    }
  | {
      autoSetVisibility: false;
      isVisibleOnMount: boolean;
    };

/**
 * Default visibility baseline — visibility is managed automatically by the host.
 *
 * Controls: initial value of the visibility slice on a freshly created filter
 * instance when no explicit visibility contract is provided.
 * Consumers: same as `TAutoVisibilityOptions` — used as the fallback initial
 * value in `packages/shared-state/src/store/rich-filters/filter-helpers.ts`.
 */
export const DEFAULT_FILTER_VISIBILITY_OPTIONS: TAutoVisibilityOptions = {
  autoSetVisibility: true,
};

/**
 * Top-level rich-filter options bundle combining expression, config, and
 * visibility contracts into the single shape consumed by filter stores.
 *
 * Controls: the full configuration surface of a rich-filter instance —
 * `expression` for clear / save / update affordances, `config` for generic
 * per-filter overrides, and `visibility` for mount-time visibility behavior.
 * Consumers: `packages/shared-state/src/store/rich-filters/filter.ts` accepts
 * `Partial<TFilterOptions<E>>` on construction and hydrates each slice from
 * the corresponding default constant above.
 */
export type TFilterOptions<E extends TExternalFilter> = {
  expression: Partial<TExpressionOptions<E>>;
  config: Partial<TConfigOptions>;
  visibility: TAutoVisibilityOptions;
};
