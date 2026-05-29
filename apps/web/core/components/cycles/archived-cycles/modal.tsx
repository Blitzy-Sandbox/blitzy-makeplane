/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Confirmation modal that archives a single cycle on confirm; calls the cycle store's
 * archive action wired to `CycleArchiveService`, surfaces success/error toasts, and
 * redirects the user back to the project cycles list after a successful archive.
 *
 * Props:
 *   - workspaceSlug (string, required): workspace slug used for the archive API call
 *     and post-archive navigation target.
 *   - projectId (string, required): project ID used for the archive API call and
 *     post-archive navigation target.
 *   - cycleId (string, required): ID of the cycle being archived; also used to look
 *     up the cycle's display name for the confirmation copy.
 *   - isOpen (boolean, required): controls `ModalCore` visibility.
 *   - handleClose (() => void, required): closes the modal; invoked on Cancel,
 *     before navigation on success, and (via `onClose`) clears local `isArchiving`
 *     state before delegating to the caller.
 *   - onSubmit (() => Promise<void>, optional): present in the type for API
 *     symmetry with sibling modals but NOT invoked by this component — the archive
 *     flow is entirely self-contained via the store action.
 *
 * MobX stores read:
 *   - useCycle (cycle store): `getCycleNameById(cycleId)` for the confirmation copy
 *     and the `archiveCycle` action.
 *
 * Side effects:
 *   - API call (via store action wired to `CycleArchiveService`):
 *     `archiveCycle(workspaceSlug, projectId, cycleId)` invoked from `handleArchiveCycle`.
 *   - Toasts (`@plane/propel/toast`):
 *       - SUCCESS toast with hard-coded "Archive success" / "Your archives can be
 *         found in project archives." copy on archive success.
 *       - ERROR toast with hard-coded "Error!" / "Cycle could not be archived.
 *         Please try again." copy on archive failure.
 *   - Navigation: `useAppRouter().push(`/${workspaceSlug}/projects/${projectId}/cycles`)`
 *     after a successful archive — unconditional redirect regardless of where the
 *     user was when they triggered the action.
 *   - Local state: `isArchiving` boolean flag toggled around the async call to drive
 *     the submit button's `loading` prop and label ("Archiving" vs. "Archive").
 *
 * Consumers: rendered from `CycleQuickActions`
 * (`apps/web/core/components/cycles/quick-actions.tsx`) when the user picks
 * the "Archive" overflow action on a cycle row.
 */
import { useState } from "react";
// ui
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
// hooks
import { useCycle } from "@/hooks/store/use-cycle";
import { useAppRouter } from "@/hooks/use-app-router";

type Props = {
  workspaceSlug: string;
  projectId: string;
  cycleId: string;
  handleClose: () => void;
  isOpen: boolean;
  onSubmit?: () => Promise<void>;
};

export function ArchiveCycleModal(props: Props) {
  const { workspaceSlug, projectId, cycleId, isOpen, handleClose } = props;
  // router
  const router = useAppRouter();
  // states
  const [isArchiving, setIsArchiving] = useState(false);
  // store hooks
  const { getCycleNameById, archiveCycle } = useCycle();

  const cycleName = getCycleNameById(cycleId);

  const onClose = () => {
    setIsArchiving(false);
    handleClose();
  };

  const handleArchiveCycle = async () => {
    setIsArchiving(true);
    await archiveCycle(workspaceSlug, projectId, cycleId)
      .then(() => {
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: "Archive success",
          message: "Your archives can be found in project archives.",
        });
        onClose();
        router.push(`/${workspaceSlug}/projects/${projectId}/cycles`);
        return;
      })
      .catch(() => {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: "Error!",
          message: "Cycle could not be archived. Please try again.",
        });
      })
      .finally(() => setIsArchiving(false));
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.CENTER} width={EModalWidth.LG}>
      <div className="px-5 py-4">
        <h3 className="text-18 font-medium 2xl:text-20">Archive cycle {cycleName}</h3>
        <p className="mt-3 text-13 text-secondary">
          Are you sure you want to archive the cycle? All your archives can be restored later.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="lg" tabIndex={1} onClick={handleArchiveCycle} loading={isArchiving}>
            {isArchiving ? "Archiving" : "Archive"}
          </Button>
        </div>
      </div>
    </ModalCore>
  );
}
