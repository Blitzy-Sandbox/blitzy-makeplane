/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * List-layout quick-add issue trigger button.
 *
 * Rendered purpose:
 *   Horizontally-flowing `Row` with a `+` icon and i18n-driven label that,
 *   when clicked, opens the inline quick-add form for the LIST issue
 *   layout in the parent quick-add orchestrator.
 *
 * Props (from `TQuickAddIssueButton` in `../root`):
 *   - `onClick` (`() => void`, required): click handler bound by the parent
 *     root to open the inline quick-add form.
 *   - `isEpic` (`boolean`, optional, default = `false`): when `true`, swaps
 *     the label from issue-creation copy (`t("issue.new")`) to epic-creation
 *     copy (`t("epic.new")`).
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
 * i18n keys consumed: `t("epic.new")` and `t("issue.new")` (same key set as
 * the gantt variant — distinct from the spreadsheet variant which uses
 * `epic.add.label` / `issue.add.label`).
 *
 * Visual / accessibility:
 *   - `PlusIcon` from `@plane/propel/icons` provides the visual add cue.
 *   - Uses the `Row` primitive from `@plane/ui` for horizontal layout
 *     consistency with the rest of the list-layout surface; click is bound
 *     to `Row`, so any keyboard activation depends on the `Row`
 *     implementation surface.
 */

import { observer } from "mobx-react";

import { useTranslation } from "@plane/i18n";
import { PlusIcon } from "@plane/propel/icons";
import { Row } from "@plane/ui";
import type { TQuickAddIssueButton } from "../root";

/** List-layout quick-add trigger button; see the module-level JSDoc for full semantics. */
export const ListQuickAddIssueButton = observer(function ListQuickAddIssueButton(props: TQuickAddIssueButton) {
  const { onClick, isEpic = false } = props;
  const { t } = useTranslation();
  return (
    <Row
      className="flex w-full cursor-pointer items-center gap-2 bg-layer-transparent py-3 hover:bg-layer-transparent-hover"
      onClick={onClick}
    >
      <PlusIcon className="h-3.5 w-3.5 stroke-2" />
      <span className="text-13 font-medium">{isEpic ? t("epic.new") : t("issue.new")}</span>
    </Row>
  );
});
