/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Skeleton placeholder for the work item peek-overview panel while initial data loads.
 *
 * Rendered purpose: mirrors the eventual peek-overview layout with `Loader.Item` skeleton blocks
 * for the header row, title + description, sub-issues, attachments, and properties sidebar. Keeps
 * the close button (`MoveRight` icon) live so users can dismiss the panel during a slow fetch.
 *
 * Props (TIssuePeekOverviewLoader):
 *   - removeRoutePeekId (() => void, required): close-peek callback supplied by the parent view shell;
 *     wired to the visible dismiss button so users are not stuck waiting on a stalled fetch
 *
 * MobX stores read: none — this is a pure visual placeholder.
 *
 * Side effects: none — the only interactive element is the dismiss button, which simply calls the
 * caller-supplied `removeRoutePeekId` callback.
 *
 * Architectural notes:
 *   - `Loader` and `Loader.Item` come from `@plane/ui`; both are presentational skeleton primitives.
 *   - `Tooltip` from `@plane/propel/tooltip`; `usePlatformOS()` (from `@/hooks/use-platform-os`) is used
 *     to toggle mobile tooltip behavior.
 *
 * Accessibility notes:
 *   - The dismiss button retains a keyboard-focusable `<button>` element wrapped in `Tooltip`, so
 *     keyboard users can escape the loading state without waiting for content.
 *
 * Consumers:
 *   - `apps/web/core/components/issues/peek-overview/view.tsx` — rendered when
 *     `isLoading && !isError`
 */
import { MoveRight } from "lucide-react";
import { Tooltip } from "@plane/propel/tooltip";
import { Loader } from "@plane/ui";
// hooks
import { usePlatformOS } from "@/hooks/use-platform-os";

type TIssuePeekOverviewLoader = {
  removeRoutePeekId: () => void;
};

export function IssuePeekOverviewLoader(props: TIssuePeekOverviewLoader) {
  const { removeRoutePeekId } = props;
  // hooks
  const { isMobile } = usePlatformOS();

  return (
    <Loader className="h-screen w-full space-y-6 overflow-hidden p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Tooltip tooltipContent="Close the peek view" isMobile={isMobile}>
            <button onClick={removeRoutePeekId}>
              <MoveRight className="h-4 w-4 text-tertiary hover:text-secondary" />
            </button>
          </Tooltip>
          <Loader.Item width="30px" height="30px" />
        </div>
        <div className="flex items-center gap-2">
          <Loader.Item width="80px" height="30px" />
          <Loader.Item width="30px" height="30px" />
          <Loader.Item width="30px" height="30px" />
          <Loader.Item width="30px" height="30px" />
        </div>
      </div>

      {/* issue title and description and comments */}
      <div className="space-y-3">
        <Loader.Item width="100px" height="20px" />

        <div className="space-y-1">
          <Loader.Item width="300px" height="15px" />
          <Loader.Item width="400px" height="15px" />
          <div className="flex items-center gap-2">
            <Loader.Item width="20px" height="15px" />
            <Loader.Item width="500px" height="15px" />
          </div>
          <div className="flex items-center gap-2">
            <Loader.Item width="20px" height="15px" />
            <Loader.Item width="200px" height="15px" />
          </div>
          <Loader.Item width="300px" height="15px" />
          <Loader.Item width="200px" height="15px" />
        </div>

        <Loader.Item width="30px" height="30px" />
      </div>

      {/* sub issues */}
      <div className="flex items-center justify-between gap-2">
        <Loader.Item width="80px" height="20px" />
        <Loader.Item width="100px" height="20px" />
      </div>

      {/* attachments */}
      <div className="space-y-3">
        <Loader.Item width="80px" height="20px" />
        <div className="flex items-center gap-2">
          <Loader.Item width="250px" height="50px" />
          <Loader.Item width="250px" height="50px" />
        </div>
      </div>

      {/* properties */}
      <div className="space-y-3">
        <Loader.Item width="80px" height="20px" />
        <div className="space-y-2">
          <div className="flex items-center gap-8">
            <Loader.Item width="150px" height="25px" />
            <Loader.Item width="150px" height="25px" />
          </div>
          <div className="flex items-center gap-8">
            <Loader.Item width="150px" height="25px" />
            <Loader.Item width="150px" height="25px" />
          </div>
          <div className="flex items-center gap-8">
            <Loader.Item width="150px" height="25px" />
            <Loader.Item width="150px" height="25px" />
          </div>
          <div className="flex items-center gap-8">
            <Loader.Item width="150px" height="25px" />
            <Loader.Item width="150px" height="25px" />
          </div>
          <div className="flex items-center gap-8">
            <Loader.Item width="150px" height="25px" />
            <Loader.Item width="150px" height="25px" />
          </div>
          <div className="flex items-center gap-8">
            <Loader.Item width="150px" height="25px" />
            <Loader.Item width="150px" height="25px" />
          </div>
        </div>
      </div>
    </Loader>
  );
}
