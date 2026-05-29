/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Quick-add issue form for the KANBAN layout — card-shaped inline form rendered at the bottom of a column.
 *
 * Rendered purpose: presents a name-only `<form>` styled as a Kanban-card so users can append a new
 * work item (or epic) to the active column; the visual treatment mimics a real card so the input feels
 * like a placeholder for the about-to-be-created card.
 *
 * Props (from `TQuickAddIssueForm` imported from `../root`):
 *   - ref (React.RefObject<HTMLFormElement>, required): forwarded to the `<form>` element so the parent
 *     root's outside-click handler can blur and close the quick-add panel
 *   - isOpen (boolean, required): part of the shared contract; accepted but NOT visually surfaced in
 *     this variant (the parent root controls mount/unmount via `QuickAddIssueFormRoot`)
 *   - projectDetail (IProject, required): the resolved project; its `identifier` is rendered as a small
 *     header text inside the card-like wrapper, falling back to `"..."` while the parent store resolves it
 *   - hasError (boolean, required): part of the shared contract; accepted but NOT visually surfaced
 *     (other variants such as `gantt.tsx` surface it as red-tinted borders)
 *   - register (UseFormRegister<TIssue>, required): the parent's `react-hook-form` registrar; bound to
 *     the `name` input with `required` validation (message switches on `isEpic`)
 *   - onSubmit (() => void, required): the parent-bound submit handler (`handleSubmit(onSubmitHandler)`)
 *   - isEpic (boolean, required): toggles all i18n keys between issue and epic flows
 *
 * MobX stores read: none directly. Wrapped in `mobx-react`'s `observer` for reactivity to MobX
 * observables resolved upstream (e.g., `projectDetail.identifier`).
 *
 * Side effects:
 *   - Field registration via `register("name", { required: ... })`; required-validation message is
 *     i18n-driven via `@plane/i18n`'s `useTranslation()` and switches on `isEpic`
 *   - No direct service calls, navigations, or imperative DOM operations beyond the form ref
 *
 * i18n keys consumed (via `useTranslation()` from `@plane/i18n`):
 *   - `epic.title.label` / `issue.title.label` — placeholder text
 *   - `epic.title.required` / `issue.title.required` — validation message
 *   - `epic.add.press_enter` / `issue.add.press_enter` — helper text in the card footer
 *
 * Consumers: imported via the `./form/index.ts` barrel by the kanban layout container in
 * `apps/web/core/components/issues/issue-layouts/kanban/` through the parent `QuickAddIssueRoot`.
 */

import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import type { TQuickAddIssueForm } from "../root";

/** Kanban-layout quick-add issue form rendered as a card placeholder at the bottom of a column; see the module-level JSDoc for full semantics. */
export const KanbanQuickAddIssueForm = observer(function KanbanQuickAddIssueForm(props: TQuickAddIssueForm) {
  const { ref, projectDetail, register, onSubmit, isEpic } = props;
  const { t } = useTranslation();
  return (
    <div className="m-1 overflow-hidden rounded-sm bg-layer-2 shadow-raised-200">
      <form ref={ref} onSubmit={onSubmit} className="flex w-full items-center gap-x-3 p-3">
        <div className="w-full">
          <h4 className="text-11 leading-5 font-medium text-tertiary">{projectDetail?.identifier ?? "..."}</h4>
          <input
            autoComplete="off"
            placeholder={isEpic ? t("epic.title.label") : t("issue.title.label")}
            {...register("name", {
              required: isEpic ? t("epic.title.required") : t("issue.title.required"),
            })}
            className="w-full rounded-md bg-transparent px-2 py-1.5 pl-0 text-13 leading-5 font-medium text-secondary outline-none"
          />
        </div>
      </form>
      <div className="bg-layer-3 px-3 py-2 text-11 text-tertiary italic">
        {isEpic ? t("epic.add.press_enter") : t("issue.add.press_enter")}
      </div>
    </div>
  );
});
