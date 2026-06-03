/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Presentational chip renderer for the cycle "status" filter — one removable pill
 * per selected status value (e.g., draft / current / completed), with colors and
 * localized labels resolved from the shared CYCLE_STATUS catalog.
 *
 * Props:
 *   - handleRemove ((val: string) => void, required): caller-owned callback invoked
 *     when the user clicks the chip's close button; the parent (CycleAppliedFiltersList
 *     in ./root) wires this to handleRemoveFilter("status", val).
 *   - values (string[], required): the currently selected status values to render
 *     as chips; each is matched against CYCLE_STATUS by `value` to derive label
 *     and color metadata.
 *   - editable (boolean | undefined, required): when truthy, renders the CloseIcon
 *     remove button on each chip; when falsy, chips are display-only.
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
 * Constants consumed:
 *   - CYCLE_STATUS (@plane/constants): catalog mapping status value → bgColor,
 *     textColor, i18n_title; an unknown status renders an empty label (statusDetails
 *     is falsy and the conditional `{statusDetails && t(...)}` is the no-op branch).
 *
 * Consumers: rendered by CycleAppliedFiltersList (./root) for the "status" filter key.
 */

import { observer } from "mobx-react";
// plane imports
import { CYCLE_STATUS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { CloseIcon } from "@plane/propel/icons";
import { cn } from "@plane/utils";

type Props = {
  handleRemove: (val: string) => void;
  values: string[];
  editable: boolean | undefined;
};

export const AppliedStatusFilters = observer(function AppliedStatusFilters(props: Props) {
  const { handleRemove, values, editable } = props;
  const { t } = useTranslation();

  return (
    <>
      {values.map((status) => {
        const statusDetails = CYCLE_STATUS.find((s) => s.value === status);
        return (
          <div
            key={status}
            className={cn(
              "flex items-center gap-1 rounded-sm px-1.5 py-1 text-11",
              statusDetails?.bgColor,
              statusDetails?.textColor
            )}
          >
            {statusDetails && t(statusDetails?.i18n_title)}
            {editable && (
              <button
                type="button"
                className="grid place-items-center text-tertiary hover:text-secondary"
                onClick={() => handleRemove(status)}
              >
                <CloseIcon height={10} width={10} strokeWidth={2} />
              </button>
            )}
          </div>
        );
      })}
    </>
  );
});
