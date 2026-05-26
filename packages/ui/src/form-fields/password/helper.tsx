/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Password strength scoring helpers backing the `PasswordStrengthIndicator` and `PasswordInput`
 * components.
 *
 * The two exports translate the shared `E_PASSWORD_STRENGTH` enum into UI-ready presentation
 * tokens — message text, color class, active fragment count — so the segmented meter and its
 * label stay in lockstep with whatever strength logic `@plane/utils` decides upstream.
 *
 * These helpers are pure (no React state, no side effects) so they are safe to call during
 * render.
 */

import { E_PASSWORD_STRENGTH } from "@plane/constants";

/**
 * Presentation tokens for a single password-strength state.
 *
 * - `message`: human-readable strength label rendered below the meter.
 * - `textColor`: Tailwind text-color class (e.g., `text-success-primary`) for the label.
 * - `activeFragments`: number of meter segments (0–3) that should be filled, where 0 means
 *   empty/unstarted and 3 means fully strong.
 */
export interface StrengthInfo {
  message: string;
  textColor: string;
  activeFragments: number;
}

/**
 * Map a password-strength enum value to the UI presentation tokens for the meter and label.
 *
 * Returns a `StrengthInfo` triple — message, text color class, and number of active meter
 * fragments (0–3) — covering the four documented states (`EMPTY`, `LENGTH_NOT_VALID`,
 * `STRENGTH_NOT_VALID`, `STRENGTH_VALID`) and a safe default for unrecognised values.
 *
 * @param strength - the `E_PASSWORD_STRENGTH` value computed by `@plane/utils.getPasswordStrength`.
 * @returns presentation tokens that the indicator and input components read directly without
 *   re-deriving styling from the raw enum.
 */
export const getStrengthInfo = (strength: E_PASSWORD_STRENGTH): StrengthInfo => {
  switch (strength) {
    case E_PASSWORD_STRENGTH.EMPTY:
      return {
        message: "Please enter your password",
        textColor: "text-primary",
        activeFragments: 0,
      };
    case E_PASSWORD_STRENGTH.LENGTH_NOT_VALID:
      return {
        message: "Password is too short",
        textColor: "text-danger-primary",
        activeFragments: 1,
      };
    case E_PASSWORD_STRENGTH.STRENGTH_NOT_VALID:
      return {
        message: "Password is weak",
        textColor: "text-orange-500",
        activeFragments: 2,
      };
    case E_PASSWORD_STRENGTH.STRENGTH_VALID:
      return {
        message: "Password is strong",
        textColor: "text-success-primary",
        activeFragments: 3,
      };
    default:
      return {
        message: "Please enter your password",
        textColor: "text-primary",
        activeFragments: 0,
      };
  }
};

/**
 * Pick the Tailwind background-color class for a single meter fragment.
 *
 * Fragments at indexes >= `activeFragments` are inactive (`bg-layer-1`); active fragments take
 * the color of the active strength tier — red for one filled bar (length invalid), orange for
 * two (weak), green for three (strong). The tier color comes from `activeFragments` (not
 * `fragmentIndex`) so all filled bars share the same color in a given strength state.
 *
 * @param fragmentIndex - zero-based position of this fragment in the meter (0, 1, or 2).
 * @param activeFragments - total number of filled fragments for the current strength.
 * @returns Tailwind background-color class.
 */
export const getFragmentColor = (fragmentIndex: number, activeFragments: number): string => {
  if (fragmentIndex >= activeFragments) {
    return "bg-layer-1";
  }

  switch (activeFragments) {
    case 1:
      return "bg-danger-primary";
    case 2:
      return "bg-orange-500";
    case 3:
      return "bg-success-primary";
    default:
      return "bg-layer-1";
  }
};
