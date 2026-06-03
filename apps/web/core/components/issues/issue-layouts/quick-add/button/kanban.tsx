/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Kanban-layout quick-add issue trigger button.
 *
 * Rendered purpose:
 *   Compact horizontally-flowing trigger rendered inside a kanban column's
 *   add-area that, when clicked, opens the inline quick-add form in the
 *   parent quick-add orchestrator.
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
 * the list and gantt variants — distinct from the spreadsheet variant which
 * uses `epic.add.label` / `issue.add.label`).
 *
 * Visual / accessibility:
 *   - Renders a clickable `<div>` with `cursor-pointer` and an `onClick`
 *     handler; the element has no `role`, `tabIndex`, or `onKeyDown`
 *     declaration. Keyboard activation is NOT natively supported on a
 *     `<div>`.
 *     // INTENT UNCLEAR: kanban variant uses a clickable `<div>` with no
 *     // keyboard handler in this component (list and gantt variants use
 *     // a native `<button>` paired with `Row`).
 *   - `PlusIcon` from `@plane/propel/icons` provides the visual add cue.
 *   - Compact rounded pill styling (`rounded-lg`) matches the kanban
 *     column's add-card visual idiom.
 */

import { observer } from "mobx-react";

import { useTranslation } from "@plane/i18n";
import { PlusIcon } from "@plane/propel/icons";
import type { TQuickAddIssueButton } from "../root";

/** Kanban-layout quick-add trigger button; see the module-level JSDoc for full semantics. */
export const KanbanQuickAddIssueButton = observer(function KanbanQuickAddIssueButton(props: TQuickAddIssueButton) {
  const { onClick, isEpic = false } = props;
  const { t } = useTranslation();
  return (
    <div
      className="flex w-full cursor-pointer items-center gap-2 rounded-lg bg-layer-transparent px-2 py-1 py-1.5 hover:bg-layer-transparent-hover"
      onClick={onClick}
    >
      <PlusIcon className="h-3.5 w-3.5 stroke-2" />
      <span className="text-13 font-medium">{isEpic ? t("epic.new") : t("issue.new")}</span>
    </div>
  );
});
