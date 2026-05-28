/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Sub-issue operations hook — provides a centralized, memoized bundle of CRUD actions for sub-work-items used by both the
 * sub-issues collapsible body (`./content.tsx`) and the upstream modals owner (`../issue-detail-widget-modals.tsx`).
 * Wraps the underlying `issue-detail` MobX store actions with translation-aware toast emissions and helper-state bookkeeping
 * (`setSubIssueHelpers(parentIssueId, "issue_loader", issueId)` toggled before/after each mutation).
 */

import { useMemo } from "react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssueServiceType, TSubIssueOperations } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
import { copyUrlToClipboard } from "@plane/utils";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";

/**
 * `useSubIssueOperations(issueServiceType)` — React hook that returns a stable `TSubIssueOperations` bundle for the given issue
 * service slice (e.g. `ISSUES` vs. `EPICS`). Memoized via `useMemo` so consumers can pass it through props without unnecessary re-renders.
 *
 * @param issueServiceType - Selects the `useIssueDetail` store slice supplying the underlying mutations.
 * @returns A `TSubIssueOperations` object exposing:
 *   - `copyLink(path)`: Promise<void>. Side effect — copies URL to clipboard via `copyUrlToClipboard`; emits a success toast.
 *   - `fetchSubIssues(workspaceSlug, projectId, parentIssueId)`: Promise<void>. Side effect — issues GET via the store action; emits an error toast on failure.
 *   - `addSubIssue(workspaceSlug, projectId, parentIssueId, issueIds[])`: Promise<void>. Side effect — POSTs to attach the given existing issue ids as sub-work-items of `parentIssueId` (delegates to the store action `createSubIssues`, which calls the sub-issue service); emits success on attach, error toast on failure. NOTE: despite the operation name `addSubIssue`, the underlying store action is plural-named `createSubIssues` and represents the "attach existing" flow — distinct from the "create new" flow that goes through `CreateUpdateIssueModal`.
 *   - `updateSubIssue(workspaceSlug, projectId, parentIssueId, issueId, issueData, oldIssue = {}, fromModal = false)`: Promise<void>. Side effect — toggles `setSubIssueHelpers(parentIssueId, "issue_loader", issueId)` before and after the PATCH, calls the store action `updateSubIssue`; emits success/error toasts keyed by `sub_work_item.update.success` / `sub_work_item.update.error`. The `fromModal` flag is forwarded to the store action to disambiguate inline-edit vs. modal-edit code paths.
 *   - `removeSubIssue(workspaceSlug, projectId, parentIssueId, issueId)`: Promise<void>. Side effect — DETACHES the sub-work-item from its parent (does NOT delete the issue record); toggles `issue_loader` around the call; emits success/error toasts.
 *   - `deleteSubIssue(workspaceSlug, projectId, parentIssueId, issueId)`: Promise<void>. Side effect — FULL DELETE of the sub-work-item; toggles `issue_loader` around the call; emits an error toast on failure only (no success toast — confirmation is handled at the modal layer).
 *
 * Toast emissions:
 *   - All toasts use `setToast` from `@plane/propel/toast` and source translated strings via `@plane/i18n`.
 *   - Translation keys vary by `issueServiceType` so the "entity" placeholder reads "sub-work item" for `ISSUES` and "issue" (epic context) otherwise.
 *
 * Idempotency:
 *   - `fetchSubIssues` is idempotent (safe to re-invoke; the store caches results).
 *   - `addSubIssue`, `removeSubIssue`, `updateSubIssue`, `deleteSubIssue` are NON-idempotent — duplicate invocations produce duplicate mutations (the store layer does not de-duplicate). Callers MUST guard against double-submission at the UI layer (e.g. by disabling the trigger).
 */
export const useSubIssueOperations = (issueServiceType: TIssueServiceType): TSubIssueOperations => {
  // translation
  const { t } = useTranslation();
  // store hooks
  const {
    subIssues: { setSubIssueHelpers },
    createSubIssues,
    fetchSubIssues,
    updateSubIssue,
    deleteSubIssue,
    removeSubIssue,
  } = useIssueDetail(issueServiceType);

  const subIssueOperations: TSubIssueOperations = useMemo(
    () => ({
      copyLink: async (path) => {
        await copyUrlToClipboard(path);
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: t("common.link_copied"),
          message: t("entity.link_copied_to_clipboard", {
            entity:
              issueServiceType === EIssueServiceType.ISSUES
                ? t("common.sub_work_items", { count: 1 })
                : t("issue.label", { count: 1 }),
          }),
        });
      },
      fetchSubIssues: async (workspaceSlug, projectId, parentIssueId) => {
        try {
          await fetchSubIssues(workspaceSlug, projectId, parentIssueId);
        } catch {
          setToast({
            type: TOAST_TYPE.ERROR,
            title: t("toast.error"),
            message: t("entity.fetch.failed", {
              entity:
                issueServiceType === EIssueServiceType.ISSUES
                  ? t("common.sub_work_items", { count: 2 })
                  : t("issue.label", { count: 2 }),
            }),
          });
        }
      },
      addSubIssue: async (workspaceSlug, projectId, parentIssueId, issueIds) => {
        try {
          await createSubIssues(workspaceSlug, projectId, parentIssueId, issueIds);
          setToast({
            type: TOAST_TYPE.SUCCESS,
            title: t("toast.success"),
            message: t("entity.add.success", {
              entity:
                issueServiceType === EIssueServiceType.ISSUES
                  ? t("common.sub_work_items")
                  : t("issue.label", { count: issueIds.length }),
            }),
          });
        } catch {
          setToast({
            type: TOAST_TYPE.ERROR,
            title: t("toast.error"),
            message: t("entity.add.failed", {
              entity:
                issueServiceType === EIssueServiceType.ISSUES
                  ? t("common.sub_work_items")
                  : t("issue.label", { count: issueIds.length }),
            }),
          });
        }
      },
      updateSubIssue: async (
        workspaceSlug,
        projectId,
        parentIssueId,
        issueId,
        issueData,
        oldIssue = {},
        fromModal = false
      ) => {
        try {
          setSubIssueHelpers(parentIssueId, "issue_loader", issueId);
          await updateSubIssue(workspaceSlug, projectId, parentIssueId, issueId, issueData, oldIssue, fromModal);
          setToast({
            type: TOAST_TYPE.SUCCESS,
            title: t("toast.success"),
            message: t("sub_work_item.update.success"),
          });
          setSubIssueHelpers(parentIssueId, "issue_loader", issueId);
        } catch (_error) {
          setToast({
            type: TOAST_TYPE.ERROR,
            title: t("toast.error"),
            message: t("sub_work_item.update.error"),
          });
        }
      },
      removeSubIssue: async (workspaceSlug, projectId, parentIssueId, issueId) => {
        try {
          setSubIssueHelpers(parentIssueId, "issue_loader", issueId);
          await removeSubIssue(workspaceSlug, projectId, parentIssueId, issueId);
          setToast({
            type: TOAST_TYPE.SUCCESS,
            title: t("toast.success"),
            message: t("entity.remove.success", {
              entity:
                issueServiceType === EIssueServiceType.ISSUES
                  ? t("common.sub_work_items")
                  : t("issue.label", { count: 1 }),
            }),
          });
          setSubIssueHelpers(parentIssueId, "issue_loader", issueId);
        } catch (_error) {
          setToast({
            type: TOAST_TYPE.ERROR,
            title: t("toast.error"),
            message: t("entity.remove.failed", {
              entity:
                issueServiceType === EIssueServiceType.ISSUES
                  ? t("common.sub_work_items")
                  : t("issue.label", { count: 1 }),
            }),
          });
        }
      },
      deleteSubIssue: async (workspaceSlug, projectId, parentIssueId, issueId) => {
        try {
          setSubIssueHelpers(parentIssueId, "issue_loader", issueId);
          await deleteSubIssue(workspaceSlug, projectId, parentIssueId, issueId);
          setSubIssueHelpers(parentIssueId, "issue_loader", issueId);
        } catch (_error) {
          setToast({
            type: TOAST_TYPE.ERROR,
            title: t("toast.error"),
            message: t("entity.delete.failed", {
              entity:
                issueServiceType === EIssueServiceType.ISSUES
                  ? t("common.sub_work_items")
                  : t("issue.label", { count: 1 }),
            }),
          });
        }
      },
    }),
    [
      createSubIssues,
      deleteSubIssue,
      fetchSubIssues,
      issueServiceType,
      removeSubIssue,
      setSubIssueHelpers,
      t,
      updateSubIssue,
    ]
  );

  return subIssueOperations;
};
