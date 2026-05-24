/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Estimate system contracts for the `@plane/types` package.
 *
 * Models the estimate-system / estimate-point / template configuration used by
 * project settings → estimates. Plane projects choose one of three estimate
 * systems (`EEstimateSystem`: POINTS, CATEGORIES, TIME) and define ordered
 * estimate points within that system. Mirrors `apps/api/plane/db/models/estimate.py`.
 */

import type { EEstimateSystem, EEstimateUpdateStages } from "./enums";

/**
 * Single estimate point within an estimate system.
 *
 * All fields are nullable because the same shape is reused in create/edit forms
 * (where the id has not been assigned yet) and the persisted record returned by
 * `apps/api`.
 *
 * Fields:
 * - `key`: ordering position (0-indexed); controls display order in dropdowns.
 * - `value`: human-readable label (e.g. "1", "Small", "1h").
 * - `description`: optional longer explanation shown in tooltips.
 */
export interface IEstimatePoint {
  id: string | undefined;
  key: number | undefined;
  value: string | undefined;
  description: string | undefined;
  workspace: string | undefined;
  project: string | undefined;
  estimate: string | undefined;
  created_at: Date | undefined;
  updated_at: Date | undefined;
  created_by: string | undefined;
  updated_by: string | undefined;
}

/**
 * String-literal alias for the three estimate-system enum values from `EEstimateSystem`.
 *
 * Union values: `EEstimateSystem.POINTS` | `EEstimateSystem.CATEGORIES` | `EEstimateSystem.TIME`.
 */
export type TEstimateSystemKeys = EEstimateSystem.POINTS | EEstimateSystem.CATEGORIES | EEstimateSystem.TIME;

/**
 * Project-scoped estimate system record (one active per project, multiple historical allowed).
 *
 * Fields:
 * - `type`: which of the three systems is in use (points / categories / time).
 * - `points`: ordered list of estimate points within the system.
 * - `last_used`: true marks the currently-active estimate for the project.
 */
export interface IEstimate {
  id: string | undefined;
  name: string | undefined;
  description: string | undefined;
  type: TEstimateSystemKeys | undefined; // categories, points, time
  points: IEstimatePoint[] | undefined;
  workspace: string | undefined;
  project: string | undefined;
  last_used: boolean | undefined;
  created_at: Date | undefined;
  updated_at: Date | undefined;
  created_by: string | undefined;
  updated_by: string | undefined;
}

/**
 * Form payload submitted when creating/editing an estimate.
 *
 * Fields:
 * - `estimate.name`: human label for the estimate.
 * - `estimate.type`: estimate-system key (matches `TEstimateSystemKeys` values).
 * - `estimate.last_used`: when true, this estimate becomes the project's active estimate.
 * - `estimate_points`: ordered list of points (key + value; id optional when creating).
 */
export interface IEstimateFormData {
  estimate?: {
    name?: string;
    type?: string;
    last_used?: boolean;
  };
  estimate_points: {
    id?: string | undefined;
    key: number;
    value: string;
  }[];
}

/**
 * Single estimate-point form value (id optional during create).
 *
 * Fields:
 * - `key`: ordering position (0-indexed).
 * - `value`: human-readable label.
 */
export type TEstimatePointsObject = {
  id?: string | undefined;
  key: number;
  value: string;
};

/**
 * Predefined estimate-system template (e.g. Fibonacci, t-shirt sizes).
 *
 * Fields:
 * - `i18n_title`: localization key for the template name.
 * - `values`: pre-populated estimate-point list.
 * - `hide`: true to hide the template from the picker (deprecated/legacy templates).
 */
export type TTemplateValues = {
  title: string;
  i18n_title: string;
  values: TEstimatePointsObject[];
  hide?: boolean;
};

/**
 * Metadata for a single estimate system (one entry per `TEstimateSystemKeys` value).
 *
 * Fields:
 * - `i18n_name`: localization key for the system name (e.g. "Points", "Categories", "Time").
 * - `templates`: ready-made estimate-point sets the user can apply with one click.
 * - `is_available`: true when the system is enabled for the current plan.
 * - `is_ee`: true when the system is enterprise-only.
 */
export type TEstimateSystem = {
  name: string;
  i18n_name: string;
  templates: Record<string, TTemplateValues>;
  is_available: boolean;
  is_ee: boolean;
};

/**
 * Map of every available estimate system keyed by `TEstimateSystemKeys`.
 *
 * Each value is the full metadata for that system. Used by the project settings →
 * estimates page to render the system picker.
 */
export type TEstimateSystems = {
  [K in TEstimateSystemKeys]: TEstimateSystem;
};

// update estimates
/**
 * Stage discriminator for the multi-step estimate update wizard.
 *
 * Union values:
 * - `EEstimateUpdateStages.CREATE`: initial create flow.
 * - `EEstimateUpdateStages.EDIT`: editing an existing estimate.
 * - `EEstimateUpdateStages.SWITCH`: switching the active estimate (data migration step).
 */
export type TEstimateUpdateStageKeys =
  | EEstimateUpdateStages.CREATE
  | EEstimateUpdateStages.EDIT
  | EEstimateUpdateStages.SWITCH;

/**
 * Validation error captured during inline estimate-point editing.
 *
 * Fields:
 * - `oldValue` / `newValue`: snapshot for revert-on-cancel.
 * - `message`: localized error string; undefined when no error.
 */
export type TEstimateTypeErrorObject = {
  oldValue: string;
  newValue: string;
  message: string | undefined;
};

/**
 * Map of estimate-point validation errors keyed by point index.
 *
 * `undefined` when there are no errors anywhere in the form.
 */
export type TEstimateTypeError = Record<number, TEstimateTypeErrorObject> | undefined;
