/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Top-level orchestrator for issue-label management in the issue detail panel.
 *
 * Rendered purpose: resolves the active work item from either the issue-detail store or the
 * inbox-issue store (depending on `isInboxIssue`), assembles a stable `labelOperations` contract
 * for downstream components (list, items, selector, inline-creation form), and renders the label
 * list unconditionally + the `IssueLabelSelectRoot` selector conditionally when not `disabled`.
 *
 * Props (TIssueLabel, exported):
 *   - workspaceSlug (string, required): scopes the update + create mutations
 *   - projectId (string, required): scopes the update + create mutations
 *   - issueId (string, required): the work item whose labels are being managed
 *   - disabled (boolean, required, default=false in destructure): when true, suppresses the
 *     selector (read-only mode) and hides per-chip remove affordances downstream
 *   - isInboxIssue (boolean, optional, default=false): switches the source of the current issue
 *     snapshot from `useIssueDetail().issue.getIssueById(...)` to
 *     `useProjectInbox().getIssueInboxByIssueId(issueId)?.issue` — needed because inbox issues
 *     have not yet been promoted to the main issues store
 *   - onLabelUpdate ((labelIds: string[]) => void, optional): when provided, replaces the default
 *     `updateIssue` mutation with this callback so the parent can persist the change itself
 *     (used by draft/staging surfaces where the issue does not yet exist server-side; this is
 *     a surface-level concept and is NOT a `TIssueServiceType` value)
 *   - issueServiceType (TIssueServiceType, optional, default=EIssueServiceType.ISSUES): one of
 *     `EIssueServiceType.ISSUES`, `EPICS`, `WORK_ITEMS` — selects which issue-detail namespace
 *     `useIssueDetail(serviceType)` returns; lets the same orchestrator drive multiple work-item
 *     surfaces
 *
 * MobX stores read:
 *   - `useIssueDetail(issueServiceType)` — `updateIssue` (mutation action) and
 *     `issue.getIssueById(issueId)` (current snapshot for non-inbox flows). `useIssueDetail` is
 *     deliberately invoked twice in this file (once with the caller-supplied service type, once
 *     with the default) so that the update action remains routed to the active service while the
 *     current-issue lookup is shared across all service types; preserve both call sites verbatim.
 *   - `useLabel()` — `createLabel` (mutation action) which delegates to `IssueLabelService.createIssueLabel`
 *   - `useProjectInbox()` — `getIssueInboxByIssueId(issueId)` (alternate snapshot source for
 *     inbox-issue flows)
 *
 * Side effects (wrapped inside the memoized `labelOperations` contract):
 *   - `labelOperations.updateIssue(workspaceSlug, projectId, issueId, data)`:
 *       - If `onLabelUpdate` is provided, calls it with `data.label_ids || []` (NO server write).
 *       - Otherwise calls `updateIssue(...)` from the issue-detail store, which routes through
 *         `IssueService.patchIssue` against the work-item `PATCH` endpoint in `apps/api`.
 *       - On failure, emits a localized error toast via `setToast({ type: TOAST_TYPE.ERROR, ... })`
 *         with the i18n key `entity.update.failed`. The error is caught here so an isolated
 *         label-update failure surfaces as a toast instead of an uncaught promise rejection that
 *         would unmount the issue panel.
 *   - `labelOperations.createLabel(workspaceSlug, projectId, data)`:
 *       - Calls `createLabel(...)` from the label store, which routes through
 *         `IssueLabelService.createIssueLabel` (`POST /api/workspaces/<slug>/projects/<id>/issue-labels/`).
 *       - On success (only when NOT `isInboxIssue`), emits a localized success toast with the i18n
 *         key `label.create.success`. The success toast is suppressed for inbox flows because the
 *         label-create UX there is part of a larger draft-creation flow that emits its own toast.
 *       - On failure, emits an error toast and RE-THROWS the error so the caller (the inline
 *         label-creation form in `./create-label.tsx`) can detect the failure and avoid appending
 *         a missing label id to the issue's `label_ids`.
 *       - The error message defaults to `label.create.failed` and is upgraded to
 *         `label.create.already_exists` when the API returns the literal error string
 *         "Label with the same name already exists in the project". This string-matching is
 *         fragile but is the only signal available from the current API — do NOT refactor.
 *
 * i18n:
 *   - All toast titles and messages are resolved via `useTranslation()` from `@plane/i18n`.
 *
 * Imperative DOM / derived state notes:
 *   - `labelOperations` is memoized via `useMemo(..., [updateIssue, createLabel, onLabelUpdate])`
 *     so the contract reference is stable across renders. The dependency array deliberately
 *     OMITS `t` and `isInboxIssue` even though both are read inside the memoized callbacks.
 *     // INTENT UNCLEAR: changing language or inbox-mode mid-edit will not invalidate the
 *     // contract reference; preserve the dependency array verbatim until a behavioral
 *     // requirement justifies altering it.
 *   - `issue = isInboxIssue ? getIssueInboxByIssueId(issueId)?.issue : getIssueById(issueId)` is the
 *     single source of truth for the rendered `label_ids`. When `issue` is undefined, `label_ids`
 *     defaults to `[]` so downstream components render the empty state cleanly.
 *
 * Pre-existing architectural note:
 *   - The pre-existing single-line note above the `LabelList` / `IssueLabelSelectRoot` import
 *     flags that core code should not import from the enterprise-edition surface. The AAP
 *     forbids refactoring; preserve that comment verbatim and do NOT attempt to resolve it
 *     as part of this documentation pass.
 *
 * Consumers:
 *   - `apps/web/core/components/issues/issue-detail/sidebar.tsx`
 *   - Peek-overview properties panel under `apps/web/core/components/issues/peek-overview/`
 *   - Inbox-issue detail surface under `apps/web/core/components/inbox/`
 */
import { useMemo } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IIssueLabel, TIssue, TIssueServiceType } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// components
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useLabel } from "@/hooks/store/use-label";
import { useProjectInbox } from "@/hooks/store/use-project-inbox";
// ui
// types
import { LabelList, IssueLabelSelectRoot } from "./";
// TODO: Fix this import statement, as core should not import from ee

/**
 * Public props contract for the `IssueLabel` orchestrator.
 *
 * Consumed by `apps/web/core/components/issues/issue-detail/sidebar.tsx` (and other surfaces that
 * mount the label feature, including the peek-overview properties panel and the inbox-issue detail).
 *
 * The `onLabelUpdate` callback is the escape hatch for surfaces that own their own persistence
 * (e.g., draft issues that have not been saved to `apps/api` yet); when provided, the orchestrator
 * skips the server-side update and instead invokes this callback with the new `label_ids` array.
 *
 * `issueServiceType` is one of the `EIssueServiceType` values (`ISSUES` / `EPICS` / `WORK_ITEMS`) —
 * it selects which issue-detail namespace the orchestrator binds to so the same surface can drive
 * standard issues and epics through their respective backend routes.
 */
export type TIssueLabel = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled: boolean;
  isInboxIssue?: boolean;
  onLabelUpdate?: (labelIds: string[]) => void;
  issueServiceType?: TIssueServiceType;
};

/**
 * Stable label-mutation contract passed down to every component in the label subtree.
 *
 * Consumers (`./label-list.tsx`, `./label-list-item.tsx`, `./create-label.tsx`,
 * `./select/root.tsx`, `./select/label-select.tsx`) call these two methods to persist label
 * additions, removals, and new-label creations without re-resolving issue-detail context. The
 * orchestrator memoizes the contract object so the reference is stable across re-renders.
 *
 *   - `updateIssue(workspaceSlug, projectId, issueId, data)` — patches the work item's editable
 *     fields (in practice, always `label_ids`); routes to `IssueService.patchIssue` unless an
 *     `onLabelUpdate` override is in effect.
 *   - `createLabel(workspaceSlug, projectId, data)` — creates a new project label; routes through
 *     the label store to `IssueLabelService.createIssueLabel`
 *     (`POST /api/workspaces/<slug>/projects/<id>/issue-labels/`). Returns the created label
 *     payload so callers can append the new label id to the issue's `label_ids`.
 */
export type TLabelOperations = {
  updateIssue: (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssue>) => Promise<void>;
  createLabel: (workspaceSlug: string, projectId: string, data: Partial<IIssueLabel>) => Promise<any>;
};

export const IssueLabel = observer(function IssueLabel(props: TIssueLabel) {
  const {
    workspaceSlug,
    projectId,
    issueId,
    disabled = false,
    isInboxIssue = false,
    onLabelUpdate,
    issueServiceType = EIssueServiceType.ISSUES,
  } = props;
  const { t } = useTranslation();
  // hooks
  const { updateIssue } = useIssueDetail(issueServiceType);
  const { createLabel } = useLabel();
  const {
    issue: { getIssueById },
  } = useIssueDetail(issueServiceType);
  const { getIssueInboxByIssueId } = useProjectInbox();

  const issue = isInboxIssue ? getIssueInboxByIssueId(issueId)?.issue : getIssueById(issueId);

  const labelOperations: TLabelOperations = useMemo(
    () => ({
      updateIssue: async (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssue>) => {
        try {
          if (onLabelUpdate) onLabelUpdate(data.label_ids || []);
          else await updateIssue(workspaceSlug, projectId, issueId, data);
        } catch (_error) {
          setToast({
            title: t("toast.error"),
            type: TOAST_TYPE.ERROR,
            message: t("entity.update.failed", { entity: t("issue.label", { count: 1 }) }),
          });
        }
      },
      createLabel: async (workspaceSlug: string, projectId: string, data: Partial<IIssueLabel>) => {
        try {
          const labelResponse = await createLabel(workspaceSlug, projectId, data);
          if (!isInboxIssue)
            setToast({
              title: t("toast.success"),
              type: TOAST_TYPE.SUCCESS,
              message: t("label.create.success"),
            });
          return labelResponse;
        } catch (error) {
          let errMessage = t("label.create.failed");
          if (error && (error as any).error === "Label with the same name already exists in the project")
            errMessage = t("label.create.already_exists");

          setToast({
            title: t("toast.error"),
            type: TOAST_TYPE.ERROR,
            message: errMessage,
          });
          throw error;
        }
      },
    }),
    [updateIssue, createLabel, onLabelUpdate]
  );

  return (
    <div className="relative flex min-h-7.5 w-full flex-wrap items-center gap-1 px-2">
      <LabelList
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        issueId={issueId}
        values={issue?.label_ids || []}
        labelOperations={labelOperations}
        disabled={disabled}
      />

      {!disabled && (
        <IssueLabelSelectRoot
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issueId}
          values={issue?.label_ids || []}
          labelOperations={labelOperations}
        />
      )}
    </div>
  );
});
