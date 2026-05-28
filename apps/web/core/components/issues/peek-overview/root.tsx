/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Top-level orchestration component for the issue peek-overview panel.
 *
 * Rendered purpose: resolves the active peek-issue from `useIssueDetail()`, fetches it with SWR,
 * builds a memoized `TIssueOperations` contract (fetch / update / remove / archive / restore /
 * cycle and module association mutators), determines edit permissions for the current user, and
 * renders `<IssueView />` with all required state and operations wired in. Returns an empty fragment
 * when no peek issue is active or when required ids cannot be resolved.
 *
 * Props (IWorkItemPeekOverview from `@plane/types`):
 *   - embedIssue (boolean, optional, default=false): when true, the panel is rendered inline (no portal,
 *     no outside-click dismissal) by the consumer; controls notification-removal behavior
 *   - embedRemoveCurrentNotification (() => void, optional): callback invoked when the embedded peek is
 *     dismissed (used by inbox / notification flows to clear the current row)
 *   - is_draft (boolean, optional, default=false): preserved verbatim from the public contract; carried
 *     through the operations closure
 *   - storeType (EIssuesStoreType, optional): explicit issue store override; falls back to
 *     `useIssueStoreType()` resolved from the route layout
 *
 * MobX stores read:
 *   - `useUserPermissions()` — `allowPermissions` for the project-level ADMIN/MEMBER edit gate
 *   - `useIssues(EIssuesStoreType.ARCHIVED)` — `restoreIssue` for the archive-restore operation
 *   - `useIssueDetail()` — `peekIssue`, `setPeekIssue`, `issue.fetchIssue`, `fetchActivities`
 *   - `useIssueStoreType()` — resolves the active store type from the current route layout
 *   - `useIssues(storeType)` — `issues` slice exposing `updateIssue`, `removeIssue`, `archiveIssue`,
 *     `addCycleToIssue`, `addIssueToCycle`, `removeIssueFromCycle`, `changeModulesInIssue`,
 *     `removeIssuesFromModule`
 *   - `useWorkItemProperties(...)` — preloads custom work-item properties for the peek issue scoped to
 *     ISSUES or EPICS service type
 *
 * Side effects:
 *   - SWR fetch: `["peek-issue", workspaceSlug, projectId, issueId]` keyed call to
 *     `issueOperations.fetch(...)`. Configured with `revalidateIfStale/OnFocus/OnReconnect: false`
 *     so the peek does not refetch on focus changes — the user keeps the snapshot they opened.
 *   - API mutations (all routed through the issue store, which fans out to the matching `IssueService`):
 *       fetch    → GET    /api/workspaces/<slug>/projects/<projectId>/issues/<issueId>/
 *       update   → PATCH  /api/workspaces/<slug>/projects/<projectId>/issues/<issueId>/    (+ refetch activities)
 *       remove   → DELETE /api/workspaces/<slug>/projects/<projectId>/issues/<issueId>/    (+ close peek)
 *       archive  → POST   /api/workspaces/<slug>/projects/<projectId>/issues/<issueId>/archive/
 *       restore  → POST   /api/workspaces/<slug>/projects/<projectId>/archived-issues/<issueId>/unarchive/
 *       addCycleToIssue / removeIssueFromCycle / addIssueToCycle → cycle association mutations + activity refresh
 *       changeModulesInIssue / removeIssueFromModule              → module association mutations + activity refresh
 *   - Toast emissions via `setToast` and `setPromiseToast` (i18n-keyed): success/error feedback for
 *     restore, update, delete, cycle removal, and module removal flows.
 *   - On error during `fetch`, sets the local `error` state which causes `IssueView` to render
 *     `<IssuePeekOverviewError />` in the next paint.
 *   - On successful `remove`, invokes `removeRoutePeekId()` to close the peek and clear the URL.
 *
 * Derived state notes:
 *   - `isEditable` combines `allowPermissions([ADMIN, MEMBER], PROJECT, …)` — disabled when the user is a
 *     guest or viewer; passed to `IssueView` as `disabled = !isEditable`.
 *   - `removeRoutePeekId` is memoized with `useCallback` and additionally fires
 *     `embedRemoveCurrentNotification?.()` so embedded contexts (inbox) can clear their selection.
 *   - The `issueOperations` `useMemo` intentionally omits some dependencies (see the inline
 *     `// eslint-disable-next-line react-hooks/exhaustive-deps` directive — preserve it as-is).
 *   - The `useWorkItemProperties(...)` call switches between `EIssueServiceType.EPICS` and
 *     `EIssueServiceType.ISSUES` based on the resolved `storeType` so epic-scoped custom properties
 *     are loaded when the peeked entity is an epic.
 *
 * Consumers:
 *   - `apps/web/core/components/issues/issue-detail/...` — mounted when the work item URL has a peek query
 *   - `apps/web/core/components/issues/issue-layouts/**` — mounted at the layout root to support deep-link peeks
 *   - Inbox / notification widgets that pass `embedIssue` + `embedRemoveCurrentNotification`
 *
 * Architectural notes:
 *   - MobX exclusively — stores are injected via React context; no Redux.
 *   - Router context: `usePathname()` comes from `next/navigation` (imported as legacy; preserved verbatim
 *     per system boundary "No refactoring, renaming, or restructuring of any kind").
 *   - SWR is used for the initial fetch only; subsequent mutations re-hydrate the MobX issue store directly.
 */

import { useState, useMemo, useCallback } from "react";
import { observer } from "mobx-react";
import { usePathname } from "next/navigation";
// Plane imports
import useSWR from "swr";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setPromiseToast, setToast } from "@plane/propel/toast";
import type { IWorkItemPeekOverview, TIssue } from "@plane/types";
import { EIssueServiceType, EIssuesStoreType } from "@plane/types";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useUserPermissions } from "@/hooks/store/user";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { useWorkItemProperties } from "@/plane-web/hooks/use-issue-properties";
// local imports
import type { TIssueOperations } from "../issue-detail";
import { IssueView } from "./view";

export const IssuePeekOverview = observer(function IssuePeekOverview(props: IWorkItemPeekOverview) {
  const {
    embedIssue = false,
    embedRemoveCurrentNotification,
    is_draft = false,
    storeType: issueStoreFromProps,
  } = props;
  const { t } = useTranslation();
  // router
  const pathname = usePathname();
  // store hook
  const { allowPermissions } = useUserPermissions();

  const {
    issues: { restoreIssue },
  } = useIssues(EIssuesStoreType.ARCHIVED);
  const {
    peekIssue,
    setPeekIssue,
    issue: { fetchIssue },
    fetchActivities,
  } = useIssueDetail();
  const issueStoreType = useIssueStoreType();
  const storeType = issueStoreFromProps ?? issueStoreType;
  const { issues } = useIssues(storeType);

  useWorkItemProperties(
    peekIssue?.projectId,
    peekIssue?.workspaceSlug,
    peekIssue?.issueId,
    storeType === EIssuesStoreType.EPIC ? EIssueServiceType.EPICS : EIssueServiceType.ISSUES
  );
  // state
  const [error, setError] = useState(false);

  const removeRoutePeekId = useCallback(() => {
    setPeekIssue(undefined);
    if (embedIssue) embedRemoveCurrentNotification?.();
  }, [embedIssue, embedRemoveCurrentNotification, setPeekIssue]);

  const issueOperations: TIssueOperations = useMemo(
    () => ({
      fetch: async (workspaceSlug: string, projectId: string, issueId: string) => {
        try {
          setError(false);
          await fetchIssue(workspaceSlug, projectId, issueId);
        } catch (error) {
          setError(true);
          console.error("Error fetching the parent issue", error);
        }
      },
      update: async (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssue>) => {
        if (issues?.updateIssue) {
          await issues
            .updateIssue(workspaceSlug, projectId, issueId, data)
            .then(async () => {
              fetchActivities(workspaceSlug, projectId, issueId);
              return;
            })
            .catch((_error) => {
              setToast({
                title: t("toast.error"),
                type: TOAST_TYPE.ERROR,
                message: t("entity.update.failed", { entity: t("issue.label", { count: 1 }) }),
              });
            });
        }
      },
      remove: async (workspaceSlug: string, projectId: string, issueId: string) => {
        try {
          return issues?.removeIssue(workspaceSlug, projectId, issueId).then(() => {
            removeRoutePeekId();
            return;
          });
        } catch (_error) {
          setToast({
            title: t("toast.error"),
            type: TOAST_TYPE.ERROR,
            message: t("entity.delete.failed", { entity: t("issue.label", { count: 1 }) }),
          });
        }
      },
      archive: async (workspaceSlug: string, projectId: string, issueId: string) => {
        try {
          if (!issues?.archiveIssue) return;
          await issues.archiveIssue(workspaceSlug, projectId, issueId);
        } catch (error) {
          console.error("Error archiving the issue", error);
        }
      },
      restore: async (workspaceSlug: string, projectId: string, issueId: string) => {
        try {
          await restoreIssue(workspaceSlug, projectId, issueId);
          setToast({
            type: TOAST_TYPE.SUCCESS,
            title: t("issue.restore.success.title"),
            message: t("issue.restore.success.message"),
          });
        } catch (_error) {
          setToast({
            type: TOAST_TYPE.ERROR,
            title: t("toast.error"),
            message: t("issue.restore.failed.message"),
          });
        }
      },
      addCycleToIssue: async (workspaceSlug: string, projectId: string, cycleId: string, issueId: string) => {
        try {
          await issues.addCycleToIssue(workspaceSlug, projectId, cycleId, issueId);
          fetchActivities(workspaceSlug, projectId, issueId);
        } catch (_error) {
          setToast({
            type: TOAST_TYPE.ERROR,
            title: t("toast.error"),
            message: t("issue.add.cycle.failed"),
          });
        }
      },
      addIssueToCycle: async (workspaceSlug: string, projectId: string, cycleId: string, issueIds: string[]) => {
        try {
          await issues.addIssueToCycle(workspaceSlug, projectId, cycleId, issueIds);
        } catch (_error) {
          setToast({
            type: TOAST_TYPE.ERROR,
            title: t("toast.error"),
            message: t("issue.add.cycle.failed"),
          });
        }
      },
      removeIssueFromCycle: async (workspaceSlug: string, projectId: string, cycleId: string, issueId: string) => {
        try {
          const removeFromCyclePromise = issues.removeIssueFromCycle(workspaceSlug, projectId, cycleId, issueId);
          setPromiseToast(removeFromCyclePromise, {
            loading: t("issue.remove.cycle.loading"),
            success: {
              title: t("toast.success"),
              message: () => t("issue.remove.cycle.success"),
            },
            error: {
              title: t("toast.error"),
              message: () => t("issue.remove.cycle.failed"),
            },
          });
          await removeFromCyclePromise;
          fetchActivities(workspaceSlug, projectId, issueId);
        } catch (error) {
          console.error("Error removing issue from cycle", error);
        }
      },
      changeModulesInIssue: async (
        workspaceSlug: string,
        projectId: string,
        issueId: string,
        addModuleIds: string[],
        removeModuleIds: string[]
      ) => {
        const promise = await issues.changeModulesInIssue(
          workspaceSlug,
          projectId,
          issueId,
          addModuleIds,
          removeModuleIds
        );
        fetchActivities(workspaceSlug, projectId, issueId);
        return promise;
      },
      removeIssueFromModule: async (workspaceSlug: string, projectId: string, moduleId: string, issueId: string) => {
        try {
          const removeFromModulePromise = issues.removeIssuesFromModule(workspaceSlug, projectId, moduleId, [issueId]);
          setPromiseToast(removeFromModulePromise, {
            loading: t("issue.remove.module.loading"),
            success: {
              title: t("toast.success"),
              message: () => t("issue.remove.module.success"),
            },
            error: {
              title: t("toast.error"),
              message: () => t("issue.remove.module.failed"),
            },
          });
          await removeFromModulePromise;
          fetchActivities(workspaceSlug, projectId, issueId);
        } catch (error) {
          console.error("Error removing issue from module", error);
        }
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetchIssue, is_draft, issues, fetchActivities, pathname, removeRoutePeekId, restoreIssue]
  );

  const { isLoading } = useSWR(
    ["peek-issue", peekIssue?.workspaceSlug, peekIssue?.projectId, peekIssue?.issueId],
    () => peekIssue && issueOperations.fetch(peekIssue.workspaceSlug, peekIssue.projectId, peekIssue.issueId),
    {
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  if (!peekIssue?.workspaceSlug || !peekIssue?.projectId || !peekIssue?.issueId) return <></>;

  // Check if issue is editable, based on user role
  const isEditable = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT,
    peekIssue?.workspaceSlug,
    peekIssue?.projectId
  );

  return (
    <IssueView
      workspaceSlug={peekIssue.workspaceSlug}
      projectId={peekIssue.projectId}
      issueId={peekIssue.issueId}
      isLoading={isLoading}
      isError={error}
      is_archived={!!peekIssue.isArchived}
      disabled={!isEditable}
      embedIssue={embedIssue}
      embedRemoveCurrentNotification={embedRemoveCurrentNotification}
      issueOperations={issueOperations}
    />
  );
});
