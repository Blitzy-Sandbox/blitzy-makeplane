/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Inline label-creation editor embedded inside the issue-detail label workflow.
 *
 * Rendered purpose: a compact toggle that, when expanded, opens an inline form with a `TwitterPicker`
 * color swatch (inside a `Popover`) and a name `Input` so the user can create a new label and
 * immediately attach it to the current work item without leaving the issue detail panel. Submission
 * creates the label, appends its id to the issue's `label_ids`, persists the issue update, and
 * collapses the editor.
 *
 * Props (ILabelCreate, file-local type):
 *   - workspaceSlug (string, required): scopes the create-label and update-issue mutations
 *   - projectId (string, required): scopes the create-label mutation and the issue update
 *   - issueId (string, required): the work item the new label is attached to
 *   - values (string[], required): the current `label_ids` array — the newly created label's id is
 *     appended to this on success
 *   - labelOperations (TLabelOperations from `./root`, required): provides `createLabel(...)` and
 *     `updateIssue(...)`; both are routed through the issue-detail / label stores
 *   - disabled (boolean, optional, default=false): currently only disables the inline cancel button
 *     once the editor is expanded (the toggle row itself does not consult `disabled`)
 *
 * MobX stores read: none directly. State persistence is delegated to the `labelOperations`
 * contract (which in turn reaches `useLabel().createLabel` and `useIssueDetail().updateIssue` in
 * `./root`). The component is intentionally NOT wrapped in `observer` because it owns its own
 * `react-hook-form` state and does not subscribe to any observable.
 *
 * Side effects:
 *   - `labelOperations.createLabel(workspaceSlug, projectId, formData)` — routes to the label store
 *     and ultimately `LabelService.createLabel` against `apps/api`'s `LabelViewSet`.
 *   - `labelOperations.updateIssue(workspaceSlug, projectId, issueId, { label_ids: [...] })` —
 *     routes to the issue-detail store and `IssueService.patchIssue` against `apps/api`'s
 *     `IssueViewSet`.
 *   - Toast emissions are handled INSIDE the `labelOperations` contract in `./root.tsx`; this file
 *     does not call `setToast` directly.
 *   - Popover anchored DOM: opens a floating panel positioned by `react-popper` (`bottom-start`
 *     placement, 12px overflow padding).
 *
 * Imperative DOM / derived state notes:
 *   - `referenceElement` and `popperElement` are imperative DOM refs used by `react-popper` to
 *     position the color-picker popover relative to the color swatch button. They are state, not
 *     `useRef`, because `react-popper` re-runs its position calculation on each ref update.
 *   - The `useEffect` on `[isCreateToggle, reset, setFocus]` focuses the name input and resets the
 *     form to `defaultValues` every time the editor is opened. This is non-obvious: it prevents
 *     stale form values from a prior open from being shown, and matches the "open = fresh form"
 *     UX expected here.
 *   - `defaultValues.color = "#ff0000"` is the initial color swatch (red) — preserve this exact
 *     hex code so the inline preview swatch always renders a non-empty color on first open.
 *   - The submit handler `handleLabel` is a no-op when `workspaceSlug || projectId` is falsy OR
 *     when a prior submission is already in flight (`isSubmitting` from react-hook-form). This is
 *     the double-submit guard.
 *
 * Accessibility notes:
 *   - Color picker is wrapped in Headless UI `Popover` for focus management and outside-click
 *     dismissal.
 *   - The Cancel button is `<button type="button">` so it does NOT trigger form submission; the
 *     submit button is `<button type="submit">` and is disabled during `isSubmitting`.
 *   - The name input is marked required via `react-hook-form`'s `rules: { required: "This is required" }`;
 *     when validation fails, `hasError` on the `Input` is set so the field renders with an error
 *     style.
 */

import { useState, Fragment, useEffect } from "react";
import { TwitterPicker } from "react-color";
import { Controller, useForm } from "react-hook-form";
import { usePopper } from "react-popper";
import { Loader } from "lucide-react";
import { Popover } from "@headlessui/react";
import { PlusIcon, CloseIcon } from "@plane/propel/icons";
import type { IIssueLabel } from "@plane/types";
// hooks
import { Input } from "@plane/ui";
// ui
// types
import type { TLabelOperations } from "./root";

type ILabelCreate = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  values: string[];
  labelOperations: TLabelOperations;
  disabled?: boolean;
};

const defaultValues: Partial<IIssueLabel> = {
  name: "",
  color: "#ff0000",
};

export function LabelCreate(props: ILabelCreate) {
  const { workspaceSlug, projectId, issueId, values, labelOperations, disabled = false } = props;
  // state
  const [isCreateToggle, setIsCreateToggle] = useState(false);
  const handleIsCreateToggle = () => setIsCreateToggle(!isCreateToggle);
  const [referenceElement, setReferenceElement] = useState<HTMLButtonElement | null>(null);
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);
  // react hook form
  const {
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    control,
    setFocus,
  } = useForm<Partial<IIssueLabel>>({
    defaultValues,
  });

  const { styles, attributes } = usePopper(referenceElement, popperElement, {
    placement: "bottom-start",
    modifiers: [
      {
        name: "preventOverflow",
        options: {
          padding: 12,
        },
      },
    ],
  });

  useEffect(() => {
    if (!isCreateToggle) return;

    setFocus("name");
    reset();
  }, [isCreateToggle, reset, setFocus]);

  const handleLabel = async (formData: Partial<IIssueLabel>) => {
    if (!workspaceSlug || !projectId || isSubmitting) return;

    const labelResponse = await labelOperations.createLabel(workspaceSlug, projectId, formData);
    const currentLabels = [...(values || []), labelResponse.id];
    await labelOperations.updateIssue(workspaceSlug, projectId, issueId, { label_ids: currentLabels });
    handleIsCreateToggle();
    reset(defaultValues);
  };

  return (
    <>
      <div
        className="relative flex flex-shrink-0 cursor-pointer items-center gap-1 rounded-full border border-subtle p-0.5 px-2 text-11 text-tertiary transition-all hover:bg-surface-2 hover:text-secondary"
        onClick={handleIsCreateToggle}
      >
        <div className="flex-shrink-0">
          {isCreateToggle ? <CloseIcon className="h-2.5 w-2.5" /> : <PlusIcon className="h-2.5 w-2.5" />}
        </div>
        <div className="flex-shrink-0">{isCreateToggle ? "Cancel" : "New"}</div>
      </div>

      {isCreateToggle && (
        <form className="relative flex items-center gap-x-2 p-1" onSubmit={handleSubmit(handleLabel)}>
          <div>
            <Controller
              name="color"
              control={control}
              render={({ field: { value, onChange } }) => (
                <Popover>
                  <>
                    <Popover.Button as={Fragment}>
                      <button type="button" ref={setReferenceElement} className="grid place-items-center outline-none">
                        {value && value?.trim() !== "" && (
                          <span
                            className="h-5 w-5 rounded-sm"
                            style={{
                              backgroundColor: value ?? "black",
                            }}
                          />
                        )}
                      </button>
                    </Popover.Button>
                    <Popover.Panel className="fixed z-10">
                      <div
                        className="max-w-xs p-2 sm:px-0"
                        ref={setPopperElement}
                        style={styles.popper}
                        {...attributes.popper}
                      >
                        <TwitterPicker triangle={"hide"} color={value} onChange={(value) => onChange(value.hex)} />
                      </div>
                    </Popover.Panel>
                  </>
                </Popover>
              )}
            />
          </div>
          <Controller
            control={control}
            name="name"
            rules={{
              required: "This is required",
            }}
            render={({ field: { value, onChange, ref } }) => (
              <Input
                id="name"
                name="name"
                type="text"
                value={value ?? ""}
                onChange={onChange}
                ref={ref}
                hasError={Boolean(errors.name)}
                placeholder="Title"
                className="w-full px-1.5 py-1 text-11"
                disabled={isSubmitting}
              />
            )}
          />
          <button
            type="button"
            className="grid place-items-center rounded-sm bg-danger-primary p-1"
            onClick={() => setIsCreateToggle(false)}
            disabled={disabled}
          >
            <CloseIcon className="h-3.5 w-3.5 text-on-color" />
          </button>
          <button
            type="submit"
            className="grid place-items-center rounded-sm bg-success-primary p-1"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <Loader className="spin h-3.5 w-3.5 text-on-color" />
            ) : (
              <PlusIcon className="h-3.5 w-3.5 text-on-color" />
            )}
          </button>
        </form>
      )}
    </>
  );
}
