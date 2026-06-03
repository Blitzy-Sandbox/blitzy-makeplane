/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Empty / error fallback for the work item peek-overview panel.
 *
 * Rendered purpose: displays a standardized `EmptyState` ("Work item does not exist") when the
 * panel cannot resolve a work item — typically because the issue was archived, deleted, or never
 * existed under the current scope. Retains a dismiss button so the user can close the empty state.
 *
 * Props (TIssuePeekOverviewError):
 *   - removeRoutePeekId (() => void, required): close-peek callback supplied by the parent view shell;
 *     wired to the visible dismiss button (`MoveRight` icon) so the user can return to the underlying view
 *
 * MobX stores read: none — pure presentational primitive.
 *
 * Side effects: none — the only interactive element is the dismiss button, which simply calls the
 * caller-supplied `removeRoutePeekId` callback.
 *
 * Architectural notes:
 *   - `EmptyState` is the shared empty-state primitive from `@/components/common/empty-state`.
 *   - The empty-state image is imported with the Vite `?url` query suffix
 *     (`@/app/assets/empty-state/issue.svg?url`) so the bundler resolves it as a string URL that the
 *     `<img>` tag can use directly. This is VITE-specific build-time URL asset resolution — the
 *     `?url` query is baked in at build time by the Vite asset pipeline.
 *   - `Tooltip` from `@plane/propel/tooltip`; `usePlatformOS()` (from `@/hooks/use-platform-os`) toggles
 *     mobile tooltip behavior.
 *
 * Accessibility notes:
 *   - The dismiss button retains a keyboard-focusable `<button>` wrapped in `Tooltip`, so keyboard
 *     users can dismiss the error without using the mouse.
 *
 * Consumers:
 *   - `apps/web/core/components/issues/peek-overview/view.tsx` — rendered when `isError === true`
 */
import { MoveRight } from "lucide-react";
import { Tooltip } from "@plane/propel/tooltip";
// assets
import emptyIssue from "@/app/assets/empty-state/issue.svg?url";
// components
import { EmptyState } from "@/components/common/empty-state";
// hooks
import { usePlatformOS } from "@/hooks/use-platform-os";

type TIssuePeekOverviewError = {
  removeRoutePeekId: () => void;
};

export function IssuePeekOverviewError(props: TIssuePeekOverviewError) {
  const { removeRoutePeekId } = props;
  // hooks
  const { isMobile } = usePlatformOS();

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      <div className="flex flex-shrink-0 justify-start">
        <Tooltip tooltipContent="Close the peek view" isMobile={isMobile}>
          <button onClick={removeRoutePeekId} className="m-5 h-5 w-5">
            <MoveRight className="h-4 w-4 text-tertiary hover:text-secondary" />
          </button>
        </Tooltip>
      </div>

      <div className="h-full w-full">
        <EmptyState
          image={emptyIssue ?? undefined}
          title="Work item does not exist"
          description="The work item you are looking for does not exist, has been archived, or has been deleted."
        />
      </div>
    </div>
  );
}
