/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Quick-add issue form for the LIST layout — compact inline form rendered below a list group header.
 *
 * Rendered purpose: presents a name-only `<form>` row that continues the visual baseline of the list
 * group it belongs to (shared `border-subtle` + `bg-surface-1` styling) so the input feels like the
 * next list row about to be created.
 *
 * Props (from `TQuickAddIssueForm` imported from `../root`):
 *   - ref (React.RefObject<HTMLFormElement>, required): forwarded to the `<form>` element so the parent
 *     root's outside-click handler can blur and close the quick-add panel
 *   - isOpen (boolean, required): part of the shared contract; accepted but NOT visually surfaced in
 *     this variant (the parent root controls mount/unmount via `QuickAddIssueFormRoot`)
 *   - projectDetail (IProject, required): the resolved project; its `identifier` is rendered as a
 *     left-aligned prefix label, falling back to `"..."` placeholder while the parent store resolves it
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
 *   - `epic.add.press_enter` / `issue.add.press_enter` — helper text below the form
 *
 * Consumers: imported via the `./form/index.ts` barrel by the list layout container in
 * `apps/web/core/components/issues/issue-layouts/list/` through the parent `QuickAddIssueRoot`.
 */

import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import type { TQuickAddIssueForm } from "../root";

/** List-layout quick-add issue form; see the module-level JSDoc for full semantics. */
export const ListQuickAddIssueForm = observer(function ListQuickAddIssueForm(props: TQuickAddIssueForm) {
  const { ref, projectDetail, register, onSubmit, isEpic } = props;
  const { t } = useTranslation();
  return (
    <div className="shadow-raised-200">
      <form
        ref={ref}
        onSubmit={onSubmit}
        className="flex w-full items-center gap-x-3 border-[0.5px] border-t-0 border-subtle bg-surface-1 px-3"
      >
        <div className="flex w-full items-center gap-3">
          <div className="text-11 font-medium text-placeholder">{projectDetail?.identifier ?? "..."}</div>
          <input
            type="text"
            autoComplete="off"
            placeholder={isEpic ? t("epic.title.label") : t("issue.title.label")}
            {...register("name", {
              required: isEpic ? t("epic.title.required") : t("issue.title.required"),
            })}
            className="w-full rounded-md bg-transparent px-2 py-3 text-13 leading-5 font-medium text-secondary outline-none"
          />
        </div>
      </form>
      <div className="px-3 py-2 text-11 text-secondary italic">
        {isEpic ? t("epic.add.press_enter") : t("issue.add.press_enter")}
      </div>
    </div>
  );
});
