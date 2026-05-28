/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Activity timeline loading skeleton.
 *
 * Rendered purpose: a pure presentational placeholder shown by `IssueActivityCommentRoot` while the
 * issue's combined activity/comment collection is still being resolved from the issue-detail store
 * (i.e., `getActivityAndCommentsByIssueId(...)` returns `undefined`). Renders three stacked rows,
 * each composed of a circular avatar bone and three text-line bones, to mimic the visual rhythm of
 * the loaded feed and minimize cumulative layout shift (CLS) when real activity entries replace it.
 *
 * Props: none — exported as a zero-arg React component (`IssueActivityLoader()`).
 *
 * MobX stores read: none — this is a stateless presentational primitive.
 *
 * Side effects: none — no mutations, no navigations, no API calls.
 *
 * Composition:
 *   - Uses `Loader` and `Loader.Item` primitives from `@plane/ui` for the skeleton bones.
 *   - Bone dimensions ("28px" circle + "8px"/"10px" text rows at varying widths 40–100%) mirror the
 *     rendered activity card geometry so the swap is visually stable.
 */

// plane imports
import { Loader } from "@plane/ui";

export function IssueActivityLoader() {
  return (
    <Loader className="space-y-8">
      <div className="flex items-start gap-3">
        <Loader.Item className="shrink-0" height="28px" width="28px" />
        <div className="w-full space-y-2">
          <Loader.Item height="8px" width="60%" />
          <Loader.Item height="8px" width="40%" />
          <Loader.Item height="10px" width="100%" />
        </div>
      </div>
      <div className="flex items-start gap-3">
        <Loader.Item className="shrink-0" height="28px" width="28px" />
        <div className="w-full space-y-2">
          <Loader.Item height="8px" width="40%" />
          <Loader.Item height="8px" width="60%" />
          <Loader.Item height="10px" width="80%" />
        </div>
      </div>
      <div className="flex items-start gap-3">
        <Loader.Item className="shrink-0" height="28px" width="28px" />
        <div className="w-full space-y-2">
          <Loader.Item height="8px" width="60%" />
          <Loader.Item height="8px" width="40%" />
          <Loader.Item height="10px" width="100%" />
        </div>
      </div>
    </Loader>
  );
}
