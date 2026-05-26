/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Floating image-action toolbar overlay for the custom-image node.
 *
 * Rendered as an absolutely positioned `<div>` pinned to the top-right of the
 * surrounding image container. Composes three child actions:
 *   - `ImageDownloadAction`     — skipped when `isTouchDevice` is true
 *   - `ImageAlignmentAction`    — skipped when `editor.isEditable` is false
 *   - `ImageFullScreenActionRoot` — always rendered
 *
 * Visibility is driven entirely by Tailwind utility classes: the toolbar
 * defaults to `opacity-0` and is revealed when the wrapping image container
 * (annotated with `group/image-component` in `../block.tsx`) is hovered, via
 * the `group-hover/image-component:opacity-100` selector. It can additionally
 * be force-shown by the local `shouldShowToolbar` state, which child dropdowns
 * and modals flip while they are open so the toolbar does not vanish when the
 * pointer leaves the hover area.
 *
 * The toolbar is rendered inline (not through a React portal) so that it
 * remains outside the contenteditable region and ProseMirror never tries to
 * manage cursor placement inside its interactives. The full-screen modal
 * spawned by `ImageFullScreenActionRoot` is itself a portal, but the toolbar
 * root is not.
 *
 * Consumer: `../block.tsx` mounts `<ImageToolbarRoot>` conditional on its
 * local `showImageToolbar` flag (resolved display + download srcs present,
 * initial resize complete, and not in the duplicating state).
 */

import type { Editor } from "@tiptap/core";
import { useState } from "react";
// plane imports
import { cn } from "@plane/utils";
// local imports
import type { TCustomImageAlignment } from "../../types";
import { ImageAlignmentAction } from "./alignment";
import { ImageDownloadAction } from "./download";
import { ImageFullScreenActionRoot } from "./full-screen";

/**
 * Props consumed by {@link ImageToolbarRoot}. The toolbar is purely
 * presentational — it never reads or mutates the editor's document directly;
 * actions either call back into the parent via `handleAlignmentChange` or are
 * delegated to the composed child action components.
 *
 * - `alignment`: Current alignment, sourced from the image node's
 *   `attrs.alignment` (`TCustomImageAlignment`).
 * - `editor`: The Tiptap `@tiptap/core` editor instance; only `editor.isEditable`
 *   is read here, gating the alignment dropdown.
 * - `aspectRatio`: Image aspect ratio, forwarded to the full-screen modal for
 *   its initial fit-to-viewport calculation.
 * - `downloadSrc`: Resolved download URL (typically signed with a
 *   `Content-Disposition: attachment` header), passed to `ImageDownloadAction`.
 * - `handleAlignmentChange`: Callback fired by the alignment dropdown on
 *   selection; the parent block persists the new value to the node's attrs.
 * - `height`: CSS-pixel string (e.g., `"320px"`), forwarded to the full-screen
 *   modal.
 * - `isTouchDevice`: Sourced upstream from `editor.storage.utility.isTouchDevice`;
 *   used to hide the download button and disable tooltips on touch hardware.
 * - `src`: Resolved display URL, forwarded to the full-screen modal.
 * - `width`: CSS-pixel string, forwarded to the full-screen modal.
 */
type Props = {
  alignment: TCustomImageAlignment;
  editor: Editor;
  aspectRatio: number;
  downloadSrc: string;
  handleAlignmentChange: (alignment: TCustomImageAlignment) => void;
  height: string;
  isTouchDevice: boolean;
  src: string;
  width: string;
};

/**
 * Renders the floating image-action toolbar (download, alignment, full-screen)
 * overlaid at the top-right of the surrounding image container.
 *
 * Owns one piece of local state — `shouldShowToolbar` — which child dropdowns
 * and modals flip via the `toggleToolbarViewStatus` prop they receive (wired
 * to `setShouldShowToolbar` here). This keeps the toolbar visible while a
 * child dropdown or modal is open even if the user's pointer leaves the
 * group-hover area on the parent image container.
 *
 * No editor-state side effects: alignment selections are bubbled up via
 * `handleAlignmentChange`, and image-related data (`src`, `downloadSrc`,
 * `aspectRatio`, `width`, `height`) is forwarded unchanged to the child
 * action components. Returned tree is a fragment containing a single
 * absolutely-positioned `<div>` that hosts the three composed actions.
 */
export function ImageToolbarRoot(props: Props) {
  const { alignment, editor, downloadSrc, handleAlignmentChange, isTouchDevice } = props;
  // states
  const [shouldShowToolbar, setShouldShowToolbar] = useState(false);
  // derived values
  const isEditable = editor.isEditable;

  return (
    <>
      <div
        className={cn(
          "pointer-events-none absolute top-1 right-1 z-20 flex h-7 items-center gap-2 rounded-sm bg-black/80 px-2 opacity-0 transition-opacity group-hover/image-component:pointer-events-auto group-hover/image-component:opacity-100",
          {
            "pointer-events-auto opacity-100": shouldShowToolbar,
          }
        )}
      >
        {!isTouchDevice && <ImageDownloadAction src={downloadSrc} />}
        {isEditable && (
          <ImageAlignmentAction
            activeAlignment={alignment}
            handleChange={handleAlignmentChange}
            isTouchDevice={isTouchDevice}
            toggleToolbarViewStatus={setShouldShowToolbar}
          />
        )}
        <ImageFullScreenActionRoot
          image={props}
          isTouchDevice={isTouchDevice}
          toggleToolbarViewStatus={setShouldShowToolbar}
        />
      </div>
    </>
  );
}
