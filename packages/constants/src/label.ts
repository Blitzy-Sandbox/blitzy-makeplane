/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Default color palette for issue/work-item labels — hex strings rendered as
 * selectable swatches in the label color picker.
 *
 * Consumers: `apps/web/core/components/labels/create-update-label-inline.tsx`
 * passes this array to the `<ColorPickerInput colors={...} />` rendered inside
 * the label create/edit modal. The palette is the canonical client-side source
 * of label color choices; the backend `Label.color` field (a free-form
 * `CharField`) stores whatever value is submitted and does not constrain to
 * this list.
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
 * Returns a random color from {@link LABEL_COLOR_OPTIONS} so new labels get a
 * varied default appearance without forcing the user to pick a color manually.
 *
 * Consumers: pre-fills the color field of the "Create label" form in
 * `apps/web/core/components/labels/create-update-label-inline.tsx`, and supplies
 * the `color` for labels created inline from the label dropdowns in
 * `apps/web/core/components/issues/select/base.tsx`,
 * `apps/web/core/components/issues/issue-layouts/properties/label-dropdown.tsx`,
 * and `apps/web/core/components/issues/issue-detail/label/select/label-select.tsx`.
 *
 * @returns A hex color string drawn uniformly at random from the palette.
 */
export const getRandomLabelColor = () => {
  const randomIndex = Math.floor(Math.random() * LABEL_COLOR_OPTIONS.length);
  return LABEL_COLOR_OPTIONS[randomIndex];
};
