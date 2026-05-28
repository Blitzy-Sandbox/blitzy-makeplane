/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Spreadsheet-layout quick-add issue trigger button.
 *
 * Rendered purpose:
 *   Lightweight full-width native `<button>` embedded in a dense grid-like
 *   spreadsheet layout that, when clicked, opens the inline quick-add form
 *   in the parent quick-add orchestrator.
 *
 * Props (from `TQuickAddIssueButton` in `../root`):
 *   - `onClick` (`() => void`, required): click handler bound by the parent
 *     root to open the inline quick-add form.
 *   - `isEpic` (`boolean`, optional, default = `false`): when `true`, swaps
 *     the label from issue-creation copy (`t("issue.add.label")`) to
 *     epic-creation copy (`t("epic.add.label")`).
 *
 * MobX stores read: none directly. Wrapped in `observer` from `mobx-react`
 * to future-proof for any reactive values consumed during render.
 *
 * Side effects:
 *   - Invokes the supplied `onClick` callback exactly once per click.
 *   - No service calls, navigations, toasts, or imperative DOM operations
 *     occur here — submission and state management live entirely in the
 *     parent `../root` orchestrator.
 *
 * i18n keys consumed: `t("epic.add.label")` and `t("issue.add.label")` —
 * this is a deliberately DIFFERENT key set from the list / kanban / gantt
 * variants (which use `epic.new` / `issue.new`). Document as observed; the
 * spreadsheet surface uses a distinct copy set to match its dense
 * grid-style interaction idiom.
 *
 * Visual / accessibility:
 *   - Renders a native `<button type="button">` so keyboard activation
 *     (Enter / Space) and focus semantics are handled by the browser.
 *   - `PlusIcon` from `@plane/propel/icons` provides the visual add cue.
 *   - The outer `<div className="flex items-center">` aligns the button
 *     with the spreadsheet's row baseline.
 */

import { observer } from "mobx-react";

import { useTranslation } from "@plane/i18n";
import { PlusIcon } from "@plane/propel/icons";
import type { TQuickAddIssueButton } from "../root";

/** Spreadsheet-layout quick-add trigger button; see the module-level JSDoc for full semantics. */
export const SpreadsheetAddIssueButton = observer(function SpreadsheetAddIssueButton(props: TQuickAddIssueButton) {
  const { onClick, isEpic = false } = props;
  const { t } = useTranslation();
  return (
    <div className="flex items-center">
      <button
        type="button"
        className="flex w-full items-center gap-x-[6px] bg-layer-transparent px-2 py-2 transition-colors hover:bg-layer-transparent-hover"
        onClick={onClick}
      >
        <PlusIcon className="h-3.5 w-3.5 stroke-2" />
        <span className="text-13 font-medium">{isEpic ? t("epic.add.label") : t("issue.add.label")}</span>
      </button>
    </div>
  );
});
