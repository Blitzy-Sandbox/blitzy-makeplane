/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Destructive confirmation dialog for permanently deleting a cycle; on confirm,
 * invokes the cycle store's delete action, redirects away from a cycle detail or
 * peek route if currently scoped to the deleted cycle, and surfaces an i18n
 * success or permission-aware error toast.
 *
 * Props (ICycleDelete):
 *   - cycle (ICycle, required): the cycle being deleted; its `id` is used for the
 *     delete call and `name` is shown in the confirmation copy.
 *   - isOpen (boolean, required): controls AlertModalCore visibility.
 *   - handleClose (() => void, required): closes the modal; called after success or
 *     failure in the .finally block.
 *   - workspaceSlug (string, required): workspace slug for the delete API call and
 *     post-delete navigation.
 *   - projectId (string, required): project ID for the delete API call and post-delete
 *     navigation.
 *
 * MobX stores read:
 *   - useCycle (cycle store): deleteCycle action.
 *
 * Side effects:
 *   - API call (via store action wired to CycleService): deleteCycle(workspaceSlug,
 *     projectId, cycle.id).
 *   - Navigation (conditional): useAppRouter().push to
 *     `/${workspaceSlug}/projects/${projectId}/cycles` ONLY when the current route
 *     has a `cycleId` param OR a `peekCycle` search param — i.e., the user was
 *     viewing the deleted cycle and must be redirected to the list.
 *   - Toasts: TOAST_TYPE.SUCCESS on delete; TOAST_TYPE.ERROR with two variants —
 *     `PROJECT_ERROR_MESSAGES.permissionError` when the API returns the specific
 *     permission-denied message, otherwise `PROJECT_ERROR_MESSAGES.cycleDeleteError`.
 *   - Route param reads: useParams().cycleId, useSearchParams().get("peekCycle") to
 *     decide whether to redirect.
 *
 * Consumers: rendered from the cycle quick-actions menu (quick-actions.tsx) and the
 * cycle detail header.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useParams, useSearchParams } from "next/navigation";
// types
import { PROJECT_ERROR_MESSAGES } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { ICycle } from "@plane/types";
// ui
import { AlertModalCore } from "@plane/ui";
// hooks
import { useCycle } from "@/hooks/store/use-cycle";
import { useAppRouter } from "@/hooks/use-app-router";

interface ICycleDelete {
  cycle: ICycle;
  isOpen: boolean;
  handleClose: () => void;
  workspaceSlug: string;
  projectId: string;
}

export const CycleDeleteModal = observer(function CycleDeleteModal(props: ICycleDelete) {
  const { isOpen, handleClose, cycle, workspaceSlug, projectId } = props;
  // states
  const [loader, setLoader] = useState(false);
  // store hooks
  const { deleteCycle } = useCycle();
  const { t } = useTranslation();
  // router
  const router = useAppRouter();
  const { cycleId } = useParams();
  const searchParams = useSearchParams();
  const peekCycle = searchParams.get("peekCycle");

  const formSubmit = async () => {
    if (!cycle) return;

    setLoader(true);
    try {
      await deleteCycle(workspaceSlug, projectId, cycle.id)
        .then(() => {
          if (cycleId || peekCycle) router.push(`/${workspaceSlug}/projects/${projectId}/cycles`);
          setToast({
            type: TOAST_TYPE.SUCCESS,
            title: "Success!",
            message: "Cycle deleted successfully.",
          });
        })
        .catch((errors) => {
          const isPermissionError = errors?.error === "You don't have the required permissions.";
          const currentError = isPermissionError
            ? PROJECT_ERROR_MESSAGES.permissionError
            : PROJECT_ERROR_MESSAGES.cycleDeleteError;
          setToast({
            title: t(currentError.i18n_title),
            type: TOAST_TYPE.ERROR,
            message: currentError.i18n_message && t(currentError.i18n_message),
          });
        })
        .finally(() => handleClose());
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Warning!",
        message: "Something went wrong please try again later.",
      });
    }

    setLoader(false);
  };

  return (
    <AlertModalCore
      handleClose={handleClose}
      handleSubmit={formSubmit}
      isSubmitting={loader}
      isOpen={isOpen}
      title="Delete cycle"
      content={
        <>
          Are you sure you want to delete cycle{' "'}
          <span className="font-medium break-words text-primary">{cycle?.name}</span>
          {'"'}? All of the data related to the cycle will be permanently removed. This action cannot be undone.
        </>
      }
    />
  );
});
