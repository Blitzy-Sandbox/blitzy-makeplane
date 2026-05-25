/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Keyboard-accessibility source of truth: field-name orderings consumed by each modal form to compute `tabIndex` via `Array.prototype.indexOf` so Tab/Shift+Tab navigates in the documented logical order.
 * Editing these arrays changes keyboard navigation order — preserve relative ordering of existing entries when adding new fields.
 */

/**
 * Tab order for the work-item (issue) create/edit form: title → description → priority
 * → assignees → label → dates → cycle/module → estimate → parent → form controls.
 *
 * Consumers: `apps/web/core/components/issues/issue-modal/**`.
 */
export const ISSUE_FORM_TAB_INDICES = [
  "name",
  "description_html",
  "feeling_lucky",
  "state_id",
  "priority",
  "assignee_ids",
  "label_ids",
  "start_date",
  "target_date",
  "cycle_id",
  "module_ids",
  "estimate_point",
  "parent_id",
  "create_more",
  "discard_button",
  "draft_button",
  "submit_button",
  "project_id",
  "remove_parent",
];

/**
 * Tab order for the intake-issue create form — same as the issue form minus the
 * `feeling_lucky` AI assist button and the draft button (intake issues are not drafts).
 *
 * Consumers: `apps/web/core/components/intake/**`.
 */
export const INTAKE_ISSUE_CREATE_FORM_TAB_INDICES = [
  "name",
  "description_html",
  "state_id",
  "priority",
  "assignee_ids",
  "label_ids",
  "start_date",
  "target_date",
  "cycle_id",
  "module_ids",
  "estimate_point",
  "parent_id",
  "create_more",
  "discard_button",
  "submit_button",
];

/**
 * Tab order for the label create form: name → color → cancel → submit.
 *
 * Consumers: `apps/web/core/components/labels/**`.
 */
export const CREATE_LABEL_TAB_INDICES = ["name", "color", "cancel", "submit"];

/**
 * Tab order for the project create form.
 *
 * Consumers: `apps/web/core/components/project/**`.
 */
export const PROJECT_CREATE_TAB_INDICES = [
  "name",
  "identifier",
  "description",
  "network",
  "lead",
  "cancel",
  "submit",
  "close",
  "cover_image",
  "logo_props",
];

/**
 * Tab order for the cycle create form.
 *
 * Consumers: `apps/web/core/components/cycles/**`.
 */
export const PROJECT_CYCLE_TAB_INDICES = ["name", "description", "date_range", "cancel", "submit", "project_id"];

/**
 * Tab order for the module create form.
 *
 * Consumers: `apps/web/core/components/modules/**`.
 */
export const PROJECT_MODULE_TAB_INDICES = [
  "name",
  "description",
  "date_range",
  "status",
  "lead",
  "member_ids",
  "cancel",
  "submit",
];

/**
 * Tab order for the project view create form.
 *
 * Consumers: `apps/web/core/components/views/**`.
 */
export const PROJECT_VIEW_TAB_INDICES = ["name", "description", "filters", "cancel", "submit"];

/**
 * Tab order for the project page create form.
 *
 * Consumers: `apps/web/core/components/pages/**`.
 */
export const PROJECT_PAGE_TAB_INDICES = ["name", "public", "private", "cancel", "submit"];

/**
 * Form identifier enum used by the `getTabIndex(form, fieldName)` helper to look
 * up the tab order for the active form.
 *
 * Consumers: `apps/web/core/components/**` form helpers that compute tab indices
 * via `TAB_INDEX_MAP[form].indexOf(fieldName)`.
 */
export enum ETabIndices {
  ISSUE_FORM = "issue-form",
  INTAKE_ISSUE_FORM = "intake-issue-form",
  CREATE_LABEL = "create-label",
  PROJECT_CREATE = "project-create",
  PROJECT_CYCLE = "project-cycle",
  PROJECT_MODULE = "project-module",
  PROJECT_VIEW = "project-view",
  PROJECT_PAGE = "project-page",
}

/**
 * Lookup table: maps an `ETabIndices` form identifier to its tab-order array.
 *
 * Consumers: `apps/web/core/components/**` form helpers.
 */
export const TAB_INDEX_MAP: Record<ETabIndices, string[]> = {
  [ETabIndices.ISSUE_FORM]: ISSUE_FORM_TAB_INDICES,
  [ETabIndices.INTAKE_ISSUE_FORM]: INTAKE_ISSUE_CREATE_FORM_TAB_INDICES,
  [ETabIndices.CREATE_LABEL]: CREATE_LABEL_TAB_INDICES,
  [ETabIndices.PROJECT_CREATE]: PROJECT_CREATE_TAB_INDICES,
  [ETabIndices.PROJECT_CYCLE]: PROJECT_CYCLE_TAB_INDICES,
  [ETabIndices.PROJECT_MODULE]: PROJECT_MODULE_TAB_INDICES,
  [ETabIndices.PROJECT_VIEW]: PROJECT_VIEW_TAB_INDICES,
  [ETabIndices.PROJECT_PAGE]: PROJECT_PAGE_TAB_INDICES,
};
