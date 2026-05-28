/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Sticky upsell banner shown in the issues bulk-operations area to promote Plane One bulk-edit features.
 *
 * Rendered purpose: a `sticky bottom-0` banner that pins to the bottom of its scroll container and presents
 * a short benefits message alongside an "Upgrade to One" call-to-action linking to the Plane One marketing
 * page. Used in issues list/table layouts where a community user has selected multiple work items but the
 * bulk-edit capability is paywalled.
 *
 * Props:
 *   - className (string, optional): wrapper-level class overrides merged via `cn` into the default sticky
 *     container classes. No other prop is exposed; the banner has no toggling, dismissal, or state.
 *
 * MobX stores read: none. This is a pure presentation component with no observable subscriptions.
 *
 * Side effects:
 *   - External navigation: the CTA `<a href={MARKETING_PLANE_ONE_PAGE_LINK} target="_blank" rel="noopener noreferrer">`
 *     opens the Plane One marketing page in a new browser tab. The destination URL is centralized in
 *     `@plane/constants` so the marketing route is not hardcoded here.
 *   - No mutations, no service calls, no router navigations, no clipboard writes.
 *
 * Accessibility / styling notes:
 *   - The external link uses `rel="noopener noreferrer"` for the standard new-tab safety contract.
 *   - The CTA is styled through the shared design-system helper `getButtonStyling("primary", "base")` from
 *     `@plane/propel/button` so it stays consistent with other primary action buttons across the app.
 *   - Layout classes use Tailwind utilities only; no imperative DOM access.
 */

import { MARKETING_PLANE_ONE_PAGE_LINK } from "@plane/constants";
import { getButtonStyling } from "@plane/propel/button";
import { cn } from "@plane/utils";

type Props = {
  className?: string;
};

export function BulkOperationsUpgradeBanner(props: Props) {
  const { className } = props;

  return (
    <div className={cn("sticky bottom-0 left-0 z-[2] grid h-20 place-items-center px-3.5", className)}>
      <div className="flex h-14 w-full items-center justify-between gap-2 rounded-md border-[0.5px] border-accent-strong/50 bg-accent-primary/10 px-3.5 py-4">
        <p className="font-medium text-accent-primary">
          Change state, priority, and more for several work items at once. Save three minutes on an average per
          operation.
        </p>
        <a
          href={MARKETING_PLANE_ONE_PAGE_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(getButtonStyling("primary", "base"), "flex-shrink-0")}
        >
          Upgrade to One
        </a>
      </div>
    </div>
  );
}
