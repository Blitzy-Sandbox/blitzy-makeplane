/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Full-screen image viewer overlay with zoom, pan, and quick-action support.
 *
 * Mounted via React portal so it escapes local stacking contexts (e.g.,
 * the toolbar's `z-20` or the image block's `relative` positioning) and
 * renders at the document top layer. Prefers `#editor-portal` and falls
 * back to `document.body` with a `console.warn` if the preferred target
 * is missing (defensive — supports test/non-editor mount contexts).
 *
 * Zoom model is two-tier:
 *   - `initialMagnification`: base CSS render size, fit-to-viewport rather
 *     than the image's full intrinsic resolution. Computed once per open.
 *   - `magnification`: user-controlled zoom layered on top via
 *     `transform: scale()`. Clamped to [MIN_ZOOM, MAX_ZOOM].
 *
 * Pan offsets (`left`/`top` inline styles on the `<img>`) are divided by
 * `magnification` so drag-tracking feels consistent at different zoom
 * levels — without this, dragging at 2x would feel twice as fast as 1x.
 */

import { Download, Minus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { NewTabIcon, PlusIcon, CloseIcon } from "@plane/propel/icons";
// plane imports
import { cn } from "@plane/utils";

/**
 * Zoom level constants for the full-screen viewer.
 *
 * - `MIN_ZOOM = 0.5`: minimum zoom (50% of fit-to-viewport size).
 * - `MAX_ZOOM = 2`: maximum zoom (200% of fit-to-viewport size).
 * - `ZOOM_SPEED = 0.05`: continuous zoom delta per Ctrl/Cmd + wheel step.
 * - `ZOOM_STEPS = [0.5, 1, 1.5, 2]`: discrete snap-points used by the
 *   `+`/`-` keyboard shortcuts and the bottom-bar zoom in/out buttons.
 */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_SPEED = 0.05;
const ZOOM_STEPS = [0.5, 1, 1.5, 2];

type Props = {
  aspectRatio: number;
  downloadSrc: string;
  isFullScreenEnabled: boolean;
  isTouchDevice: boolean;
  src: string;
  toggleFullScreenMode: (val: boolean) => void;
  width: string;
};

/**
 * Full-screen overlay showing an image at fit-to-viewport magnification with
 * zoom controls (in/out, snap zoom levels), drag-to-pan (when the scaled image
 * exceeds the viewport), and (on non-touch) download + open-in-new-tab actions.
 *
 * Keyboard shortcuts (active only while `isFullScreenEnabled`):
 *   - Escape: closes the modal.
 *   - `+` or `=`: zoom in to the next `ZOOM_STEPS` value.
 *   - `-`: zoom out to the previous `ZOOM_STEPS` value.
 *
 * Mouse/pointer behavior:
 *   - Backdrop click closes the modal ONLY when `e.target === modalRef.current`
 *     (click target IS the backdrop itself, not children).
 *   - Drag-to-pan: activated in `handleMouseDown` only when the scaled image
 *     exceeds the viewport in either axis.
 *   - Ctrl/Cmd + wheel: continuous zoom (`ZOOM_SPEED` per `deltaY` step),
 *     clamped to `[MIN_ZOOM, MAX_ZOOM]`.
 *
 * Initial scale is computed in `setImageRef` (the ref callback) so the image
 * fits within `window.innerWidth * 0.9` x `window.innerHeight * 0.75`. The
 * image's CSS width is multiplied by `initialMagnification`; subsequent user
 * zoom is layered as `transform: scale(${magnification})`.
 *
 * Accessibility: `role="dialog"`, `aria-modal="true"`, and an `aria-label` on
 * the modal root; per-button `aria-label`s on close, zoom in/out, download,
 * and open-in-new-tab. Escape closes the modal. Focus management gap: focus
 * is NOT explicitly trapped — see the `// INTENT UNCLEAR` flag near the
 * effect that wires up the listeners.
 *
 * Event listeners (keydown, mousemove, mouseup, wheel) are attached only while
 * `isFullScreenEnabled` and removed in the effect's cleanup function on close.
 */
function ImageFullScreenModalWithoutPortal(props: Props) {
  const { aspectRatio, isFullScreenEnabled, isTouchDevice, downloadSrc, src, toggleFullScreenMode, width } = props;
  // refs
  const dragStart = useRef({ x: 0, y: 0 });
  const dragOffset = useRef({ x: 0, y: 0 });

  const [magnification, setMagnification] = useState<number>(1);
  const [initialMagnification, setInitialMagnification] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const widthInNumber = useMemo(() => {
    if (!width) return 0;
    return Number(width.replace("px", ""));
  }, [width]);

  const setImageRef = useCallback(
    (node: HTMLImageElement | null) => {
      if (!node || !isFullScreenEnabled) return;

      imgRef.current = node;

      const viewportWidth = window.innerWidth * 0.9;
      const viewportHeight = window.innerHeight * 0.75;
      const imageWidth = widthInNumber;
      const imageHeight = imageWidth / aspectRatio;

      const widthRatio = viewportWidth / imageWidth;
      const heightRatio = viewportHeight / imageHeight;

      setInitialMagnification(Math.min(widthRatio, heightRatio));
      setMagnification(1);

      // Reset image position
      node.style.left = "0px";
      node.style.top = "0px";
    },
    [isFullScreenEnabled, widthInNumber, aspectRatio]
  );

  const handleClose = useCallback(() => {
    if (isDragging) return;
    toggleFullScreenMode(false);
    setMagnification(1);
    setInitialMagnification(1);
  }, [isDragging, toggleFullScreenMode]);

  const handleMagnification = useCallback((direction: "increase" | "decrease") => {
    setMagnification((prev) => {
      // Find the appropriate target zoom level based on current magnification
      let targetZoom: number;
      if (direction === "increase") {
        targetZoom = ZOOM_STEPS.find((step) => step > prev) ?? MAX_ZOOM;
      } else {
        // Reverse the array to find the next lower step
        targetZoom = [...ZOOM_STEPS].reverse().find((step) => step < prev) ?? MIN_ZOOM;
      }

      // Reset position when zoom matches initial magnification
      if (targetZoom === 1 && imgRef.current) {
        imgRef.current.style.left = "0px";
        imgRef.current.style.top = "0px";
      }

      return targetZoom;
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "+" || e.key === "=" || e.key === "-") {
        e.preventDefault();
        e.stopPropagation();

        if (e.key === "Escape") handleClose();
        if (e.key === "+" || e.key === "=") handleMagnification("increase");
        if (e.key === "-") handleMagnification("decrease");
      }
    },
    [handleClose, handleMagnification]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!imgRef.current) return;

    const imgWidth = imgRef.current.offsetWidth * magnification;
    const imgHeight = imgRef.current.offsetHeight * magnification;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (imgWidth > viewportWidth || imgHeight > viewportHeight) {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY };
      dragOffset.current = {
        x: parseInt(imgRef.current.style.left || "0"),
        y: parseInt(imgRef.current.style.top || "0"),
      };
    }
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !imgRef.current) return;

      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;

      // Divide the pointer delta by `magnification` so drag-tracking feels consistent at any zoom level (without this, 2x zoom would track 2x faster).
      // Apply the scale factor to the drag movement
      const scaledDx = dx / magnification;
      const scaledDy = dy / magnification;

      imgRef.current.style.left = `${dragOffset.current.x + scaledDx}px`;
      imgRef.current.style.top = `${dragOffset.current.y + scaledDy}px`;
    },
    [isDragging, magnification]
  );

  const handleMouseUp = useCallback(() => {
    if (!isDragging || !imgRef.current) return;
    setIsDragging(false);
  }, [isDragging]);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (!imgRef.current || !isFullScreenEnabled) return;

      e.preventDefault();

      // Handle pinch-to-zoom
      if (e.ctrlKey || e.metaKey) {
        const delta = e.deltaY;
        setMagnification((prev) => {
          const newZoom = prev * (1 - delta * ZOOM_SPEED);
          const clampedZoom = Math.min(Math.max(newZoom, MIN_ZOOM), MAX_ZOOM);

          // Reset position when zoom matches initial magnification
          if (clampedZoom === 1 && imgRef.current) {
            imgRef.current.style.left = "0px";
            imgRef.current.style.top = "0px";
          }

          return clampedZoom;
        });
        return;
      }
    },
    [isFullScreenEnabled]
  );

  // INTENT UNCLEAR: focus trap is not explicitly implemented — relies on absence of focusable elements outside the portal subtree.
  // Event listeners
  useEffect(() => {
    if (!isFullScreenEnabled) return;

    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("wheel", handleWheel);
    };
  }, [isFullScreenEnabled, handleKeyDown, handleMouseMove, handleMouseUp, handleWheel]);

  if (!isFullScreenEnabled) return null;

  return (
    <div
      className={cn("pointer-events-none fixed inset-0 z-50 size-full bg-black/90 opacity-0 transition-opacity", {
        "editor-image-full-screen-modal pointer-events-auto opacity-100": isFullScreenEnabled,
        "cursor-default": !isDragging,
        "cursor-grabbing": isDragging,
      })}
      role="dialog"
      aria-modal="true"
      aria-label="Fullscreen image viewer"
    >
      {/* Strict-equality check on `e.target` ensures only clicks on the backdrop itself (not bubbled from the image or controls) close the modal. */}
      <div
        ref={modalRef}
        onMouseDown={(e) => e.target === modalRef.current && handleClose()}
        className="relative grid size-full place-items-center overflow-hidden"
      >
        <button
          type="button"
          onClick={handleClose}
          className="absolute top-10 right-10 grid size-8 place-items-center"
          aria-label="Close image viewer"
        >
          <CloseIcon className="size-8 text-white/60 transition-colors hover:text-white" />
        </button>
        <img
          ref={setImageRef}
          src={src}
          className="read-only-image rounded-lg"
          style={{
            width: `${widthInNumber * initialMagnification}px`,
            maxWidth: "none",
            maxHeight: "none",
            aspectRatio,
            position: "relative",
            transform: `scale(${magnification})`,
            transformOrigin: "center",
            transition: "width 0.2s ease, transform 0.2s ease",
          }}
          onMouseDown={handleMouseDown}
        />
        <div className="fixed bottom-10 left-1/2 flex -translate-x-1/2 items-center justify-center gap-1 divide-x divide-subtle-1 rounded-md border border-subtle-1 bg-black py-2">
          <div className="flex items-center">
            <button
              type="button"
              onClick={(e) => {
                if (isTouchDevice) {
                  e.preventDefault();
                  e.stopPropagation();
                }
                handleMagnification("decrease");
              }}
              className="grid size-6 place-items-center text-white/60 transition-colors duration-200 hover:text-white disabled:text-white/30"
              disabled={magnification <= MIN_ZOOM}
              aria-label="Zoom out"
            >
              <Minus className="size-4" />
            </button>
            <span className="w-12 text-center text-13 text-white">{Math.round(100 * magnification)}%</span>
            <button
              type="button"
              onClick={(e) => {
                if (isTouchDevice) {
                  e.preventDefault();
                  e.stopPropagation();
                }
                handleMagnification("increase");
              }}
              className="grid size-6 place-items-center text-white/60 transition-colors duration-200 hover:text-white disabled:text-white/30"
              disabled={magnification >= MAX_ZOOM}
              aria-label="Zoom in"
            >
              <PlusIcon className="size-4" />
            </button>
          </div>
          {!isTouchDevice && (
            <button
              type="button"
              onClick={() => window.open(downloadSrc, "_blank")}
              className="grid size-8 flex-shrink-0 place-items-center text-white/60 transition-colors duration-200 hover:text-white"
              aria-label="Download image"
            >
              <Download className="size-4" />
            </button>
          )}
          {!isTouchDevice && (
            <button
              type="button"
              onClick={() => window.open(src, "_blank")}
              className="grid size-8 flex-shrink-0 place-items-center text-white/60 transition-colors duration-200 hover:text-white"
              aria-label="Open image in new tab"
            >
              <NewTabIcon className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Portal-mounting wrapper around `ImageFullScreenModalWithoutPortal`.
 *
 * Prefers `#editor-portal` as the portal target and falls back to
 * `document.body` (with a `console.warn`) if `#editor-portal` is not in
 * the DOM. Mounting via portal lets the overlay escape local stacking
 * contexts (e.g., the toolbar's `z-20` or the image block's `relative`
 * positioning) and render at the document top layer.
 *
 * Returns `ReactDOM.createPortal(<ImageFullScreenModalWithoutPortal …/>, target)`.
 */
export function ImageFullScreenModal(props: Props) {
  let modal = <ImageFullScreenModalWithoutPortal {...props} />;
  const portal = document.querySelector("#editor-portal");
  if (portal) {
    modal = ReactDOM.createPortal(modal, portal);
  } else {
    // Warn (don't throw) so tests and non-editor mount contexts still render the modal; the warn signals a likely mis-configured editor host.
    console.warn("Portal element #editor-portal not found. Rendering in document.body");
    if (typeof document !== "undefined" && document.body) {
      modal = ReactDOM.createPortal(modal, document.body);
    }
  }
  return modal;
}
