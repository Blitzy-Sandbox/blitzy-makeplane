/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Reusable cycle form (project picker, name, description, start/end date range)
 * that delegates persistence to the parent via `handleFormSubmit` — used by both
 * the create and update modal flows.
 *
 * Props:
 *   - handleFormSubmit ((values: Partial<ICycle>) => Promise<void>, required):
 *     async submit handler invoked with the form values; the caller is responsible
 *     for create vs. update routing, date conflict checks, and store mutations.
 *   - handleClose (() => void, required): called when the user clicks Cancel.
 *   - status (boolean, required): true when editing an existing cycle (hides the
 *     project picker and swaps the heading to "Update cycle"), false when creating.
 *   - projectId (string, required): default project ID seeded into the form.
 *   - setActiveProject ((projectId: string) => void, required): callback used to
 *     bubble project selection changes back to the parent modal so that subsequent
 *     API calls target the chosen project.
 *   - data (ICycle | null, optional): when present, prefills name/description/dates
 *     via react-hook-form's `reset` effect.
 *   - isMobile (boolean, optional, default=false): passed to getTabIndex so tab
 *     order adapts to the platform.
 *
 * MobX stores read:
 *   - useUser (user store): projectsWithCreatePermissions — used as the
 *     ProjectDropdown render filter so only projects where the user can create
 *     cycles are selectable.
 *
 * Side effects:
 *   - None directly. This component is a controlled form — react-hook-form manages
 *     local state, and persistence is the parent's responsibility via
 *     handleFormSubmit. No service calls, no toasts, no navigation.
 *   - Imperative form reset: a useEffect calls reset({ ...defaultValues, ...data })
 *     whenever `data` changes so prefill stays in sync with edit-target switches.
 *
 * Consumers: CycleCreateUpdateModal in modal.tsx.
 */

import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
// plane imports
import { ETabIndices } from "@plane/constants";
// types
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import type { ICycle } from "@plane/types";
// ui
import { Input, TextArea } from "@plane/ui";
import { getDate, renderFormattedPayloadDate, getTabIndex } from "@plane/utils";
// components
import { DateRangeDropdown } from "@/components/dropdowns/date-range";
import { ProjectDropdown } from "@/components/dropdowns/project/dropdown";
// hooks
import { useUser } from "@/hooks/store/user/user-user";

type Props = {
  handleFormSubmit: (values: Partial<ICycle>) => Promise<void>;
  handleClose: () => void;
  status: boolean;
  projectId: string;
  setActiveProject: (projectId: string) => void;
  data?: ICycle | null;
  isMobile?: boolean;
};

const defaultValues: Partial<ICycle> = {
  name: "",
  description: "",
  start_date: null,
  end_date: null,
};

export function CycleForm(props: Props) {
  const { handleFormSubmit, handleClose, status, projectId, setActiveProject, data, isMobile = false } = props;
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { projectsWithCreatePermissions } = useUser();
  // form data
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    control,
    reset,
  } = useForm<ICycle>({
    defaultValues: {
      project_id: projectId,
      name: data?.name || "",
      description: data?.description || "",
      start_date: data?.start_date || null,
      end_date: data?.end_date || null,
    },
  });

  const { getIndex } = getTabIndex(ETabIndices.PROJECT_CYCLE, isMobile);

  useEffect(() => {
    reset({
      ...defaultValues,
      ...data,
    });
  }, [data, reset]);

  return (
    <form onSubmit={handleSubmit((formData) => handleFormSubmit(formData))}>
      <div className="space-y-5 p-5">
        <div className="flex items-center gap-x-3">
          {!status && (
            <Controller
              control={control}
              name="project_id"
              render={({ field: { value, onChange } }) => (
                <div className="h-7">
                  <ProjectDropdown
                    value={value}
                    onChange={(val) => {
                      if (!Array.isArray(val)) {
                        onChange(val);
                        setActiveProject(val);
                      }
                    }}
                    multiple={false}
                    buttonVariant="border-with-text"
                    renderCondition={(projectId) => !!projectsWithCreatePermissions?.[projectId]}
                    tabIndex={getIndex("cover_image")}
                  />
                </div>
              )}
            />
          )}
          <h3 className="text-18 font-medium text-secondary">
            {status ? t("project_cycles.update_cycle") : t("project_cycles.create_cycle")}
          </h3>
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <Controller
              name="name"
              control={control}
              rules={{
                required: t("title_is_required"),
                maxLength: {
                  value: 255,
                  message: t("title_should_be_less_than_255_characters"),
                },
              }}
              render={({ field: { value, onChange } }) => (
                <Input
                  name="name"
                  type="text"
                  placeholder={t("title")}
                  className="w-full text-14"
                  value={value}
                  inputSize="md"
                  onChange={onChange}
                  hasError={Boolean(errors?.name)}
                  tabIndex={getIndex("description")}
                  autoFocus
                />
              )}
            />
            <span className="text-11 text-danger-primary">{errors?.name?.message}</span>
          </div>
          <div>
            <Controller
              name="description"
              control={control}
              render={({ field: { value, onChange } }) => (
                <TextArea
                  name="description"
                  placeholder={t("description")}
                  className="min-h-24 w-full resize-none text-14"
                  hasError={Boolean(errors?.description)}
                  value={value}
                  onChange={onChange}
                  tabIndex={getIndex("description")}
                />
              )}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Controller
              control={control}
              name="start_date"
              render={({ field: { value: startDateValue, onChange: onChangeStartDate } }) => (
                <Controller
                  control={control}
                  name="end_date"
                  render={({ field: { value: endDateValue, onChange: onChangeEndDate } }) => (
                    <DateRangeDropdown
                      buttonVariant="border-with-text"
                      className="h-7"
                      minDate={new Date()}
                      value={{
                        from: getDate(startDateValue),
                        to: getDate(endDateValue),
                      }}
                      onSelect={(val) => {
                        onChangeStartDate(val?.from ? renderFormattedPayloadDate(val.from) : null);
                        onChangeEndDate(val?.to ? renderFormattedPayloadDate(val.to) : null);
                      }}
                      placeholder={{
                        from: "Start date",
                        to: "End date",
                      }}
                      hideIcon={{
                        to: true,
                      }}
                      tabIndex={getIndex("date_range")}
                    />
                  )}
                />
              )}
            />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t-[0.5px] border-subtle px-5 py-4">
        <Button variant="secondary" size="lg" onClick={handleClose} tabIndex={getIndex("cancel")}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" size="lg" type="submit" loading={isSubmitting} tabIndex={getIndex("submit")}>
          {data
            ? isSubmitting
              ? t("common.updating")
              : t("project_cycles.update_cycle")
            : isSubmitting
              ? t("common.creating")
              : t("project_cycles.create_cycle")}
        </Button>
      </div>
    </form>
  );
}
