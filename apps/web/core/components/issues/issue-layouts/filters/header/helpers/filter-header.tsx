/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * `FilterHeader` — collapsible section header used inside every filter / display-filter panel.
 *
 * Rendered purpose: renders the section title and a chevron toggle that expands / collapses the
 * section body. Used as the per-filter accordion header so users can hide sections they aren't
 * currently editing.
 *
 * Props (`Props`):
 *   - `title` (`string`, required): the section label (e.g. `"Priority"`, `"State"`,
 *     `"Display Properties"`).
 *   - `isPreviewEnabled` (`boolean`, required): collapse state; `true` = body shown, `false` = body
 *     hidden.
 *   - `handleIsPreviewEnabled` (`() => void`, required): toggle callback fired on header click.
 *
 * MobX stores read: none.
 *
 * Side effects: none — invokes `handleIsPreviewEnabled` on click.
 *
 * Accessibility considerations: the clickable toggle is a native `<button>` (focusable + keyboard
 * activatable by default) but does NOT declare `aria-expanded`. See the inline `INTENT UNCLEAR`
 * flag above the button for the observed a11y gap; do not change the runtime behavior to fix it
 * (system boundary forbids logic changes).
 */

// plane imports
import { ChevronDownIcon, ChevronUpIcon } from "@plane/propel/icons";

type Props = {
  title: string;
  isPreviewEnabled: boolean;
  handleIsPreviewEnabled: () => void;
};

export function FilterHeader({ title, isPreviewEnabled, handleIsPreviewEnabled }: Props) {
  return (
    <div className="sticky top-0 flex items-center justify-between gap-2 bg-surface-1">
      <div className="flex-grow truncate text-caption-sm-medium text-placeholder">{title}</div>
      {/* INTENT UNCLEAR: clickable header element does not declare aria-expanded; screen readers */}
      {/* cannot announce collapsed/expanded state. */}
      <button
        type="button"
        className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-sm hover:bg-layer-transparent-hover"
        onClick={handleIsPreviewEnabled}
      >
        {isPreviewEnabled ? <ChevronUpIcon height={14} width={14} /> : <ChevronDownIcon height={14} width={14} />}
      </button>
    </div>
  );
}
