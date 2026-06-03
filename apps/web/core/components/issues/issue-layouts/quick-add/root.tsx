/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Quick-add issue / epic creation root component for issue layouts.
 *
 * Rendered purpose: the route-aware controller that toggles between a trigger button and an inline
 * quick-add form, captures a single `name` field via react-hook-form, merges it with any caller-supplied
 * `prePopulatedData`, and dispatches creation via the caller-supplied `quickAddCallback` with promise
 * toast feedback.
 *
 * Required props (TQuickAddIssueRoot):
 *   - layout (EIssueLayoutTypes, required): which layout-specific form/button pair the
 *     `QuickAddIssueFormRoot` should render (LIST, KANBAN, GANTT, CALENDAR, SPREADSHEET)
 *
 * Optional props:
 *   - isQuickAddOpen (boolean): if defined, treats open state as controlled by the caller and mirrors it
 *     through `setIsQuickAddOpen`; if undefined, falls back to internal `useState`
 *   - setIsQuickAddOpen ((isOpen: boolean) => void): controlled-mode setter
 *   - prePopulatedData (Partial<TIssue>): caller-supplied issue field defaults merged into the submission
 *     payload (used by grouped layouts to inject state_id, cycle_id, module_id, label_ids, etc., from the
 *     parent group context)
 *   - QuickAddButton (FC<TQuickAddIssueButton>): layout-specific trigger button variant
 *   - customQuickAddButton (React.ReactNode): caller-supplied trigger node, used when neither the built-in
 *     button nor a layout-variant button is appropriate
 *   - containerClassName (string, default=""): outer wrapper class names
 *   - quickAddCallback ((projectId, data) => Promise<TIssue | undefined>): the create-issue action,
 *     typically wired to a store action that calls `IssueService.create`
 *   - isEpic (boolean, default=false): swaps i18n strings and toast copy between work-item and epic flows
 *
 * MobX stores read: none directly in this component — by design.
 *   - Reactivity is provided by the `observer` HOC for any observable accessed within the render tree by
 *     the child `QuickAddIssueFormRoot` (e.g., project identifier resolution).
 *   - The actual store mutation is performed by the parent-supplied `quickAddCallback`, which closes over
 *     the appropriate issues store (`projectIssues`, `cycleIssues`, `moduleIssues`, etc.).
 *
 * Side effects:
 *   - Reads route params via `useParams()` from `next/navigation` to resolve `workspaceSlug` and `projectId`
 *   - Initializes local `react-hook-form` state with `{ name: "" }` defaults
 *   - On submit: builds a payload via `createIssuePayload(projectId, { ...prePopulatedData, ...formData })`,
 *     invokes `quickAddCallback(projectId, payload)`, and wires the resulting promise into
 *     `setPromiseToast` with loading / success / error captions translated via `@plane/i18n`
 *   - Success toast includes a `CreateIssueToastActionItems` action items renderer that exposes a deep link
 *     to the newly-created issue (issue id resolved from the promise resolution value)
 *   - Resets the form to `defaultValues` whenever `isOpen` flips to false (effect on line 88-90)
 *
 * Imperative / non-obvious behavior to note:
 *   - The `isQuickAddOpen` prop is OPTIONAL but BIDIRECTIONALLY-controlled when present — the effect on
 *     line 82-86 mirrors the controlled prop into the internal `isOpen` state on every change, and the
 *     `handleIsOpen` callback prefers `setIsQuickAddOpen` over the internal setter when controlled mode
 *     is detected (this is WHY the conditional setter exists).
 *   - The component renders `null` when `projectId` is missing (line 137) — guards against route param
 *     race conditions during client-side navigation.
 *   - The submit handler short-circuits if `isSubmitting`, missing workspaceSlug, or missing projectId —
 *     prevents double-submission and stale-route submissions.
 *   - `reset({ ...defaultValues })` runs BEFORE the async submission (line 103) so the input clears
 *     immediately on Enter, giving the user a responsive feel while the network call is in flight.
 *
 * Consumers: every issue-layout grouped column (list, kanban, gantt, calendar, spreadsheet) that needs an
 * inline create-issue affordance. Typically wired up through the layout's root container in
 * `apps/web/core/components/issues/issue-layouts/{list,kanban,gantt,calendar,spreadsheet}/`.
 *
 * Architectural note (per AAP §0.2.2): the frontend uses React Router v7 + Vite in the workspace overlay,
 * but this file imports `useParams` from `next/navigation` per the existing codebase convention — the
 * import is preserved verbatim and not modified.
 */

import type { FC } from "react";
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import type { UseFormRegister } from "react-hook-form";
import { useForm } from "react-hook-form";
// plane imports
import { useTranslation } from "@plane/i18n";
import { PlusIcon } from "@plane/propel/icons";
import { setPromiseToast } from "@plane/propel/toast";
import type { IProject, TIssue, EIssueLayoutTypes } from "@plane/types";
import { cn, createIssuePayload } from "@plane/utils";
// plane web imports
import { QuickAddIssueFormRoot } from "@/plane-web/components/issues/quick-add";
// local imports
import { CreateIssueToastActionItems } from "../../create-issue-toast-action-items";

/**
 * Prop contract for layout-specific quick-add form variants (see `./form/{list,kanban,gantt,calendar,spreadsheet}.tsx`).
 *
 * Fields:
 *   - ref: forwarded to the form element so the parent can blur / clear focus on outside-click
 *   - isOpen: drives transition/visibility classes in animated variants (notably calendar)
 *   - projectDetail: resolved `IProject` used to display the project identifier prefix
 *   - hasError: derived from `react-hook-form` `errors.name.message` presence by the parent; variants
 *     surface this as red-tinted borders / helper text
 *   - register: the `react-hook-form` registrar for the `name` input field
 *   - onSubmit: the parent-bound submit handler (`handleSubmit(onSubmitHandler)`)
 *   - isEpic: switches all i18n keys and validation messages between issue and epic flows
 */
export type TQuickAddIssueForm = {
  ref: React.RefObject<HTMLFormElement>;
  isOpen: boolean;
  projectDetail: IProject;
  hasError: boolean;
  register: UseFormRegister<TIssue>;
  onSubmit: () => void;
  isEpic: boolean;
};

/**
 * Prop contract for layout-specific quick-add trigger button variants (see `./button/{list,kanban,gantt,spreadsheet}.tsx`).
 *
 * Fields:
 *   - isEpic: optional; when true the button copy switches to epic-creation labels
 *   - onClick: required; bound by the parent root to open the inline form
 */
export type TQuickAddIssueButton = {
  isEpic?: boolean;
  onClick: () => void;
};

type TQuickAddIssueRoot = {
  isQuickAddOpen?: boolean;
  layout: EIssueLayoutTypes;
  prePopulatedData?: Partial<TIssue>;
  QuickAddButton?: FC<TQuickAddIssueButton>;
  customQuickAddButton?: React.ReactNode;
  containerClassName?: string;
  setIsQuickAddOpen?: (isOpen: boolean) => void;
  quickAddCallback?: (projectId: string | null | undefined, data: TIssue) => Promise<TIssue | undefined>;
  isEpic?: boolean;
};

const defaultValues: Partial<TIssue> = {
  name: "",
};

/**
 * Quick-add issue / epic creation root component; see the module-level JSDoc for full semantics.
 *
 * The component is wrapped in `observer` so that any MobX-observable accessed by the rendered child tree
 * (e.g., the project identifier resolved inside `QuickAddIssueFormRoot`) triggers a re-render on change.
 */
export const QuickAddIssueRoot = observer(function QuickAddIssueRoot(props: TQuickAddIssueRoot) {
  const {
    isQuickAddOpen,
    layout,
    prePopulatedData,
    QuickAddButton,
    customQuickAddButton,
    containerClassName = "",
    setIsQuickAddOpen,
    quickAddCallback,
    isEpic = false,
  } = props;
  // i18n
  const { t } = useTranslation();
  // router
  const { workspaceSlug, projectId } = useParams();
  // states
  const [isOpen, setIsOpen] = useState(isQuickAddOpen ?? false);
  // form info
  const {
    reset,
    handleSubmit,
    setFocus,
    register,
    formState: { errors, isSubmitting },
  } = useForm<TIssue>({ defaultValues });

  useEffect(() => {
    if (isQuickAddOpen !== undefined) {
      setIsOpen(isQuickAddOpen);
    }
  }, [isQuickAddOpen]);

  useEffect(() => {
    if (!isOpen) reset({ ...defaultValues });
  }, [isOpen, reset]);

  const handleIsOpen = (isOpen: boolean) => {
    if (isQuickAddOpen !== undefined && setIsQuickAddOpen) {
      setIsQuickAddOpen(isOpen);
    } else {
      setIsOpen(isOpen);
    }
  };

  /**
   * Submission orchestrator: merges pre-populated context with the user-entered name, dispatches the
   * caller-supplied create action, and wires the resulting promise into toast feedback.
   *
   * Short-circuits on double-submit (`isSubmitting`) or missing route params to avoid stale-route writes.
   */
  const onSubmitHandler = async (formData: TIssue) => {
    if (isSubmitting || !workspaceSlug || !projectId) return;

    reset({ ...defaultValues });

    const payload = createIssuePayload(projectId.toString(), {
      ...(prePopulatedData ?? {}),
      ...formData,
    });

    if (quickAddCallback) {
      const quickAddPromise = quickAddCallback(projectId.toString(), { ...payload });
      setPromiseToast<any>(quickAddPromise, {
        loading: isEpic ? t("epic.adding") : t("issue.adding"),
        success: {
          title: t("common.success"),
          message: () => `${isEpic ? t("epic.create.success") : t("issue.create.success")}`,
          actionItems: (data) => (
            // TODO: Translate here
            <CreateIssueToastActionItems
              workspaceSlug={workspaceSlug.toString()}
              projectId={projectId.toString()}
              issueId={data.id}
              isEpic={isEpic}
            />
          ),
        },
        error: {
          title: t("common.error.label"),
          message: (err) => err?.message || t("common.error.message"),
        },
      });

      await quickAddPromise;
    }
  };

  if (!projectId) return null;

  return (
    <div
      className={cn(
        containerClassName,
        errors && errors?.name && errors?.name?.message ? `border-danger-strong bg-danger-subtle` : ``
      )}
    >
      {isOpen ? (
        <QuickAddIssueFormRoot
          isOpen={isOpen}
          layout={layout}
          prePopulatedData={prePopulatedData}
          projectId={projectId?.toString()}
          hasError={errors && errors?.name && errors?.name?.message ? true : false}
          setFocus={setFocus}
          register={register}
          onSubmit={handleSubmit(onSubmitHandler)}
          onClose={() => handleIsOpen(false)}
          isEpic={isEpic}
        />
      ) : (
        <>
          {QuickAddButton && <QuickAddButton isEpic={isEpic} onClick={() => handleIsOpen(true)} />}
          {customQuickAddButton && <>{customQuickAddButton}</>}
          {!QuickAddButton && !customQuickAddButton && (
            <button
              className="flex w-full cursor-pointer items-center gap-2 bg-layer-transparent px-2 py-3 hover:bg-layer-transparent-hover"
              onClick={() => handleIsOpen(true)}
            >
              <PlusIcon className="h-3.5 w-3.5 stroke-2" />
              <span className="text-13 font-medium">{t(`${isEpic ? "epic.new" : "issue.new"}`)}</span>
            </button>
          )}
        </>
      )}
    </div>
  );
});
