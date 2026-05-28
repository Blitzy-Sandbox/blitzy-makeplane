/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel module that re-exports the public surface of the sub-issues widget — the collapsible content body, display-filter and quick-action controls,
 * the collapsible root container, and the collapsible title — so consumers (notably `../issue-detail-widget-collapsibles.tsx`) can import from this folder
 * without depending on the internal file layout.
 */

export * from "./content";
export * from "./display-filters";
export * from "./quick-action-button";
export * from "./root";
export * from "./title";
