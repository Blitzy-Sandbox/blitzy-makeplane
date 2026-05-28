/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Applied date filter chips.
 *
 * Rendered purpose: renders one removable chip per currently-applied date filter token in the issue
 * layout's applied-filters bar. Date tokens are either named presets (e.g. "1_weeks") or composite
 * `"YYYY-MM-DD;<before|after>"` tuples for custom date ranges.
 *
 * Props (`Props`):
 *   - `handleRemove` (`(val: string) => void`, required): invoked with the date token that should be
 *     removed from the active filter. The parent aggregator is responsible for invoking
 *     `issuesFilter.updateFilters(workspaceSlug, projectId, EIssueFilterType.FILTERS, { ...dateKey: <next> })`.
 *   - `values` (`string[]`, required): currently-applied date tokens (either preset values such as
 *     `"1_weeks"` from `DATE_AFTER_FILTER_OPTIONS` or `"<ISO-date>;<after|before>"` composites).
 *
 * NOTE: unlike most chips in this folder, `AppliedDateFilters` has NO `editable` prop — the close
 * button is always rendered. (Date filter chips do not appear in read-only contexts.)
 *
 * MobX stores read: none. Token-to-label resolution uses `DATE_AFTER_FILTER_OPTIONS` from
 * `@plane/constants` plus `renderFormattedDate` / `capitalizeFirstLetter` helpers from `@plane/utils`.
 *
 * Side effects: none — render-only; the only outbound interaction is `handleRemove(date)` on click.
 */

import { observer } from "mobx-react";
// icons
import { DATE_AFTER_FILTER_OPTIONS } from "@plane/constants";
import { CloseIcon } from "@plane/propel/icons";
// helpers
import { renderFormattedDate, capitalizeFirstLetter } from "@plane/utils";
// constants

type Props = {
  handleRemove: (val: string) => void;
  values: string[];
};

export const AppliedDateFilters = observer(function AppliedDateFilters(props: Props) {
  const { handleRemove, values } = props;

  const getDateLabel = (value: string): string => {
    let dateLabel = "";

    const dateDetails = DATE_AFTER_FILTER_OPTIONS.find((d) => d.value === value);

    if (dateDetails) dateLabel = dateDetails.name;
    else {
      const dateParts = value.split(";");

      if (dateParts.length === 2) {
        const [date, time] = dateParts;

        dateLabel = `${capitalizeFirstLetter(time)} ${renderFormattedDate(date)}`;
      }
    }

    return dateLabel;
  };

  return (
    <>
      {values.map((date) => (
        <div key={date} className="flex items-center gap-1 rounded-sm bg-layer-1 p-1 text-11">
          <span className="normal-case">{getDateLabel(date)}</span>
          <button
            type="button"
            className="grid place-items-center text-tertiary hover:text-secondary"
            onClick={() => handleRemove(date)}
          >
            <CloseIcon height={10} width={10} strokeWidth={2} />
          </button>
        </div>
      ))}
    </>
  );
});
