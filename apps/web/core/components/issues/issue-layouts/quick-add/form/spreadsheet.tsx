/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Quick-add issue form for the SPREADSHEET layout — inline form row paired with an italic instructional
 * helper paragraph.
 *
 * Rendered purpose: presents a name-only `<form>` row that visually extends the spreadsheet's table
 * structure (fixed-width identifier column + flexible name column) and pairs it with a `<p>` helper
 * paragraph hinting that pressing Enter submits.
 *
 * Props (from `TQuickAddIssueForm` imported from `../root`):
 *   - ref (React.RefObject<HTMLFormElement>, required): forwarded to the `<form>` element so the parent
 *     root's outside-click handler can blur and close the quick-add panel
 *   - isOpen (boolean, required): part of the shared contract; accepted but NOT visually surfaced in
 *     this variant (the parent root controls mount/unmount via `QuickAddIssueFormRoot`)
 *   - projectDetail (IProject, required): the resolved project; its `identifier` is rendered in a
 *     fixed-width (`w-20`) header cell so the form aligns with the spreadsheet's column grid, falling
 *     back to `"..."` placeholder while the parent store resolves it
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
 * Non-obvious layout behavior to call out:
 *   - The instructional helper `<p>` is rendered OUTSIDE the `<form>` element so its presence does not
 *     intercept the Enter-key submit; the offset margin (`mt-3 ml-3`) places it as a follow-up note
 *     beneath the spreadsheet row rather than as an inline form caption.
 *   - The identifier `<h4>` is `w-20` (fixed width) — this is intentional alignment with the
 *     spreadsheet's column grid so the quick-add row visually slots into the table.
 *
 * i18n keys consumed (via `useTranslation()` from `@plane/i18n`):
 *   - `epic.title.label` / `issue.title.label` — placeholder text
 *   - `epic.title.required` / `issue.title.required` — validation message
 *   - `epic.add.press_enter` / `issue.add.press_enter` — instructional helper paragraph below the form
 *
 * Consumers: imported via the `./form/index.ts` barrel by the spreadsheet layout container in
 * `apps/web/core/components/issues/issue-layouts/spreadsheet/` through the parent `QuickAddIssueRoot`.
 */

import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import type { TQuickAddIssueForm } from "../root";

/** Spreadsheet-layout quick-add issue form paired with an instructional helper paragraph; see the module-level JSDoc for full semantics. */
export const SpreadsheetQuickAddIssueForm = observer(function SpreadsheetQuickAddIssueForm(props: TQuickAddIssueForm) {
  const { ref, projectDetail, register, onSubmit, isEpic } = props;
  const { t } = useTranslation();
  return (
    <div className="pb-2">
      <form
        ref={ref}
        onSubmit={onSubmit}
        className="z-10 flex items-center gap-x-5 border-[0.5px] border-t-0 border-subtle bg-surface-1 px-4 shadow-raised-200"
      >
        <h4 className="w-20 text-11 leading-5 text-placeholder">{projectDetail?.identifier ?? "..."}</h4>
        <input
          type="text"
          autoComplete="off"
          placeholder={isEpic ? t("epic.title.label") : t("issue.title.label")}
          {...register("name", {
            required: isEpic ? t("epic.title.required") : t("issue.title.required"),
          })}
          className="w-full rounded-md bg-transparent py-3 text-13 leading-5 text-secondary outline-none"
        />
      </form>
      <p className="mt-3 ml-3 text-11 text-secondary italic">
        {isEpic ? t("epic.add.press_enter") : t("issue.add.press_enter")}
      </p>
    </div>
  );
});
