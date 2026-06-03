/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Reusable work-item identifier label with optional click-to-copy clipboard behavior.
 *
 * Rendered purpose: a `Tooltip`-wrapped `<button>` that displays the supplied identifier text
 * (e.g. "PROJ-123") in one of four typography sizes and six color variants. When
 * `enableClickToCopyIdentifier` is true, clicking copies the identifier to the system clipboard and
 * emits a success toast; otherwise the button is rendered as `disabled`.
 *
 * Props (TIdentifierTextProps from `@plane/types`):
 *   - identifier (string, required): the displayed text (typically `{projectIdentifier}-{sequenceId}`)
 *   - enableClickToCopyIdentifier (boolean, optional, default=false): toggles clipboard behavior and
 *     visual `cursor-pointer` affordance
 *   - size (TIssueIdentifierSize, optional, default="lg"): one of "xs"|"sm"|"md"|"lg" — mapped through
 *     `SIZE_MAP` to a typography utility class
 *   - variant (TIdentifierTextVariant, optional, default="default"): one of
 *     "default"|"secondary"|"tertiary"|"primary"|"primary-subtle"|"success" — mapped through
 *     `VARIANT_MAP` to a text-color utility class
 *
 * MobX stores read: none — this is a pure presentational primitive.
 *
 * Side effects:
 *   - Clipboard write via `navigator.clipboard.writeText(identifier)` when
 *     `enableClickToCopyIdentifier` is true.
 *   - Success toast emission via `setToast({ type: TOAST_TYPE.SUCCESS, title: "Work item ID copied to clipboard" })`.
 *   - On clipboard failure, logs to `console.error` (no error toast — silent fallback to keep the UI
 *     unobtrusive when the user is interacting with another element).
 *
 * Accessibility notes:
 *   - Native `<button type="button">` provides keyboard focus and Enter/Space activation.
 *   - The button is `disabled` whenever copy is not enabled, so screen readers announce its non-interactive state.
 *   - The wrapping `Tooltip` shows "Click to copy" hint text only when copy is enabled (`disabled={!enableClickToCopyIdentifier}`).
 *
 * Consumers: rendered inside issue-detail-related views and shared issue rendering
 * primitives that surface a work-item identifier — for example `./root.tsx`
 * (`IssueDetailRoot` header), the peek-overview body, and list/board cards across
 * the issue layouts.
 */
import { setToast, TOAST_TYPE } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import type { TIdentifierTextProps, TIdentifierTextVariant, TIssueIdentifierSize } from "@plane/types";
import { cn } from "@plane/utils";

const SIZE_MAP: Record<TIssueIdentifierSize, string> = {
  xs: "text-caption-sm-regular",
  sm: "text-caption-sm-medium",
  md: "text-caption-md-medium",
  lg: "text-caption-lg-medium",
};

const VARIANT_MAP: Record<TIdentifierTextVariant, string> = {
  default: "text-tertiary",
  secondary: "text-secondary",
  tertiary: "text-tertiary",
  primary: "text-primary",
  "primary-subtle": "text-primary/80",
  success: "text-success-primary",
};

export function IdentifierText(props: TIdentifierTextProps) {
  const { identifier, enableClickToCopyIdentifier = false, size = "lg", variant = "default" } = props;
  // handlers
  const handleCopyIssueIdentifier = () => {
    if (enableClickToCopyIdentifier) {
      navigator.clipboard
        .writeText(identifier)
        .then(() => {
          setToast({
            type: TOAST_TYPE.SUCCESS,
            title: "Work item ID copied to clipboard",
          });
          return;
        })
        .catch(() => {
          console.error("Failed to copy work item ID");
        });
    }
  };

  const textSizeClassName = SIZE_MAP[size];
  const variantClassName = VARIANT_MAP[variant];

  return (
    <Tooltip tooltipContent="Click to copy" disabled={!enableClickToCopyIdentifier} position="top">
      <button
        type="button"
        className={cn("text-12 font-medium whitespace-nowrap text-tertiary", textSizeClassName, variantClassName, {
          "cursor-pointer": enableClickToCopyIdentifier,
        })}
        onClick={handleCopyIssueIdentifier}
        disabled={!enableClickToCopyIdentifier}
      >
        {identifier}
      </button>
    </Tooltip>
  );
}
