/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Default workspace sidebar width in pixels (collapsed default view).
 *
 * Consumers: workspace sidebar layout in `apps/web/core/components/**` and CSS-in-JS style
 * computations that key off sidebar geometry.
 */
export const SIDEBAR_WIDTH = 250;

/**
 * Extended workspace sidebar width in pixels (expanded/wide mode).
 *
 * Consumers: workspace sidebar layout in `apps/web/core/components/**` when the secondary
 * detail pane or larger nav is rendered.
 */
export const EXTENDED_SIDEBAR_WIDTH = 300;
