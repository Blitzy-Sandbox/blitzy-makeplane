/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Maximize-icon trigger that opens the full-screen image viewer modal.
 *
 * The `ImageFullScreenModal` is ALWAYS mounted in the JSX tree below; only its
 * `isFullScreenEnabled` prop is toggled. This avoids a portal mount/unmount on
 * every open and keeps the modal's window/document event listeners attached
 * only while open (gated inside the modal's own effect).
 *
 * The trigger calls `e.preventDefault()` + `e.stopPropagation()` to prevent the
 * click from bubbling up to the parent image block's ProseMirror NodeSelection
 * handler. Modal open/close state is mirrored up to the parent toolbar via
 * `toggleToolbarViewStatus` so the toolbar stays visible while the modal is open.
 *
 * Consumed by: `../root.tsx` (`ImageToolbarRoot`) at line 55, which passes its
 * full `props` object as `image` (containing `aspectRatio`, `downloadSrc`,
 * `height`, `src`, `width`).
 */

import { Maximize } from "lucide-react";
import { useEffect, useState } from "react";
// plane imports
import { Tooltip } from "@plane/propel/tooltip";
// local imports
import { ImageFullScreenModal } from "./modal";

/**
 * Props for `ImageFullScreenActionRoot`.
 *
 * - `image`: Object containing `aspectRatio`, `downloadSrc`, `height`, `src`,
 *   `width` — forwarded wholesale to `ImageFullScreenModal` for sizing/display.
 * - `isTouchDevice`: Disables the trigger button's tooltip on touch devices
 *   (avoids double-tap conflicts on mobile).
 * - `toggleToolbarViewStatus`: Callback used to mirror the modal's open/close
 *   state up to the parent toolbar (keeps the toolbar visible while open).
 */
type Props = {
  image: {
    aspectRatio: number;
    downloadSrc: string;
    height: string;
    src: string;
    width: string;
  };
  isTouchDevice: boolean;
  toggleToolbarViewStatus: (val: boolean) => void;
};

/**
 * Icon (maximize) button with tooltip "View in full screen"; opens the
 * always-mounted `ImageFullScreenModal` viewer when clicked.
 *
 * Internal state: `isFullScreenEnabled` (boolean) — true while the modal is
 * visible. Side effect: mirrored up to the parent toolbar via
 * `toggleToolbarViewStatus` inside a `useEffect`.
 *
 * Accessibility: `aria-label="View image in full screen"` on the trigger
 * button; tooltip is disabled on touch devices.
 */
export function ImageFullScreenActionRoot(props: Props) {
  const { image, isTouchDevice, toggleToolbarViewStatus } = props;
  // states
  const [isFullScreenEnabled, setIsFullScreenEnabled] = useState(false);
  // derived values
  const { downloadSrc, src, width, aspectRatio } = image;

  useEffect(() => {
    toggleToolbarViewStatus(isFullScreenEnabled);
  }, [isFullScreenEnabled, toggleToolbarViewStatus]);

  return (
    <>
      <ImageFullScreenModal
        aspectRatio={aspectRatio}
        downloadSrc={downloadSrc}
        isFullScreenEnabled={isFullScreenEnabled}
        isTouchDevice={isTouchDevice}
        src={src}
        width={width}
        toggleFullScreenMode={setIsFullScreenEnabled}
      />
      <Tooltip tooltipContent="View in full screen" disabled={isTouchDevice}>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsFullScreenEnabled(true);
          }}
          className="grid h-full flex-shrink-0 place-items-center text-on-color/60 transition-colors hover:text-on-color"
          aria-label="View image in full screen"
        >
          <Maximize className="size-3" />
        </button>
      </Tooltip>
    </>
  );
}
