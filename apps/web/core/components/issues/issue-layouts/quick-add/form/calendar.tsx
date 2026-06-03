/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Quick-add issue form for the CALENDAR layout — animated inline form that toggles open/closed in place.
 *
 * Rendered purpose: presents a compact name-only `<form>` inside a calendar day cell so users can add a
 * work item (or epic) without leaving the calendar grid; visibility is animated via opacity + scale
 * transitions driven by the `isOpen` prop.
 *
 * Props (from `TQuickAddIssueForm` imported from `../root`):
 *   - ref (React.RefObject<HTMLFormElement>, required): forwarded to the `<form>` so the parent root can
 *     blur on outside-click (and react-hook-form `handleSubmit` can fire on Enter)
 *   - isOpen (boolean, required): drives the visibility transition — `scale-100 opacity-100` when open,
 *     `pointer-events-none scale-95 opacity-0` when closed; element stays mounted to preserve calendar
 *     cell layout and animate smoothly
 *   - projectDetail (IProject, required): the resolved project; its `identifier` is rendered as a small
 *     prefix label, falling back to `"..."` while the parent store resolves the project
 *   - hasError (boolean, required): part of the shared prop contract; accepted but NOT visually surfaced
 *     in this variant (other variants such as `gantt.tsx` do surface it)
 *   - register (UseFormRegister<TIssue>, required): the parent's `react-hook-form` registrar — bound to
 *     the `name` input with `required` validation
 *   - onSubmit (() => void, required): the parent-bound submit handler (`handleSubmit(onSubmitHandler)`)
 *   - isEpic (boolean, required): switches placeholder and validation copy between work-item and epic
 *
 * MobX stores read: none directly. Wrapped in `mobx-react`'s `observer` so the surrounding render tree
 * stays reactive to MobX observables resolved by the parent (e.g., `projectDetail.identifier`).
 *
 * Side effects:
 *   - Registers the `name` input via `register("name", { required: ... })`; required-validation message
 *     is hard-coded English (see note below)
 *   - No direct service calls, navigations, or imperative DOM operations beyond the form ref
 *
 * Non-obvious behavior to call out:
 *   - The wrapper `<div>` uses `opacity-0 + scale-95 + pointer-events-none` instead of conditional
 *     unmounting because animating opacity/scale on a persistent node is smoother and prevents calendar
 *     cell layout from collapsing/expanding when the form toggles.
 *   - // INTENT UNCLEAR: this calendar variant uses hard-coded English strings ("Epic Title" /
 *     "Work item Title" / "${...} title is required.") while sibling quick-add variants
 *     (`list.tsx`, `kanban.tsx`, `gantt.tsx`, `spreadsheet.tsx`) call `useTranslation()` from
 *     `@plane/i18n`.
 *
 * Consumers: imported via the `./form/index.ts` barrel by the calendar layout container in
 * `apps/web/core/components/issues/issue-layouts/calendar/` through the parent `QuickAddIssueRoot`.
 */

import { observer } from "mobx-react";
import type { TQuickAddIssueForm } from "../root";

/** Calendar-layout quick-add issue form with animated visibility; see the module-level JSDoc for full semantics. */
export const CalendarQuickAddIssueForm = observer(function CalendarQuickAddIssueForm(props: TQuickAddIssueForm) {
  const { ref, isOpen, projectDetail, register, onSubmit, isEpic } = props;

  return (
    <div
      className={`z-20 w-full transition-all ${
        isOpen ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
      }`}
    >
      <form
        ref={ref}
        onSubmit={onSubmit}
        className="z-50 flex w-full items-center gap-x-2 rounded-sm border-subtle bg-surface-1 px-2 transition-opacity md:border-[0.5px] md:shadow-raised-100"
      >
        <h4 className="text-13 leading-5 text-placeholder md:text-11">{projectDetail?.identifier ?? "..."}</h4>
        <input
          type="text"
          autoComplete="off"
          placeholder={isEpic ? "Epic Title" : "Work item Title"}
          {...register("name", {
            required: `${isEpic ? "Epic" : "Work item"} title is required.`,
          })}
          className="w-full rounded-md bg-transparent py-1.5 pr-2 text-13 leading-5 font-medium text-secondary outline-none md:text-11"
        />
      </form>
    </div>
  );
});
