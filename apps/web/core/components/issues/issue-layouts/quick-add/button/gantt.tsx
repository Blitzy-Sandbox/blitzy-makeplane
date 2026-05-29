/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Gantt-layout quick-add issue trigger button.
 *
 * Rendered purpose:
 *   Sticky full-width footer button anchored to the bottom of the gantt
 *   issue-layout viewport that, when clicked, opens the inline quick-add
 *   form in the parent quick-add orchestrator.
 *
 * Props (from `TQuickAddIssueButton` in `../root`):
 *   - `onClick` (`() => void`, required): click handler bound by the parent
 *     root to open the inline quick-add form.
 *   - `isEpic` (`boolean`, optional, default = `false`): when `true`, swaps
 *     the label from issue-creation copy (`t("issue.new")`) to epic-creation
 *     copy (`t("epic.new")`).
 *
 * MobX stores read: none directly. The component is wrapped in `observer`
 * from `mobx-react` in the existing implementation; the observer-wrapper
 * rationale is not inferable from this file.
 * // INTENT UNCLEAR: observer wrapper is present despite no direct
 * // observable reads in this component.
 *
 * Side effects:
 *   - Invokes the supplied `onClick` callback exactly once per click.
 *   - No service calls, navigations, toasts, or imperative DOM operations
 *     occur here — submission and state management live entirely in the
 *     parent `../root` orchestrator.
 *
 * i18n keys consumed: `t("epic.new")` and `t("issue.new")` (same key set as
 * the list variant — distinct from the spreadsheet variant which uses
 * `epic.add.label` / `issue.add.label`).
 *
 * Visual / accessibility:
 *   - Renders a native `<button type="button">` so keyboard activation
 *     (Enter / Space) and focus semantics are handled by the browser.
 *   - `PlusIcon` from `@plane/propel/icons` provides the visual add cue.
 *   - Uses the `Row` primitive from `@plane/ui` for horizontal layout
 *     consistency with the rest of the quick-add surface.
 *   - Sticky positioning (`sticky bottom-0 z-[1]`) keeps the button
 *     visible while the gantt timeline scrolls.
 */

import { observer } from "mobx-react";

import { useTranslation } from "@plane/i18n";
import { PlusIcon } from "@plane/propel/icons";
import { Row } from "@plane/ui";
import type { TQuickAddIssueButton } from "../root";

/** Gantt-layout quick-add trigger button; see the module-level JSDoc for full semantics. */
export const GanttQuickAddIssueButton = observer(function GanttQuickAddIssueButton(props: TQuickAddIssueButton) {
  const { onClick, isEpic = false } = props;
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="sticky bottom-0 z-[1] flex w-full cursor-pointer items-center border-t-[1px] border-subtle bg-layer-transparent hover:bg-layer-transparent-hover"
      onClick={onClick}
    >
      <Row className="flex gap-2 py-2">
        <PlusIcon className="my-auto h-3.5 w-3.5 stroke-2" />
        <span className="text-13 font-medium">{t(`${isEpic ? "epic.new" : "issue.new"}`)}</span>
      </Row>
    </button>
  );
});
