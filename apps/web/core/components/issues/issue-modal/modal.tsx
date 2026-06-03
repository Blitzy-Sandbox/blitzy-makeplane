/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Route-aware entry point for the create/update work item modal.
 *
 * Rendered purpose: thin wrapper that reads the active `cycleId` / `moduleId` from the router,
 * pre-seeds the work item payload with those defaults, mounts the `IssueModalProvider` (template +
 * preload + allowed project context), and renders `CreateUpdateIssueModalBase` inside it. Returns `null`
 * when `isOpen` is false to avoid mounting the provider tree unnecessarily.
 *
 * Props (`IssuesModalProps`, exported):
 *   - data (Partial<TIssue>, optional): pre-resolved or partially-known work item payload (used both for
 *     editing existing items and for seeding create flows)
 *   - isOpen (boolean, required): gates rendering of the entire modal subtree
 *   - onClose (() => void, required): close-modal callback propagated to the base modal
 *   - beforeFormSubmit (() => Promise<void>, optional): caller-supplied hook run before create/update
 *   - onSubmit ((res: TIssue) => Promise<void>, optional): caller-supplied post-submit callback
 *   - withDraftIssueWrapper (boolean, optional, default=true in base): whether to wrap the form in the
 *     draft-discard layout (set false to bypass the draft confirm flow)
 *   - storeType (EIssuesStoreType, optional): explicit issues-store binding; falls back to `useIssueStoreType()`
 *     inside the base orchestrator
 *   - isDraft (boolean, optional, default=false in base): when true, persists through the workspace draft store
 *   - fetchIssueDetails (boolean, optional, default=true in base): controls whether the base fetches a fresh
 *     `description_html` from the issue-detail store on open
 *   - moveToIssue (boolean, optional, default=false in base): enables the draft-to-project move flow
 *   - modalTitle (string, optional): overrides the default localized modal title
 *   - primaryButtonText ({ default: string, loading: string }, optional): overrides the default submit-button copy
 *   - isProjectSelectionDisabled (boolean, optional, default=false in base): locks the project select to the
 *     supplied default
 *   - templateId (string, optional): forwarded to `IssueModalProvider` for template application
 *   - allowedProjectIds (string[], optional): forwarded to `IssueModalProvider`; restricts the project select
 *     options shown in the form
 *   - showActionItemsOnUpdate (boolean, optional, default=false in base): when true, the update-success toast
 *     surfaces `CreateIssueToastActionItems` (view link + copy link)
 *
 * MobX stores read: none directly. Router params come from `useParams()` — imported from
 * `next/navigation`, which Vite aliases to the in-repo React Router compatibility shim at
 * `apps/web/app/compat/next/navigation.ts`; this resolves to React Router's `useParams`. All MobX
 * store access happens inside `CreateUpdateIssueModalBase` and `IssueModalProvider`.
 *
 * Side effects:
 *   - Constructs the `dataForPreload` snapshot that pre-populates `cycle_id` / `module_ids` from the active
 *     route (only when the caller did not supply them explicitly).
 *   - Mounts the provider tree (`IssueModalProvider`) which in turn injects the work item modal context used by
 *     descendants such as `form.tsx`, `components/default-properties.tsx`, etc.
 *   - No service calls, no toasts, no navigations.
 *
 * Architectural notes:
 *   - MobX is the source of truth for component behavior; this entry point itself reads no MobX stores but
 *     mounts a provider whose descendants do.
 *   - `IssueModalProvider` lives under `@/plane-web/components/issues/issue-modal/provider`; the EE/CE split
 *     allows the provider implementation to vary per build.
 */

import React from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import type { EIssuesStoreType, TIssue } from "@plane/types";
// plane web imports
import { IssueModalProvider } from "@/plane-web/components/issues/issue-modal/provider";
import { CreateUpdateIssueModalBase } from "./base";

export interface IssuesModalProps {
  data?: Partial<TIssue>;
  isOpen: boolean;
  onClose: () => void;
  beforeFormSubmit?: () => Promise<void>;
  onSubmit?: (res: TIssue) => Promise<void>;
  withDraftIssueWrapper?: boolean;
  storeType?: EIssuesStoreType;
  isDraft?: boolean;
  fetchIssueDetails?: boolean;
  moveToIssue?: boolean;
  modalTitle?: string;
  primaryButtonText?: {
    default: string;
    loading: string;
  };
  isProjectSelectionDisabled?: boolean;
  templateId?: string;
  allowedProjectIds?: string[];
  showActionItemsOnUpdate?: boolean;
}

export const CreateUpdateIssueModal = observer(function CreateUpdateIssueModal(props: IssuesModalProps) {
  // router params
  const { cycleId, moduleId } = useParams();
  // derived values
  const dataForPreload = {
    ...props.data,
    cycle_id: props.data?.cycle_id ? props.data?.cycle_id : cycleId ? cycleId.toString() : null,
    module_ids: props.data?.module_ids ? props.data?.module_ids : moduleId ? [moduleId.toString()] : null,
  };

  if (!props.isOpen) return null;
  return (
    <IssueModalProvider
      templateId={props.templateId}
      dataForPreload={dataForPreload}
      allowedProjectIds={props.allowedProjectIds}
    >
      <CreateUpdateIssueModalBase {...props} />
    </IssueModalProvider>
  );
});
