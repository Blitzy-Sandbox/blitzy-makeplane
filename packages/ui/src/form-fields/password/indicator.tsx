/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Visual password-strength indicator rendering a three-segment meter, a contextual strength
 * message, and an optional criteria checklist.
 *
 * Consumes scoring from `@plane/utils.getPasswordStrength` + `getPasswordCriteria` and
 * presentation tokens from `./helper`, so this file is pure render-time and re-rendering is
 * driven entirely by the `password` prop changing in the parent (typically `PasswordInput`).
 */

import { CircleCheck } from "lucide-react";
import React from "react";
import { E_PASSWORD_STRENGTH } from "@plane/constants";
import { cn, getPasswordStrength, getPasswordCriteria } from "@plane/utils";
import { getStrengthInfo, getFragmentColor } from "./helper";

/**
 * Props for the `PasswordStrengthIndicator`.
 *
 * - `password` (required): the current password string the indicator evaluates each render.
 * - `showCriteria` (default `true`): when true, renders the per-criterion checklist below the
 *   meter; when false, only the meter and message render.
 * - `isFocused` (default `false`): keeps the meter visible while the parent password input is
 *   focused even after the password becomes strong — this is the WHY behind the
 *   `isPasswordMeterVisible` derivation: hide success feedback once the input is blurred to
 *   reduce visual noise, but keep it visible during typing so the user sees their progress.
 */
export interface PasswordStrengthIndicatorProps {
  password: string;
  showCriteria?: boolean;
  isFocused?: boolean;
}

/**
 * Renders the password-strength meter (three segmented bars), an inline label describing the
 * current strength, and an optional per-criterion checklist with check-circle icons.
 *
 * Visibility rules (the WHY behind the conditional return on line 30):
 *   - Returns `null` when `password` is empty AND `showCriteria` is false (nothing to show).
 *   - Hides the meter once the password reaches `STRENGTH_VALID` AND the parent input is not
 *     focused — keeps post-validation UI clean while still showing live feedback during typing.
 *
 * The active fragment count and colors are derived once per render via `getStrengthInfo` from
 * `./helper`, and individual fragment colors come from `getFragmentColor` so all filled bars
 * share the same color for the current strength tier.
 *
 * Props (see `PasswordStrengthIndicatorProps`):
 *   - `password` (required): drives strength evaluation each render.
 *   - `showCriteria` (default `true`): toggles the criterion checklist.
 *   - `isFocused` (default `false`): keeps the meter visible at strong strength while typing.
 *
 * Accessibility: INTENT UNCLEAR: the meter does not expose `role="progressbar"` with
 * `aria-valuenow`/`aria-valuemax`, so screen readers do not announce the strength progress.
 * The criterion list uses icon-only state indicators (CircleCheck colored differently for
 * valid/invalid) with text labels alongside, so the labels remain accessible.
 */
export function PasswordStrengthIndicator({
  password,
  showCriteria = true,
  isFocused = false,
}: PasswordStrengthIndicatorProps) {
  const strength = getPasswordStrength(password);
  const criteria = getPasswordCriteria(password);
  const strengthInfo = getStrengthInfo(strength);

  const isPasswordMeterVisible = isFocused ? true : strength === E_PASSWORD_STRENGTH.STRENGTH_VALID ? false : true;

  if ((!password && !showCriteria) || !isPasswordMeterVisible) {
    return null;
  }

  return (
    <div className={cn("space-y-3")}>
      {/* Strength Indicator */}
      <div className="space-y-2">
        <div className="flex w-full gap-1 transition-all duration-300 ease-linear">
          {[0, 1, 2].map((fragmentIndex) => (
            <div
              key={fragmentIndex}
              className={cn(
                "h-1 flex-1 rounded-xs transition-all duration-300 ease-in-out",
                getFragmentColor(fragmentIndex, strengthInfo.activeFragments)
              )}
            />
          ))}
        </div>

        {/* Strength Message */}
        {password && <p className={cn("!text-13 font-medium", strengthInfo.textColor)}>{strengthInfo.message}</p>}
      </div>

      {/* Criteria list */}
      {showCriteria && (
        <div className="flex flex-wrap gap-2">
          {criteria.map((criterion) => (
            <div key={criterion.key} className="flex items-center gap-1.5">
              <div className="flex items-center justify-center p-0.5">
                <CircleCheck
                  className={cn("h-3 w-3 flex-shrink-0", {
                    "text-success-primary": criterion.isValid,
                    "text-primary": !criterion.isValid,
                  })}
                />
              </div>
              <span
                className={cn("!text-11", {
                  "text-success-primary": criterion.isValid,
                  "text-primary": !criterion.isValid,
                })}
              >
                {criterion.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
