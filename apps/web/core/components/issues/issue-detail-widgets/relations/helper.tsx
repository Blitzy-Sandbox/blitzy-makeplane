/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Central relation-operations helper consumed by `RelationsCollapsibleContent`
 * (and other relation-widget surfaces) to perform copy-link / update / remove
 * actions against related issues or epics, with consistent localized toast
 * feedback.
 *
 * This module deliberately does NOT group relations by `relation_type` — the four
 * `TIssueRelationTypes` values (`"blocking"`, `"blocked_by"`, `"duplicate"`,
 * `"relates_to"`) are grouped in the sibling `content.tsx` against
 * `useTimeLineRelationOptions()` and `getRelationsByIssueId(...)`. This file owns
 * only the per-issue CRUD primitives that the grouping layer dispatches into.
 *
 * The CRUD wrappers proxy to the `useIssueDetail` MobX store, whose underlying
 * service calls flow through `IssueService` / `IssueRelationService`
 * (`apps/web/core/services/issue/issue_relation.service.ts`).
 *
 * Consumers: `useRelationOperations` is invoked from `./content.tsx` (relations
 * collapsible body), `../../relations/issue-list.tsx`, and
 * `../../relations/issue-list-item.tsx` (per-relation row CRUD bindings).
 */

import { useMemo } from "react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssue, TIssueServiceType } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
import { copyUrlToClipboard } from "@plane/utils";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";

/**
 * Shape of the memoized relation-operations bundle returned by
 * {@link useRelationOperations}. Each field is a stable handler suitable for
 * passing into row-level components (e.g., relation list rows) without
 * triggering unnecessary re-renders.
 *
 * Fields:
 *   - `copyLink(path)` — copies a relation / issue URL to the clipboard and
 *     emits a SUCCESS toast with the localized "link copied" message. Path is
 *     a fully-qualified or app-relative URL string; the toast text adapts to
 *     "Work item" vs. "Epic" based on the active `issueServiceType`.
 *   - `update(workspaceSlug, projectId, issueId, data)` — proxies to the
 *     store's `updateIssue` action. On success emits a SUCCESS toast
 *     (`entity.update.success`); on caught error emits an ERROR toast
 *     (`entity.update.failed`). The data payload is a partial `TIssue` from
 *     `@plane/types`.
 *   - `remove(workspaceSlug, projectId, issueId)` — proxies to the store's
 *     `removeIssue` action without any local toast emission; caller is
 *     responsible for surfacing failure to the user.
 */
export type TRelationIssueOperations = {
  copyLink: (path: string) => void;
  update: (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssue>) => Promise<void>;
  remove: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
};

/**
 * Returns a memoized {@link TRelationIssueOperations} bundle scoped to the
 * caller's issue service type (issues vs. epics). The hook centralizes copy /
 * update / remove behavior so that every relation-widget surface emits
 * consistent localized toasts and dispatches into the correct MobX slice.
 *
 * @param issueServiceType - Discriminant selecting which `useIssueDetail` slice
 *   the returned operations target. Defaults to `EIssueServiceType.ISSUES`;
 *   pass `EIssueServiceType.EPICS` to obtain the epic-flavored wrappers (the
 *   toast copy switches `entity` from "Work item" to "Epic" accordingly).
 * @returns A stable {@link TRelationIssueOperations} object whose `copyLink`,
 *   `update`, and `remove` handlers proxy to the store actions and emit toasts
 *   as described on the type definition. The memo dependency array is
 *   `[entityName, removeIssue, t, updateIssue]`.
 *
 * Service / store routing:
 *   - `update` → `useIssueDetail(issueServiceType).updateIssue` →
 *     `IssueService` (and downstream `IssueRelationService` where applicable).
 *   - `remove` → `useIssueDetail(issueServiceType).removeIssue` →
 *     `IssueService` deletion endpoint.
 *   - `copyLink` → `copyUrlToClipboard(...)` from `@plane/utils`; no backend
 *     call.
 *
 * Toast emissions (all via `setToast` from `@plane/propel/toast`):
 *   - `copyLink` — `TOAST_TYPE.SUCCESS` with `common.link_copied` /
 *     `entity.link_copied_to_clipboard`.
 *   - `update` (success) — `TOAST_TYPE.SUCCESS` with `toast.success` /
 *     `entity.update.success`.
 *   - `update` (caught error) — `TOAST_TYPE.ERROR` with `toast.error` /
 *     `entity.update.failed`.
 *   - `remove` — no toast emitted here; caller decides.
 */
export const useRelationOperations = (
  issueServiceType: TIssueServiceType = EIssueServiceType.ISSUES
): TRelationIssueOperations => {
  const { updateIssue, removeIssue } = useIssueDetail(issueServiceType);
  const { t } = useTranslation();
  // derived values
  const entityName = issueServiceType === EIssueServiceType.ISSUES ? "Work item" : "Epic";

  const issueOperations: TRelationIssueOperations = useMemo(
    () => ({
      copyLink: async (path) => {
        await copyUrlToClipboard(path);
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: t("common.link_copied"),
          message: t("entity.link_copied_to_clipboard", { entity: entityName }),
        });
      },
      update: async (workspaceSlug, projectId, issueId, data) => {
        try {
          await updateIssue(workspaceSlug, projectId, issueId, data);
          setToast({
            title: t("toast.success"),
            type: TOAST_TYPE.SUCCESS,
            message: t("entity.update.success", { entity: entityName }),
          });
        } catch (_error) {
          setToast({
            title: t("toast.error"),
            type: TOAST_TYPE.ERROR,
            message: t("entity.update.failed", { entity: entityName }),
          });
        }
      },
      remove: async (workspaceSlug, projectId, issueId) => {
        return removeIssue(workspaceSlug, projectId, issueId);
      },
    }),
    [entityName, removeIssue, t, updateIssue]
  );

  return issueOperations;
};
