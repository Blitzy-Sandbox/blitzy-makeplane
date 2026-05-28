/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared React hook factory used by the issue-detail "links" widget and by the
 * widget-level modal host (`../issue-detail-widget-modals.tsx`) to build a workspace-,
 * project-, and issue-bound CRUD adapter for issue links. The adapter wraps the
 * MobX `createLink` / `updateLink` / `removeLink` actions with required-field validation
 * and standardized localized toast notifications so call sites do not duplicate that
 * boilerplate.
 *
 * Consumers:
 *   - apps/web/core/components/issues/issue-detail-widgets/links/content.tsx
 *   - apps/web/core/components/issues/issue-detail-widgets/issue-detail-widget-modals.tsx
 */

import { useMemo } from "react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssueLink, TIssueServiceType } from "@plane/types";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// local imports
import type { TLinkOperations } from "../../issue-detail/links";

/**
 * Builds a memoized `TLinkOperations` adapter (`{ create, update, remove }`) bound to a
 * specific issue context. Each handler validates required identifiers, dispatches the
 * matching MobX action on the issue-detail store (which delegates to `IssueLinkService`
 * for the HTTP call), and emits a localized success or error toast.
 *
 * @param workspaceSlug - Workspace slug; each handler throws "Missing required fields"
 *   when this, `projectId`, or `issueId` is falsy.
 * @param projectId - Project ID for the link's parent issue.
 * @param issueId - Issue ID whose links are being mutated.
 * @param issueServiceType - Selects between the "issues" and "epics" issue-detail store
 *   slices via `useIssueDetail`.
 * @returns A memoized `TLinkOperations` object with three async handlers:
 *   - `create(data)`: invokes `createLink` -> `IssueLinkService.create` -> POST. Re-throws
 *     after emitting an error toast so the caller (e.g. the modal form) can keep the form
 *     open on failure.
 *   - `update(linkId, data)`: invokes `updateLink` -> `IssueLinkService.update` -> PATCH.
 *     Re-throws after emitting an error toast.
 *   - `remove(linkId)`: invokes `removeLink` -> `IssueLinkService.remove` -> DELETE. Swallows
 *     errors after emitting an error toast (callers do not need to react to failure).
 *
 * MobX stores read:
 *   - `useIssueDetail(issueServiceType)` destructures `createLink`, `updateLink`, and
 *     `removeLink` — these are MobX actions whose memoization keys participate in the
 *     `useMemo` dependency list along with `t` (i18n) and the three identifier args.
 *
 * Side effects:
 *   - HTTP calls to `apps/api` via `IssueLinkService` (transitively through the store).
 *   - Toast emissions via `setToast` from `@plane/propel/toast` on every success and failure.
 */
export const useLinkOperations = (
  workspaceSlug: string,
  projectId: string,
  issueId: string,
  issueServiceType: TIssueServiceType
): TLinkOperations => {
  const { createLink, updateLink, removeLink } = useIssueDetail(issueServiceType);
  // i18n
  const { t } = useTranslation();

  const handleLinkOperations: TLinkOperations = useMemo(
    () => ({
      create: async (data: Partial<TIssueLink>) => {
        try {
          if (!workspaceSlug || !projectId || !issueId) throw new Error("Missing required fields");
          await createLink(workspaceSlug, projectId, issueId, data);
          setToast({
            message: t("links.toasts.created.message"),
            type: TOAST_TYPE.SUCCESS,
            title: t("links.toasts.created.title"),
          });
        } catch (error: any) {
          setToast({
            message: error?.data?.error ?? t("links.toasts.not_created.message"),
            type: TOAST_TYPE.ERROR,
            title: t("links.toasts.not_created.title"),
          });
          throw error;
        }
      },
      update: async (linkId: string, data: Partial<TIssueLink>) => {
        try {
          if (!workspaceSlug || !projectId || !issueId) throw new Error("Missing required fields");
          await updateLink(workspaceSlug, projectId, issueId, linkId, data);
          setToast({
            message: t("links.toasts.updated.message"),
            type: TOAST_TYPE.SUCCESS,
            title: t("links.toasts.updated.title"),
          });
        } catch (error: any) {
          setToast({
            message: error?.data?.error ?? t("links.toasts.not_updated.message"),
            type: TOAST_TYPE.ERROR,
            title: t("links.toasts.not_updated.title"),
          });
          throw error;
        }
      },
      remove: async (linkId: string) => {
        try {
          if (!workspaceSlug || !projectId || !issueId) throw new Error("Missing required fields");
          await removeLink(workspaceSlug, projectId, issueId, linkId);
          setToast({
            message: t("links.toasts.removed.message"),
            type: TOAST_TYPE.SUCCESS,
            title: t("links.toasts.removed.title"),
          });
        } catch {
          setToast({
            message: t("links.toasts.not_removed.message"),
            type: TOAST_TYPE.ERROR,
            title: t("links.toasts.not_removed.title"),
          });
        }
      },
    }),
    [workspaceSlug, projectId, issueId, createLink, updateLink, removeLink, t]
  );

  return handleLinkOperations;
};
