/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Rich-filter option contracts (clear/save-view/update-view/visibility) and canonical empty defaults seeding the backing stores' initial state.
 * Consumers: `packages/shared-state/src/store/{rich-filters,work-item-filters}/**` and `apps/web/core/components/work-item-filters/filters-hoc/**`.
 */

import type { TExternalFilter } from "@plane/types";

/**
 * Generic string-keyed bag for per-filter configuration overrides.
 * Consumers: shape used by `packages/shared-state/src/store/rich-filters/config-manager.ts`.
 */
export type TConfigOptions = Record<string, unknown>;

/**
 * Canonical empty config baseline seeding the config slice of a freshly created filter instance.
 * Consumers: initialization fallback in `packages/shared-state/src/store/rich-filters/config-manager.ts`.
 */
export const DEFAULT_FILTER_CONFIG_OPTIONS: TConfigOptions = {};

/**
 * Contract for the "Clear filters" affordance — optional label override, clear callback, optional disabled flag.
 * Consumers: `packages/shared-state/src/store/rich-filters/filter.ts` and clear chips under `apps/web/core/components/work-item-filters/**`.
 */
export type TClearFilterOptions = {
  label?: string;
  onFilterClear: () => void | Promise<void>;
  isDisabled?: boolean;
};

/**
 * Contract for the "Save view" affordance — optional label override, save callback receiving the current `E extends TExternalFilter` expression, optional disabled flag.
 * Consumers: `TEnableSaveViewProps` in `apps/web/core/components/work-item-filters/filters-hoc/shared.ts` and `packages/shared-state/src/store/rich-filters/filter.ts`.
 */
export type TSaveViewOptions<E extends TExternalFilter> = {
  label?: string;
  onViewSave: (expression: E) => void | Promise<void>;
  isDisabled?: boolean;
};

/**
 * Contract for the "Update view" affordance — optional label, `hasAdditionalChanges` to stay enabled when non-filter (e.g., layout) changes are pending, update callback receiving `E`, optional disabled flag.
 * Consumers: `TEnableUpdateViewProps` in `apps/web/core/components/work-item-filters/filters-hoc/shared.ts` and `packages/shared-state/src/store/rich-filters/filter.ts`.
 */
export type TUpdateViewOptions<E extends TExternalFilter> = {
  label?: string;
  hasAdditionalChanges?: boolean;
  onViewUpdate: (expression: E) => void | Promise<void>;
  isDisabled?: boolean;
};

/**
 * Aggregate contract bundling clear/save-view/update-view affordances so callers can wire any subset into a rich-filter surface.
 * Consumers: `packages/shared-state/src/store/rich-filters/filter.ts` accepts `Partial<TExpressionOptions<E>>` and `work-item-filters/filter.store.ts` forwards work-item-specific options.
 */
export type TExpressionOptions<E extends TExternalFilter> = {
  clearFilterOptions?: TClearFilterOptions;
  saveViewOptions?: TSaveViewOptions<E>;
  updateViewOptions?: TUpdateViewOptions<E>;
};

/**
 * Canonical empty expression-options baseline (no clear/save/update affordances) typed against `TExternalFilter` so it composes with any `E extends TExternalFilter`.
 * Consumers: fallback initial value in `packages/shared-state/src/store/rich-filters/filter.ts` and `filter-helpers.ts`.
 */
export const DEFAULT_FILTER_EXPRESSION_OPTIONS: TExpressionOptions<TExternalFilter> = {};

/**
 * Discriminated visibility contract — `autoSetVisibility: true` lets the host derive visibility (e.g., from applied filters); `false` requires caller-pinned `isVisibleOnMount` and caller-owned updates.
 * Consumers: `setInitialVisibility` in `packages/shared-state/src/store/rich-filters/filter-helpers.ts` and rich-filter hosts under `apps/web/core/components/work-item-filters/**`.
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
 * Default host-managed visibility baseline seeding a freshly created filter when no explicit visibility contract is provided.
 * Consumers: fallback initial value in `packages/shared-state/src/store/rich-filters/filter-helpers.ts`.
 */
export const DEFAULT_FILTER_VISIBILITY_OPTIONS: TAutoVisibilityOptions = {
  autoSetVisibility: true,
};

/**
 * Top-level rich-filter options bundle combining `expression`/`config`/`visibility` contracts into the single shape filter stores consume.
 * Consumers: `packages/shared-state/src/store/rich-filters/filter.ts` accepts `Partial<TFilterOptions<E>>` and hydrates each slice from the defaults above.
 */
export type TFilterOptions<E extends TExternalFilter> = {
  expression: Partial<TExpressionOptions<E>>;
  config: Partial<TConfigOptions>;
  visibility: TAutoVisibilityOptions;
};
