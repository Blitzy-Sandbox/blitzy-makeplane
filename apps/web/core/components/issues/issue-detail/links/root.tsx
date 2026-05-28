/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Top-level coordinator for the issue-detail "Links" section.
 *
 * Rendered purpose: renders a small section panel containing the "Links" header, an add-link
 * `PlusIcon` button (hidden when `disabled` is true), the shared `IssueLinkCreateUpdateModal`
 * (always mounted; visibility driven by local + store-mirrored toggle state), and the
 * `IssueLinkList` of existing links for the issue. Owns the `TLinkOperations` contract
 * (`create` / `update` / `remove`) consumed by every descendant in this folder.
 *
 * Props (`TIssueLinkRoot`, exported):
 *   - workspaceSlug (string, required): scopes all link mutations.
 *   - projectId (string, required): scopes all link mutations.
 *   - issueId (string, required): the parent work item that links are anchored to.
 *   - disabled (boolean, optional, default=false): when true, hides the add-link button and
 *     forwards `disabled` to `IssueLinkList` so each card hides its edit/delete affordances.
 *
 * MobX stores read:
 *   - `useIssueDetail()` — `createLink`, `updateLink`, `removeLink` (the mutation actions on the
 *     issue-link store), and `toggleIssueLinkModal` (the store-level modal-open flag that is
 *     mirrored into local React state for use by the modal and other open-listeners). Reads the
 *     default `ISSUES` namespace.
 *
 * Side effects (via the memoized `handleLinkOperations` contract):
 *   - `handleLinkOperations.create(data)` validates `workspaceSlug`, `projectId`, and `issueId` are
 *     all present, then calls `createLink(workspaceSlug, projectId, issueId, data)`. On success it
 *     emits a `TOAST_TYPE.SUCCESS` "Link created" toast and closes the modal; on failure it emits
 *     a `TOAST_TYPE.ERROR` toast (preferring `error.data.error` for the server-side message) and
 *     rethrows so the modal's `handleFormSubmit` can leave the form open for retry.
 *   - `handleLinkOperations.update(linkId, data)` follows the same pattern with `updateLink` and
 *     "Link updated" / "Link not updated" toasts; also rethrows on failure.
 *   - `handleLinkOperations.remove(linkId)` calls `removeLink` and emits "Link removed" /
 *     "Link not removed" toasts. UNLIKE create/update, it does NOT rethrow on failure — single-card
 *     delete buttons can recover gracefully without propagating the rejection up.
 *   - All three operations close the modal on success via `toggleIssueLinkModal(false)`. The remove
 *     path also closes the modal on success even though delete is typically initiated from outside
 *     the modal (no-op in that case).
 *   - Each link operation ultimately routes through `IssueLinkService` (POST/PATCH/DELETE) against
 *     `apps/api`'s `IssueLinkViewSet`
 *     (`/api/workspaces/<slug>/projects/<id>/issues/<issue_id>/issue-links/`).
 *
 * Modal state synchronization:
 *   - The local `isIssueLinkModal` boolean and the store's `toggleIssueLinkModalStore` flag are
 *     kept in sync by `toggleIssueLinkModal` (a `useCallback`-stable function). This dual-state
 *     pattern lets any other surface observing the store flag know when the modal is open while
 *     still letting this component render the modal locally.
 *   - `handleOnClose` (passed into the modal) calls `toggleIssueLinkModal(false)`.
 *
 * Modal service-type:
 *   - The modal is rendered with `issueServiceType={EIssueServiceType.ISSUES}` — this is hard-coded
 *     because `IssueLinkRoot` is mounted on the standard issue-detail surface, not the epic-detail
 *     surface. Epic links use a different mount point.
 */

import { useCallback, useMemo, useState } from "react";

import { PlusIcon } from "@plane/propel/icons";
// plane imports
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssueLink } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// local imports
import { IssueLinkCreateUpdateModal } from "./create-update-link-modal";
import { IssueLinkList } from "./links";

/**
 * Link-mutation contract used by every component in this folder.
 *
 * Each method is an async wrapper around the corresponding `useIssueDetail()` store action with
 * id-validation, success/error toast emission, and modal-close-on-success behavior. The `create`
 * and `update` paths rethrow on failure so callers (notably the modal's `handleFormSubmit`) can
 * keep the form open for retry; the `remove` path swallows the rejection so single-card delete
 * buttons can recover silently.
 */
export type TLinkOperations = {
  create: (data: Partial<TIssueLink>) => Promise<void>;
  update: (linkId: string, data: Partial<TIssueLink>) => Promise<void>;
  remove: (linkId: string) => Promise<void>;
};

/**
 * Public prop shape of `IssueLinkRoot`.
 */
export type TIssueLinkRoot = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled?: boolean;
};

export function IssueLinkRoot(props: TIssueLinkRoot) {
  // props
  const { workspaceSlug, projectId, issueId, disabled = false } = props;
  // hooks
  const { toggleIssueLinkModal: toggleIssueLinkModalStore, createLink, updateLink, removeLink } = useIssueDetail();
  // state
  const [isIssueLinkModal, setIsIssueLinkModal] = useState(false);
  const toggleIssueLinkModal = useCallback(
    (modalToggle: boolean) => {
      toggleIssueLinkModalStore(modalToggle);
      setIsIssueLinkModal(modalToggle);
    },
    [toggleIssueLinkModalStore]
  );

  const handleLinkOperations: TLinkOperations = useMemo(
    () => ({
      create: async (data: Partial<TIssueLink>) => {
        try {
          if (!workspaceSlug || !projectId || !issueId) throw new Error("Missing required fields");
          await createLink(workspaceSlug, projectId, issueId, data);
          setToast({
            message: "The link has been successfully created",
            type: TOAST_TYPE.SUCCESS,
            title: "Link created",
          });
          toggleIssueLinkModal(false);
        } catch (error: any) {
          setToast({
            message: error?.data?.error ?? "The link could not be created",
            type: TOAST_TYPE.ERROR,
            title: "Link not created",
          });
          throw error;
        }
      },
      update: async (linkId: string, data: Partial<TIssueLink>) => {
        try {
          if (!workspaceSlug || !projectId || !issueId) throw new Error("Missing required fields");
          await updateLink(workspaceSlug, projectId, issueId, linkId, data);
          setToast({
            message: "The link has been successfully updated",
            type: TOAST_TYPE.SUCCESS,
            title: "Link updated",
          });
          toggleIssueLinkModal(false);
        } catch (error) {
          setToast({
            message: "The link could not be updated",
            type: TOAST_TYPE.ERROR,
            title: "Link not updated",
          });
          throw error;
        }
      },
      remove: async (linkId: string) => {
        try {
          if (!workspaceSlug || !projectId || !issueId) throw new Error("Missing required fields");
          await removeLink(workspaceSlug, projectId, issueId, linkId);
          setToast({
            message: "The link has been successfully removed",
            type: TOAST_TYPE.SUCCESS,
            title: "Link removed",
          });
          toggleIssueLinkModal(false);
        } catch {
          setToast({
            message: "The link could not be removed",
            type: TOAST_TYPE.ERROR,
            title: "Link not removed",
          });
        }
      },
    }),
    [workspaceSlug, projectId, issueId, createLink, updateLink, removeLink, toggleIssueLinkModal]
  );

  const handleOnClose = () => {
    toggleIssueLinkModal(false);
  };

  return (
    <>
      <IssueLinkCreateUpdateModal
        isModalOpen={isIssueLinkModal}
        handleOnClose={handleOnClose}
        linkOperations={handleLinkOperations}
        issueServiceType={EIssueServiceType.ISSUES}
      />

      <div className="py-1 text-11">
        <div className="flex items-center justify-between gap-2">
          <h4>Links</h4>
          {!disabled && (
            <button
              type="button"
              className={`grid h-7 w-7 place-items-center rounded-sm p-1 duration-300 outline-none hover:bg-surface-2 ${
                disabled ? "cursor-not-allowed" : "cursor-pointer"
              }`}
              onClick={() => toggleIssueLinkModal(true)}
              disabled={disabled}
            >
              <PlusIcon className="h-4 w-4" />
            </button>
          )}
        </div>

        <div>
          <IssueLinkList issueId={issueId} linkOperations={handleLinkOperations} disabled={disabled} />
        </div>
      </div>
    </>
  );
}
