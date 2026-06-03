/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * View access-level option catalog consumed by the project view create/edit
 * form's access picker in `apps/web/core/components/views/**`.
 */

import { EViewAccess } from "@plane/types";

/**
 * Access-level options for project views — pairs each `EViewAccess` value with
 * its i18n label for use in the view create/edit form's access picker.
 *
 * Consumers: view create/edit form + modal in `apps/web/core/components/views/**`
 * (decorated with icons via `apps/web/helpers/views.helper.ts`).
 */
export const VIEW_ACCESS_SPECIFIERS: {
  key: EViewAccess;
  i18n_label: string;
}[] = [
  { key: EViewAccess.PUBLIC, i18n_label: "common.access.public" },
  { key: EViewAccess.PRIVATE, i18n_label: "common.access.private" },
];

/**
 * Sort-by key options for the project views list (name / created_at / updated_at).
 *
 * Consumers: views list sort dropdown in `apps/web/core/components/views/**`.
 */
export const VIEW_SORTING_KEY_OPTIONS = [
  { key: "name", i18n_label: "project_view.sort_by.name" },
  { key: "created_at", i18n_label: "project_view.sort_by.created_at" },
  { key: "updated_at", i18n_label: "project_view.sort_by.updated_at" },
];

/**
 * Sort direction options (asc/desc) for the project views list.
 *
 * Consumers: views list sort dropdown in `apps/web/core/components/views/**`.
 */
export const VIEW_SORT_BY_OPTIONS = [
  { key: "asc", i18n_label: "common.order_by.asc" },
  { key: "desc", i18n_label: "common.order_by.desc" },
];
