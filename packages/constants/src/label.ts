/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Canonical client-side label color palette (the backend `Label.color` CharField does not constrain to this list).
 * Consumers: `<ColorPickerInput colors={...} />` in `apps/web/core/components/labels/create-update-label-inline.tsx`.
 */
export const LABEL_COLOR_OPTIONS = [
  "#FF6900",
  "#FCB900",
  "#7BDCB5",
  "#00D084",
  "#8ED1FC",
  "#0693E3",
  "#ABB8C3",
  "#EB144C",
  "#F78DA7",
  "#9900EF",
];

/**
 * Returns a random color from {@link LABEL_COLOR_OPTIONS} so new labels get a varied default without forcing manual color selection.
 * Consumers: label create form in `apps/web/core/components/labels/**` and inline-create paths in `apps/web/core/components/issues/{select,issue-layouts/properties,issue-detail/label/select}/**`.
 */
export const getRandomLabelColor = () => {
  const randomIndex = Math.floor(Math.random() * LABEL_COLOR_OPTIONS.length);
  return LABEL_COLOR_OPTIONS[randomIndex];
};
