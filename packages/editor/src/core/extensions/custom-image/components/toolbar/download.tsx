/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Compact icon button rendered inside `ImageToolbarRoot` that lets the viewer
 * download the underlying image asset attached to a `CustomImage` node.
 *
 * Click behavior: `window.open(src, "_blank")` opens the resolved download URL
 * in a new browser tab; the browser then handles the file save based on the
 * `Content-Disposition` header returned by storage (typically `attachment` for
 * signed download URLs minted by the API).
 *
 * Why `window.open(..., "_blank")` and not a programmatic `<a download>` or
 * `fetch` + Blob URL: signed download URLs often carry a short expiry, and
 * opening in a new tab surfaces any auth, expiry, or CORS errors directly to
 * the user instead of failing silently. The same approach has inconsistent
 * support inside mobile WebView contexts, which is why the parent
 * `ImageToolbarRoot` gates this action on `!isTouchDevice` (see
 * `./root.tsx` for the rendering gate) rather than gating here.
 *
 * Accessibility: the `<button>` carries `aria-label="Download image"` for
 * screen readers, while the wrapping `Tooltip` supplies the visible
 * "Download" label for sighted users.
 */

import { Download } from "lucide-react";
// plane imports
import { Tooltip } from "@plane/propel/tooltip";

/**
 * Props accepted by `ImageDownloadAction`.
 *
 * - `src` (`string`): The resolved download URL for the image — typically a
 *   signed S3/storage URL whose `Content-Disposition: attachment` header
 *   instructs the browser to save rather than render. The parent
 *   `ImageToolbarRoot` passes its `downloadSrc` prop into this slot, which is
 *   intentionally distinct from the display `src` consumed by the on-page
 *   `<img>` element.
 */
type Props = {
  src: string;
};

/**
 * Renders a compact icon button with the tooltip label "Download" that opens
 * the image's resolved download URL in a new browser tab.
 *
 * Internal state: none — the component is purely a controlled action button.
 *
 * Side effects: calls `window.open(src, "_blank")` on click. This is the only
 * external effect; no MobX store mutation, no navigation, no API call is
 * triggered from here.
 *
 * Accessibility: `aria-label="Download image"` provides a screen-reader label;
 * the wrapping `Tooltip` exposes the visible "Download" label for sighted
 * users.
 *
 * Touch-device behavior: this component does NOT inspect device capabilities
 * itself. The parent `ImageToolbarRoot` decides whether to render it via the
 * `!isTouchDevice` gate at `./root.tsx:46`, because `window.open(..., "_blank")`
 * behaves inconsistently inside mobile WebView contexts.
 */
export function ImageDownloadAction(props: Props) {
  const { src } = props;

  return (
    <Tooltip tooltipContent="Download">
      <button
        type="button"
        onClick={() => window.open(src, "_blank")}
        className="grid h-full flex-shrink-0 place-items-center text-white/60 transition-colors hover:text-white"
        aria-label="Download image"
      >
        <Download className="size-3" />
      </button>
    </Tooltip>
  );
}
