/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Modal used both to create a new issue link and to edit an existing one in the issue-detail panel.
 *
 * Rendered purpose: a `ModalCore` overlay containing a `react-hook-form` form with two `Controller`-
 * wrapped inputs (URL required, display title optional), a "Cancel" `Button`, and a primary submit
 * `Button`. Submit routing depends on whether a staged link id is present in the form payload —
 * `linkOperations.update(id, …)` for edit, `linkOperations.create(…)` for create. Localized title
 * and button labels via `useTranslation`.
 *
 * Props (`TIssueLinkCreateEditModal`, exported):
 *   - isModalOpen (boolean, required): controls modal visibility.
 *   - handleOnClose? (() => void, optional): invoked after the modal clears its staged link data;
 *     provided by `./root.tsx` to flip its local `isIssueLinkModal` toggle.
 *   - linkOperations (TLinkOperationsModal, required): the create/update handlers exposed by
 *     `IssueLinkRoot` in `./root`. Locally aliased as
 *     `TLinkOperationsModal = Exclude<TLinkOperations, "remove">` (the remove path is not used here).
 *   - issueServiceType (TIssueServiceType, required): selects the issue-detail store namespace
 *     (`EIssueServiceType.ISSUES` vs `EIssueServiceType.EPICS`) so the correct `issueLinkData`
 *     slice is read for rehydration.
 *
 * Form state (`TIssueLinkCreateFormFieldOptions`, exported): `TIssueLinkEditableFields & { id?: string }`.
 * The optional `id` is what discriminates create vs update at submit time.
 *
 * MobX stores read:
 *   - `useIssueDetail(issueServiceType)` — `issueLinkData` (the staged link record, `null` for
 *     create mode), and `setIssueLinkData` (clears staged data on close).
 *
 * Non-store hooks:
 *   - `useTranslation()` — localizes the modal heading, URL label, optional-title label, validation
 *     error message ("URL is invalid"), and primary button copy (Add Link / Adding Link… /
 *     Update Link / Updating Link…).
 *   - `react-hook-form`'s `useForm` for field state, validation, and submit handling. The
 *     `useEffect` on `[preloadedData, reset, isModalOpen]` rehydrates the form by spreading
 *     `defaultValues` then `preloadedData` whenever the modal opens.
 *
 * Side effects:
 *   - On submit success: routes to `linkOperations.create({ title, url: parsedUrl })` (when no
 *     `id`) or `linkOperations.update(id, { title, url: parsedUrl })` (when `id`). Both call paths
 *     ultimately reach `apps/api`'s `IssueLinkViewSet`
 *     (`/api/workspaces/<slug>/projects/<id>/issues/<issue_id>/issue-links/`).
 *   - Calls `setIssueLinkData(null)` on close (and after a successful submit) to clear the staged
 *     edit record so the next open begins in create mode by default.
 *   - On submit failure: logs to `console.error` (the toast is emitted by the contract layer in
 *     `./root.tsx`, not by this file).
 *
 * URL normalization (preserve verbatim, security-relevant): a submitted URL that does NOT start with
 * `"http"` is auto-prefixed with `"http://"`. This is intentional so users can paste raw hostnames
 * like `example.com` and have them stored as valid absolute URLs. Note this prefixes ONLY when the
 * literal substring `"http"` is missing at the start; URLs that start with `"https://"`,
 * `"http://"`, or even `"httpfoo"` are passed through unchanged.
 *
 * Wrapped in `mobx-react` `observer` because `useIssueDetail(...).issueLinkData` is observable.
 *
 * Consumers: rendered by `./root.tsx` (`IssueLinkRoot`) inside the issue-detail links
 * panel and re-used by the relations link surface for the create/update link flow.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "@plane/i18n";
// plane types
import { Button } from "@plane/propel/button";
import type { TIssueLinkEditableFields, TIssueServiceType } from "@plane/types";
// plane ui
import { Input, ModalCore } from "@plane/ui";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// types
import type { TLinkOperations } from "./root";

export type TLinkOperationsModal = Exclude<TLinkOperations, "remove">;

export type TIssueLinkCreateFormFieldOptions = TIssueLinkEditableFields & {
  id?: string;
};

export type TIssueLinkCreateEditModal = {
  isModalOpen: boolean;
  handleOnClose?: () => void;
  linkOperations: TLinkOperationsModal;
  issueServiceType: TIssueServiceType;
};

const defaultValues: TIssueLinkCreateFormFieldOptions = {
  title: "",
  url: "",
};

export const IssueLinkCreateUpdateModal = observer(function IssueLinkCreateUpdateModal(
  props: TIssueLinkCreateEditModal
) {
  const { isModalOpen, handleOnClose, linkOperations, issueServiceType } = props;
  // i18n
  const { t } = useTranslation();
  // react hook form
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    control,
    reset,
  } = useForm<TIssueLinkCreateFormFieldOptions>({
    defaultValues,
  });
  // store hooks
  const { issueLinkData: preloadedData, setIssueLinkData } = useIssueDetail(issueServiceType);

  const onClose = () => {
    setIssueLinkData(null);
    if (handleOnClose) handleOnClose();
  };

  const handleFormSubmit = async (formData: TIssueLinkCreateFormFieldOptions) => {
    // Auto-prefix raw hostnames with `http://` so users can paste `example.com` and have it stored as a valid absolute URL.
    const parsedUrl = formData.url.startsWith("http") ? formData.url : `http://${formData.url}`;
    try {
      if (!formData || !formData.id) await linkOperations.create({ title: formData.title, url: parsedUrl });
      else await linkOperations.update(formData.id, { title: formData.title, url: parsedUrl });
      onClose();
    } catch (error) {
      console.error("error", error);
    }
  };

  useEffect(() => {
    if (isModalOpen) reset({ ...defaultValues, ...preloadedData });
  }, [preloadedData, reset, isModalOpen]);

  return (
    <ModalCore isOpen={isModalOpen} handleClose={onClose}>
      <form onSubmit={handleSubmit(handleFormSubmit)}>
        <div className="space-y-5 p-5">
          <h3 className="text-h4-medium text-secondary">
            {preloadedData?.id ? t("common.update_link") : t("common.add_link")}
          </h3>
          <div className="mt-2 space-y-3">
            <div>
              <label htmlFor="url" className="mb-2 text-secondary">
                {t("common.url")}
              </label>
              <Controller
                control={control}
                name="url"
                rules={{
                  required: "URL is required",
                }}
                render={({ field: { value, onChange, ref } }) => (
                  <Input
                    id="url"
                    type="text"
                    value={value}
                    onChange={onChange}
                    ref={ref}
                    hasError={Boolean(errors.url)}
                    placeholder={t("common.type_or_paste_a_url")}
                    className="w-full"
                  />
                )}
              />
              {errors.url && (
                <span className="text-caption-sm-regular text-danger-primary">{t("common.url_is_invalid")}</span>
              )}
            </div>
            <div>
              <label htmlFor="title" className="mb-2 text-secondary">
                {t("common.display_title")}
                <span className="block text-caption-xs-regular">{t("common.optional")}</span>
              </label>
              <Controller
                control={control}
                name="title"
                render={({ field: { value, onChange, ref } }) => (
                  <Input
                    id="title"
                    type="text"
                    value={value}
                    onChange={onChange}
                    ref={ref}
                    hasError={Boolean(errors.title)}
                    placeholder={t("common.link_title_placeholder")}
                    className="w-full"
                  />
                )}
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t-[0.5px] border-subtle px-5 py-4">
          <Button variant="secondary" size="lg" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" size="lg" type="submit" loading={isSubmitting}>
            {`${
              preloadedData?.id
                ? isSubmitting
                  ? t("common.updating")
                  : t("common.update")
                : isSubmitting
                  ? t("common.adding")
                  : t("common.add")
            } ${t("common.link")}`}
          </Button>
        </div>
      </form>
    </ModalCore>
  );
});
