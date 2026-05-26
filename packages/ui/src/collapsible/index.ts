/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Barrel module for the collapsible disclosure feature.
 *
 * Re-exports `Collapsible` and `CollapsibleButton` for paired disclosure composition:
 * consumers import both symbols from `@plane/ui` so a `CollapsibleButton` header can
 * be composed alongside the `Collapsible` panel as a single disclosure unit.
 */

export * from "./collapsible";
export * from "./collapsible-button";
