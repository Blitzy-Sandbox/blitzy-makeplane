/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * @plane/ui — legacy shared component library for Plane.
 *
 * Public API surface (33 sub-modules star-re-exported below):
 *
 * Buttons & input: button, form-fields, auth-form, oauth, color-picker
 * Containers:      card, content-wrapper, modals, row, header
 * Navigation:      tabs, breadcrumbs, dropdown, dropdowns
 * Data display:    avatar, badge, tag, progress, loader, tables, typography
 * Overlays:        tooltip, popovers, link, control-link
 * Interactive:     drag-handle, drop-indicator, sortable, scroll-area, collapsible, favorite-star
 * Utility:         constants, utils, spinners
 *
 * Consumers: apps/web, apps/admin, apps/space (via "@plane/ui" workspace dependency).
 * Treat every transitively exported symbol as part of the package's public contract.
 */

export * from "./avatar";
export * from "./badge";
export * from "./breadcrumbs";
export * from "./button";
export * from "./card";
export * from "./collapsible";
export * from "./color-picker";
export * from "./constants";
export * from "./content-wrapper";
export * from "./control-link";
export * from "./drag-handle";
export * from "./drop-indicator";
export * from "./dropdown";
export * from "./dropdowns";
export * from "./favorite-star";
export * from "./form-fields";
export * from "./header";
export * from "./link";
export * from "./loader";
export * from "./modals";
export * from "./popovers";
export * from "./progress";
export * from "./row";
export * from "./scroll-area";
export * from "./sortable";
export * from "./spinners";
export * from "./tables";
export * from "./tabs";
export * from "./tag";
export * from "./tooltip";
export * from "./typography";
export * from "./utils";
export * from "./oauth";
