/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Quick-add issue form for the GANTT layout — compact inline form with explicit error-state styling.
 *
 * Rendered purpose: presents a name-only `<form>` row inside a Gantt-chart group, visually signaling
 * validation/submission failures via `hasError`-driven red border + subtle danger background; the only
 * variant in this folder that surfaces `hasError` to the user.
 *
 * Props (from `TQuickAddIssueForm` imported from `../root`):
 *   - ref (React.RefObject<HTMLFormElement>, required): forwarded to the `<form>` element for the parent
 *     root's outside-click blur logic
 *   - isOpen (boolean, required): part of the shared contract; accepted but NOT visually surfaced in
 *     this variant (the parent root controls mount/unmount via `QuickAddIssueFormRoot`)
 *   - projectDetail (IProject, required): the resolved project; its `identifier` is rendered as a
 *     left-aligned prefix label, falling back to `"..."` placeholder while the parent store resolves it
 *   - hasError (boolean, required): drives the outer wrapper's `cn(...)` composition — when true, applies
 *     `border border-danger-strong/20 bg-danger-subtle` to signal validation/submission errors
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
 * Non-obvious derived-state behavior:
 *   - The outer wrapper's class composition uses `@plane/utils` `cn(...)` to conditionally apply
 *     error-state styling ONLY when `hasError` is truthy — this is WHY `hasError` is part of the shared
 *     prop contract even though most variants ignore it (Gantt rows benefit from extra visual emphasis
 *     because they are narrow horizontal bands inside dense timeline grids).
 *
 * i18n keys consumed (via `useTranslation()` from `@plane/i18n`):
 *   - `epic.title.label` / `issue.title.label` — placeholder text
 *   - `epic.title.required` / `issue.title.required` — validation message
 *   - `epic.add.press_enter` / `issue.add.press_enter` — helper text below the form
 *
 * Consumers: imported via the `./form/index.ts` barrel by the Gantt layout container in
 * `apps/web/core/components/issues/issue-layouts/gantt/` through the parent `QuickAddIssueRoot`.
 */

import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
import type { TQuickAddIssueForm } from "../root";

/** Gantt-layout quick-add issue form with `hasError`-driven error styling; see the module-level JSDoc for full semantics. */
export const GanttQuickAddIssueForm = observer(function GanttQuickAddIssueForm(props: TQuickAddIssueForm) {
  const { ref, projectDetail, hasError, register, onSubmit, isEpic } = props;
  const { t } = useTranslation();
  return (
    <div className={cn("shadow-raised-200", hasError && "border border-danger-strong/20 bg-danger-subtle")}>
      <form
        ref={ref}
        onSubmit={onSubmit}
        className="flex w-full items-center gap-x-3 border-[0.5px] border-subtle bg-surface-1 px-3"
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
      <div className="bg-surface-1 px-3 py-2 text-11 text-secondary italic">
        {isEpic ? t("epic.add.press_enter") : t("issue.add.press_enter")}
      </div>
    </div>
  );
});
