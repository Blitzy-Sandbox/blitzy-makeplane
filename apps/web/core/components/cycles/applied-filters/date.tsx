/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Presentational chip renderer for cycle "start_date" / "end_date" filters — one
 * removable pill per selected date filter token, formatting either a predefined
 * relative-date option (e.g., "Last week") or a custom semicolon-delimited
 * `<iso-date>;<after|before>` token into a human-readable label.
 *
 * Props:
 *   - editable (boolean | undefined, required): when truthy, renders the CloseIcon
 *     remove button on each chip; when falsy, chips are display-only.
 *   - handleRemove ((val: string) => void, required): caller-owned callback invoked
 *     when the user clicks a chip's close button; the parent (CycleAppliedFiltersList
 *     in ./root) wires this to handleRemoveFilter(<dateKey>, val) where <dateKey> is
 *     either "start_date" or "end_date".
 *   - values (string[], required): the currently selected date filter tokens to
 *     render; each is resolved by the local `getDateLabel` helper.
 *
 * MobX stores read:
 *   - None — this component is purely presentational. It is wrapped in `observer`
 *     for consistency with sibling chip renderers and to participate cleanly if a
 *     consumer ever passes observable arrays.
 *
 * Side effects:
 *   - None directly — invokes the `handleRemove` prop callback on click. All filter
 *     mutations and downstream API calls are owned by the parent's wired-up store
 *     action (cycle filter store).
 *
 * Token format consumed:
 *   - Predefined: token value matches DATE_AFTER_FILTER_OPTIONS[].value (e.g.,
 *     "last_week", "last_month") → label resolved from the catalog's `name`.
 *   - Custom: token shaped as `"<ISO-date>;<after|before>"` → label assembled as
 *     `"<Capitalized-direction> <formatted-date>"` via capitalizeFirstLetter +
 *     renderFormattedDate.
 *   - Unknown shapes (length != 2 after split, not in catalog) → empty label (the
 *     chip still renders but with no visible text); this is defensive behavior.
 *
 * Consumers: rendered by CycleAppliedFiltersList (./root) for the "start_date" and
 * "end_date" filter keys (the DATE_FILTERS set in ./root.tsx).
 */

import { observer } from "mobx-react";
// helpers
import { DATE_AFTER_FILTER_OPTIONS } from "@plane/constants";
import { CloseIcon } from "@plane/propel/icons";
import { renderFormattedDate, capitalizeFirstLetter } from "@plane/utils";
// constants

type Props = {
  editable: boolean | undefined;
  handleRemove: (val: string) => void;
  values: string[];
};

export const AppliedDateFilters = observer(function AppliedDateFilters(props: Props) {
  const { editable, handleRemove, values } = props;

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
        <div key={date} className="flex items-center gap-1 rounded-sm bg-layer-3 px-1.5 py-1 text-11">
          <span className="normal-case">{getDateLabel(date)}</span>
          {editable && (
            <button
              type="button"
              className="grid place-items-center text-tertiary hover:text-secondary"
              onClick={() => handleRemove(date)}
            >
              <CloseIcon height={10} width={10} strokeWidth={2} />
            </button>
          )}
        </div>
      ))}
    </>
  );
});
