/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Default Nivo chart theme bound to the active Plane theme via CSS custom properties so charts stay in sync with light/dark mode.
 * Consumers: analytics/dashboard chart components in `apps/web/core/components/**`.
 */
export const CHARTS_THEME = {
  background: "transparent",
  text: {
    color: "var(--text-color-secondary)",
  },
  axis: {
    domain: {
      line: {
        stroke: "var(--background-color-layer-2)",
        strokeWidth: 0.5,
      },
    },
  },
  tooltip: {
    container: {
      background: "var(--background-color-layer-2)",
      color: "var(--text-color-secondary)",
      fontSize: "0.8rem",
      border: "1px solid var(--border-color-strong)",
    },
  },
  grid: {
    line: {
      stroke: "var(--border-color-subtle)",
    },
  },
};

/**
 * Default outer margin (in pixels) applied to chart containers to leave room for axis
 * labels and tooltip overflow.
 *
 * Consumers: chart wrapper components in `apps/web/core/components/**`.
 */
export const CHART_DEFAULT_MARGIN = {
  top: 50,
  right: 50,
  bottom: 50,
  left: 50,
};
