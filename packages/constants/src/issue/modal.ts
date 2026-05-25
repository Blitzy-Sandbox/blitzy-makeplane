/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import type { TIssue } from "@plane/types";

/**
 * Default form state for the work-item (issue) create modal — used both as the
 * initial value on modal open and as the reset payload after a successful submit
 * or modal close.
 *
 * Cross-stack contract: `priority: "none"` mirrors the `Issue.priority` CharField
 * default in `apps/api/plane/db/models/issue.py`. Do NOT change this string without
 * a corresponding backend migration.
 *
 * Field-shape conventions:
 * - `""` (empty string) for required foreign-key ids the form must populate before
 *   submit (`project_id`, `state_id`).
 * - `null` for optional foreign-key ids and date fields (`type_id`, `parent_id`,
 *   `estimate_point`, `cycle_id`, `module_ids`, `start_date`, `target_date`).
 * - `[]` for many-to-many id arrays (`assignee_ids`, `label_ids`).
 *
 * Note: `module_ids` is intentionally `null` (not `[]`) — it represents an
 * intentionally-absent module relation rather than an empty selection.
 *
 * Consumers: `apps/web/core/components/issues/issue-modal/**` work-item create
 * modal initial values and form-reset logic.
 */
export const DEFAULT_WORK_ITEM_FORM_VALUES: Partial<TIssue> = {
  project_id: "",
  type_id: null,
  name: "",
  description_html: "",
  estimate_point: null,
  state_id: "",
  parent_id: null,
  priority: "none",
  assignee_ids: [],
  label_ids: [],
  cycle_id: null,
  module_ids: null,
  start_date: null,
  target_date: null,
};
