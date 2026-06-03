/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Work item title input for the issue modal, bound to the form's `name` field with validation.
 *
 * Rendered purpose: renders an autofocused `Input` for the work item title, bound to `TIssue.name` through
 * a React Hook Form `Controller`. Surfaces inline error text below the input when validation fails. Used
 * at the top of `form.tsx` immediately under the project / type / template selectors.
 *
 * Props (`TIssueTitleInputProps`):
 *   - control (`Control<TIssue>`, required) — React Hook Form control bound to the parent issue form
 *   - issueTitleRef (`React.MutableRefObject<HTMLInputElement | null>`, required) — externally-forwarded ref
 *     used by the base modal orchestrator to programmatically focus the title input after a "create more"
 *     submit (and on initial open); takes precedence over the Controller's own `field.ref` (the `ref` prop
 *     resolves to `issueTitleRef || ref`)
 *   - formState (`FormState<TIssue>`, required) — passed in to surface `errors.name` for the inline error
 *     message below the input
 *   - handleFormChange (`() => void`, required) — invoked after `onChange` propagates the new value to RHF;
 *     marks the form dirty (and triggers debounced duplicate-issue detection upstream)
 *
 * MobX stores read (via hooks):
 *   - `usePlatformOS()` — `isMobile` for `getTabIndex(ETabIndices.ISSUE_FORM, isMobile)` (keyboard tab order)
 *   - `useTranslation()` from `@plane/i18n` — `t` for i18n keys (`title`, `title_is_required`,
 *     `title_should_be_less_than_255_characters`)
 *
 * Validation rules (declared at the `Controller`-level `rules` prop):
 *   - `required: t("title_is_required")` — RHF-level required validation; the i18n string is used as the
 *     error message
 *   - `validate: validateWhitespace` — custom validator that rejects whitespace-only titles by returning
 *     `t("title_is_required")` when `value.trim() === ""`; returns `undefined` when valid
 *   - `maxLength: { value: 255, message: t("title_should_be_less_than_255_characters") }` — 255-character cap
 *     matching the API-level constraint
 *
 * Side effects:
 *   - Calls `onChange(e.target.value)` then `handleFormChange()` on every keystroke.
 *   - `autoFocus` on the input puts the cursor in the title field on initial render of the modal.
 *   - No direct service calls; no navigations; no toasts.
 *
 * Accessibility / keyboard notes:
 *   - `tabIndex={getIndex("name")}` participates in the consistent issue-form tab order.
 *   - The `<Input>` component (from `@plane/ui`) handles ARIA attributes for the input itself; the inline
 *     error message uses a `<span>` with semantic danger color (`text-danger-primary`) and is rendered
 *     unconditionally with `errors?.name?.message` falsy-empty when valid.
 *
 * Imperative DOM notes:
 *   - `ref={issueTitleRef || ref}` is the focus-management primitive: the parent's `issueTitleRef`
 *     consistently wins when supplied, falling back to the Controller's own `field.ref` only when the parent
 *     hasn't forwarded a ref. The base modal orchestrator uses this to call
 *     `issueTitleRef.current?.focus()` after a successful "create more" submit so the next title can be
 *     typed without manual focus.
 *
 * Architectural notes (per AAP §0.2.2):
 *   - MobX exclusively for state; only `usePlatformOS` is consumed here.
 *   - `react-hook-form` `Controller` for form binding; `Input` from `@plane/ui` for the rendered control.
 *   - i18n via `@plane/i18n` `useTranslation()`; the placeholder, required-error, and max-length-error
 *     strings are translation keys.
 *   - The 255-character cap matches the API/database constraint on `Issue.name`.
 */

import React from "react";
import { observer } from "mobx-react";
import type { Control, FormState } from "react-hook-form";
import { Controller } from "react-hook-form";
// plane imports
import { ETabIndices } from "@plane/constants";
// types
import { useTranslation } from "@plane/i18n";
import type { TIssue } from "@plane/types";
// ui
import { Input } from "@plane/ui";
// helpers
import { getTabIndex } from "@plane/utils";
// hooks
import { usePlatformOS } from "@/hooks/use-platform-os";

type TIssueTitleInputProps = {
  control: Control<TIssue>;
  issueTitleRef: React.MutableRefObject<HTMLInputElement | null>;
  formState: FormState<TIssue>;
  handleFormChange: () => void;
};

export const IssueTitleInput = observer(function IssueTitleInput(props: TIssueTitleInputProps) {
  const {
    control,
    issueTitleRef,
    formState: { errors },
    handleFormChange,
  } = props;
  // store hooks
  const { isMobile } = usePlatformOS();
  const { t } = useTranslation();

  const { getIndex } = getTabIndex(ETabIndices.ISSUE_FORM, isMobile);

  const validateWhitespace = (value: string) => {
    if (value.trim() === "") {
      return t("title_is_required");
    }
    return undefined;
  };
  return (
    <div>
      <Controller
        control={control}
        name="name"
        rules={{
          validate: validateWhitespace,
          required: t("title_is_required"),
          maxLength: {
            value: 255,
            message: t("title_should_be_less_than_255_characters"),
          },
        }}
        render={({ field: { value, onChange, ref } }) => (
          <Input
            id="name"
            name="name"
            type="text"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              handleFormChange();
            }}
            ref={issueTitleRef || ref}
            hasError={Boolean(errors.name)}
            placeholder={t("title")}
            className="w-full text-body-sm-regular"
            autoFocus
            tabIndex={getIndex("name")}
          />
        )}
      />
      <span className="text-caption-sm-medium text-danger-primary">{errors?.name?.message}</span>
    </div>
  );
});
