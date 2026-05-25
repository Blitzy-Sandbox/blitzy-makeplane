/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import type { TEstimateSystems } from "@plane/types";

/**
 * Maximum character length accepted for a single estimate-point value — the
 * user-typed label for one point (e.g., "13", "XL", "Very Hard").
 *
 * Enforced in the estimate point create/update input handlers in
 * `apps/web/core/components/estimates/points/{create,update}.tsx`.
 */
export const MAX_ESTIMATE_POINT_INPUT_LENGTH = 20;

/**
 * Identifiers for the supported estimate systems on a project.
 *
 * The string values mirror the `EstimateType` text choices on the backend
 * `Estimate` model in `apps/api/plane/db/models/estimate.py`, plus the
 * enterprise-only `time` system.
 *
 * Values:
 * - `POINTS` (`"points"`): numeric story points (Fibonacci / Linear / Squares).
 * - `CATEGORIES` (`"categories"`): qualitative buckets (t-shirt sizes, Easy→Hard).
 * - `TIME` (`"time"`): time-based estimates — gated to enterprise edition
 *   deployments (see `ESTIMATE_SYSTEMS.time.is_ee`).
 *
 * Consumers: estimate system picker and template chooser in
 * `apps/web/core/components/estimates/**` and the project settings estimate page.
 */
export enum EEstimateSystem {
  POINTS = "points",
  CATEGORIES = "categories",
  TIME = "time",
}

/**
 * Lifecycle stage of the estimate edit/switch wizard — drives which form is
 * rendered in the project settings estimate flow.
 *
 * Values:
 * - `CREATE` (`"create"`): creating a brand-new estimate system from scratch.
 * - `EDIT` (`"edit"`): editing the points of the currently active estimate system.
 * - `SWITCH` (`"switch"`): replacing the active estimate system with a different
 *   system or template (involves a data-migration step).
 *
 * Consumers: stage discriminator consumed by the estimate update components in
 * `apps/web/core/components/estimates/**`; paired with the `TEstimateUpdateStageKeys`
 * union exported from `@plane/types`.
 */
export enum EEstimateUpdateStages {
  CREATE = "create",
  EDIT = "edit",
  SWITCH = "switch",
}

/**
 * Inclusive lower and upper bounds for the number of estimate points an estimate
 * system may contain.
 *
 * Enforced by the estimate create/edit forms in
 * `apps/web/core/components/estimates/**` when adding or removing points.
 */
export const estimateCount = {
  min: 2,
  max: 6,
};

/**
 * Catalog of estimate-system templates, keyed by `EEstimateSystem` string value.
 *
 * Each system (`points` / `categories` / `time`) exposes one or more named
 * templates (Fibonacci, Linear, Squares, T-Shirt Sizes, Easy-to-Hard, Hours,
 * plus a `custom` template hidden from the picker via `hide: true`) with their
 * default point values and i18n keys for the system name and template title.
 *
 * Non-obvious fields:
 * - `is_available`: whether the system is selectable in the current build.
 * - `is_ee`: when `true`, the system is gated to enterprise edition deployments
 *   (currently only the `time` system).
 * - `templates[*].hide`: when `true`, the template is omitted from the picker
 *   but still selectable internally as the "custom" starting point.
 *
 * Consumers: estimate system picker and template chooser in
 * `apps/web/core/components/estimates/**`.
 */
export const ESTIMATE_SYSTEMS: TEstimateSystems = {
  points: {
    name: "Points",
    i18n_name: "project_settings.estimates.systems.points.label",
    templates: {
      fibonacci: {
        title: "Fibonacci",
        i18n_title: "project_settings.estimates.systems.points.fibonacci",
        values: [
          { id: undefined, key: 1, value: "1" },
          { id: undefined, key: 2, value: "2" },
          { id: undefined, key: 3, value: "3" },
          { id: undefined, key: 4, value: "5" },
          { id: undefined, key: 5, value: "8" },
          { id: undefined, key: 6, value: "13" },
        ],
      },
      linear: {
        title: "Linear",
        i18n_title: "project_settings.estimates.systems.points.linear",
        values: [
          { id: undefined, key: 1, value: "1" },
          { id: undefined, key: 2, value: "2" },
          { id: undefined, key: 3, value: "3" },
          { id: undefined, key: 4, value: "4" },
          { id: undefined, key: 5, value: "5" },
          { id: undefined, key: 6, value: "6" },
        ],
      },
      squares: {
        title: "Squares",
        i18n_title: "project_settings.estimates.systems.points.squares",
        values: [
          { id: undefined, key: 1, value: "1" },
          { id: undefined, key: 2, value: "4" },
          { id: undefined, key: 3, value: "9" },
          { id: undefined, key: 4, value: "16" },
          { id: undefined, key: 5, value: "25" },
          { id: undefined, key: 6, value: "36" },
        ],
      },
      custom: {
        title: "Custom",
        i18n_title: "project_settings.estimates.systems.points.custom",
        values: [
          { id: undefined, key: 1, value: "1" },
          { id: undefined, key: 2, value: "2" },
        ],
        hide: true,
      },
    },
    is_available: true,
    is_ee: false,
  },
  categories: {
    name: "Categories",
    i18n_name: "project_settings.estimates.systems.categories.label",
    templates: {
      t_shirt_sizes: {
        title: "T-Shirt Sizes",
        i18n_title: "project_settings.estimates.systems.categories.t_shirt_sizes",
        values: [
          { id: undefined, key: 1, value: "XS" },
          { id: undefined, key: 2, value: "S" },
          { id: undefined, key: 3, value: "M" },
          { id: undefined, key: 4, value: "L" },
          { id: undefined, key: 5, value: "XL" },
          { id: undefined, key: 6, value: "XXL" },
        ],
      },
      easy_to_hard: {
        title: "Easy to hard",
        i18n_title: "project_settings.estimates.systems.categories.easy_to_hard",
        values: [
          { id: undefined, key: 1, value: "Easy" },
          { id: undefined, key: 2, value: "Medium" },
          { id: undefined, key: 3, value: "Hard" },
          { id: undefined, key: 4, value: "Very Hard" },
        ],
      },
      custom: {
        title: "Custom",
        i18n_title: "project_settings.estimates.systems.categories.custom",
        values: [
          { id: undefined, key: 1, value: "Easy" },
          { id: undefined, key: 2, value: "Hard" },
        ],
        hide: true,
      },
    },
    is_available: true,
    is_ee: false,
  },
  time: {
    name: "Time",
    i18n_name: "project_settings.estimates.systems.time.label",
    templates: {
      hours: {
        title: "Hours",
        i18n_title: "project_settings.estimates.systems.time.hours",
        values: [
          { id: undefined, key: 1, value: "1" },
          { id: undefined, key: 2, value: "2" },
          { id: undefined, key: 3, value: "3" },
          { id: undefined, key: 4, value: "4" },
          { id: undefined, key: 5, value: "5" },
          { id: undefined, key: 6, value: "6" },
        ],
      },
    },
    is_available: true,
    is_ee: true,
  },
};
