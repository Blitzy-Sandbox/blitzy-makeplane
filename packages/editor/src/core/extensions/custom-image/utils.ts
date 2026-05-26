/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared utility module for the custom-image extension.
 *
 * Centralizes:
 *   - The canonical default attribute values for newly-inserted image nodes
 *     (`DEFAULT_CUSTOM_IMAGE_ATTRIBUTES`).
 *   - The editor-storage accessor for the per-image upload metadata map
 *     (`getImageComponentImageFileMap`).
 *   - Dimension normalization to the canonical `Pixel` string form
 *     (`ensurePixelString`).
 *   - Alignment option metadata for the toolbar UI (`IMAGE_ALIGNMENT_OPTIONS`).
 *   - Stable DOM block id generation for external anchoring (`getImageBlockId`).
 *   - Predicates over the image lifecycle status enum `ECustomImageStatus`
 *     (`isImageDuplicating`, `isImageDuplicationComplete`,
 *     `hasImageDuplicationFailed`).
 *
 * Consumers:
 *   - `./extension-config.ts` — reads defaults for `addAttributes()`.
 *   - `./extension.tsx` — accesses the file map for upload bookkeeping.
 *   - `./components/block.tsx` — uses dimension normalization, block id,
 *     and duplication-status predicates.
 *   - `./components/uploader.tsx` — accesses the file map and reads the
 *     duplication-failed predicate to drive the retry UX.
 *   - `./components/toolbar/alignment.tsx` — renders the alignment dropdown
 *     from the option metadata.
 *   - `./components/node-view.tsx` — reads the duplication-failed predicate
 *     for auto-retry-on-mount behavior.
 *
 * Why centralized: the schema (defaults), the runtime extension (file map,
 * block id), and the UI (alignment options, status predicates) all need to
 * agree on these values; collocating them here prevents drift if the
 * `ECustomImageAttributeNames` or `ECustomImageStatus` enums are extended.
 */

import type { Editor } from "@tiptap/core";
import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
// local imports
import { ECustomImageAttributeNames, ECustomImageStatus } from "./types";
import type { TCustomImageAlignment, Pixel, TCustomImageAttributes } from "./types";

/**
 * Canonical default attribute object for a newly-inserted custom-image node.
 *
 * Every key in {@link ECustomImageAttributeNames} is initialized with a value
 * chosen to keep the node well-formed before any upload completes. Consumed by
 * `./extension-config.ts`'s `addAttributes()` as the per-attribute default.
 *
 * Default rationale (the "why" for each sentinel):
 *   - `SOURCE: null` — there is no URL until the upload completes; the block
 *     renders the uploader UI while this is null.
 *   - `ID: null` — assigned by `insertImageComponent` via `uuidv4()` at the
 *     point of insertion, not at attribute-declaration time, so each node
 *     gets a unique id.
 *   - `WIDTH: "35%"` — sentinel that triggers the one-time "compute pixel
 *     width from editor container width" branch in
 *     `CustomImageBlock.handleImageLoad` (see `./components/block.tsx`); once
 *     initial layout runs, this is replaced with a concrete pixel value.
 *   - `HEIGHT: "auto"` — sentinel paired with the `"35%"` width sentinel; the
 *     concrete height is resolved alongside width on first image load.
 *   - `ASPECT_RATIO: null` — populated from `img.naturalWidth /
 *     img.naturalHeight` on first load and then used to preserve ratio on
 *     subsequent resizes.
 *   - `ALIGNMENT: "left"` — default block alignment for new images.
 *   - `STATUS: PENDING` — initial lifecycle state; advances `PENDING →
 *     UPLOADING → UPLOADED` on the normal upload path, or `UPLOADED →
 *     DUPLICATING → UPLOADED | DUPLICATION_FAILED` on the copy-paste
 *     duplication path.
 */
export const DEFAULT_CUSTOM_IMAGE_ATTRIBUTES: TCustomImageAttributes = {
  [ECustomImageAttributeNames.SOURCE]: null,
  [ECustomImageAttributeNames.ID]: null,
  [ECustomImageAttributeNames.WIDTH]: "35%",
  [ECustomImageAttributeNames.HEIGHT]: "auto",
  [ECustomImageAttributeNames.ASPECT_RATIO]: null,
  [ECustomImageAttributeNames.ALIGNMENT]: "left",
  [ECustomImageAttributeNames.STATUS]: ECustomImageStatus.PENDING,
};

/**
 * Optional-chained accessor for the per-image upload metadata map (`fileMap`)
 * stored under `editor.storage.imageComponent`.
 *
 * Why a helper: the storage path `editor.storage.imageComponent?.fileMap` is
 * deeply nested and used in several call sites; centralizing the access keeps
 * the storage key name (`imageComponent`, derived from
 * `CORE_EXTENSIONS.CUSTOM_IMAGE`) in a single location so renaming the
 * extension key only requires editing one file.
 *
 * @param editor - The Tiptap editor instance whose storage to read.
 * @returns The `Map<string, UploadEntity>` keyed by image UUID, or `undefined`
 *   when the custom-image extension is not registered on this editor.
 */
export const getImageComponentImageFileMap = (editor: Editor) => editor.storage.imageComponent?.fileMap;

/**
 * Normalizes a width/height value into the canonical `Pixel` string form
 * (`"123px"`) so downstream CSS and resize logic can treat dimensions
 * uniformly.
 *
 * Behavior:
 *   - When `value` is nullish or equals `defaultValue`: returns `defaultValue`
 *     (preserves sentinel defaults like `"35%"` / `"auto"` so the
 *     first-image-load branch in `./components/block.tsx` still fires).
 *   - When `value` is a `number`: returns `` `${value}px` `` typed as `Pixel`.
 *   - Otherwise: returns the value unchanged (e.g., it is already a `"123px"`
 *     `Pixel` string from a prior normalization).
 *
 * Why: stored attributes may arrive as numbers (from resize handlers that
 * write `node.naturalWidth` directly) or as strings (from HTML parse on
 * editor hydration). This helper coerces both into the canonical `Pixel`
 * string before they are assigned to `<img style>` or written back into
 * `node.attrs`, eliminating per-call-site type guards.
 *
 * @typeParam TDefault - The type of the optional fallback value, typically
 *   the sentinel literal `"35%"` for width or `"auto"` for height.
 * @param value - The raw dimension value to normalize.
 * @param defaultValue - The fallback used when `value` is nullish or already
 *   equals the sentinel.
 * @returns A `Pixel` string, the unchanged `Pixel` input, or the
 *   `defaultValue` sentinel.
 */
export const ensurePixelString = <TDefault>(
  value: Pixel | TDefault | number | undefined | null,
  defaultValue?: TDefault
) => {
  if (!value || value === defaultValue) {
    return defaultValue;
  }

  if (typeof value === "number") {
    return `${value}px` satisfies Pixel;
  }

  return value;
};

/**
 * Static option metadata for the image-alignment toolbar dropdown.
 *
 * Each entry pairs a {@link TCustomImageAlignment} value with a user-visible
 * `label` and a Lucide `icon` so the toolbar can both render the dropdown
 * options and resolve the icon for the currently active alignment.
 *
 * Schema per entry: `{ label: string, value: TCustomImageAlignment, icon: LucideIcon }`.
 *
 * Ordering: `Left → Center → Right`, chosen to match Western reading order
 * and the standard alignment-toolbar UX in office and editor applications.
 *
 * Consumed by `./components/toolbar/alignment.tsx`.
 */
export const IMAGE_ALIGNMENT_OPTIONS: {
  label: string;
  value: TCustomImageAlignment;
  icon: LucideIcon;
}[] = [
  {
    label: "Left",
    value: "left",
    icon: AlignLeft,
  },
  {
    label: "Center",
    value: "center",
    icon: AlignCenter,
  },
  {
    label: "Right",
    value: "right",
    icon: AlignRight,
  },
];
/**
 * Returns a stable, prefixed DOM id of the form `editor-image-block-${id}`
 * for the outer wrapper of a rendered custom-image block.
 *
 * Why a stable prefix: this lets external code (scroll-to-image,
 * hash-based deep links, anchor extensions) target a specific image block
 * by its node attribute id without traversing the editor's internal DOM
 * or knowing the wrapper's tag structure.
 *
 * @param id - The node's UUID (the `ECustomImageAttributeNames.ID`
 *   attribute), set by `insertImageComponent` at insertion time.
 * @returns The prefixed DOM id string applied to the outermost block
 *   wrapper `<div>` in `./components/block.tsx`.
 */
export const getImageBlockId = (id: string) => `editor-image-block-${id}`;

/**
 * Predicate: is the image currently in the `DUPLICATING` lifecycle state?
 *
 * Used by `./components/block.tsx` to render the loading skeleton during
 * the copy-paste duplication round-trip — i.e. while the application is
 * creating a new server-side asset for a pasted/cloned image and the new
 * `src` is not yet known.
 *
 * @param status - The current `ECustomImageStatus` of the image node.
 * @returns `true` if `status === ECustomImageStatus.DUPLICATING`.
 */
export const isImageDuplicating = (status: ECustomImageStatus) => status === ECustomImageStatus.DUPLICATING;

/**
 * Predicate: has duplication reached a terminal state?
 *
 * Returns `true` for both terminal outcomes — `UPLOADED` (duplication
 * succeeded and the node now points at a real asset) and
 * `DUPLICATION_FAILED` (terminal failure). Used to gate the "show
 * duplication retry" UX so it appears only after the duplication attempt
 * has resolved one way or the other.
 *
 * @param status - The current `ECustomImageStatus` of the image node.
 * @returns `true` if `status` is `UPLOADED` or `DUPLICATION_FAILED`.
 */
export const isImageDuplicationComplete = (status: ECustomImageStatus) =>
  status === ECustomImageStatus.UPLOADED || status === ECustomImageStatus.DUPLICATION_FAILED;

/**
 * Predicate: did the duplication round-trip fail terminally?
 *
 * Drives the retry button rendered by `./components/uploader.tsx` and the
 * auto-retry-on-mount logic in `./components/node-view.tsx`.
 *
 * Why these three predicates are centralized: the duplication state machine
 * (`PENDING → UPLOADING → UPLOADED`, or `UPLOADED → DUPLICATING → UPLOADED |
 * DUPLICATION_FAILED` on copy-paste) is checked in three different UI files;
 * collocating the branch conditions ensures they stay consistent if
 * `ECustomImageStatus` is ever extended with new lifecycle states.
 *
 * @param status - The current `ECustomImageStatus` of the image node.
 * @returns `true` if `status === ECustomImageStatus.DUPLICATION_FAILED`.
 */
export const hasImageDuplicationFailed = (status: ECustomImageStatus) =>
  status === ECustomImageStatus.DUPLICATION_FAILED;
