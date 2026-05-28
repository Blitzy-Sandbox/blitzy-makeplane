/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Confirmation modal for discarding or saving a work item draft.
 *
 * Rendered purpose: a `ModalCore` (top-anchored, XXL width) that asks the user whether to save the
 * current in-progress work item as a draft; presents three actions — Discard, Cancel, Save to Drafts.
 *
 * Props:
 *   - isOpen (boolean, required): modal open state
 *   - handleClose (() => void, required): close-modal callback
 *   - onDiscard (() => void, required): invoked when the user clicks "Discard" (parent typically closes the
 *     issue create/edit flow and drops the in-memory form)
 *   - onConfirm (() => Promise<void>, required): invoked when the user clicks "Save to Drafts"; this component
 *     awaits its resolution and toggles its local `isLoading` indicator
 *
 * MobX stores read: none — this is a pure UI primitive that delegates persistence to the parent.
 *
 * Side effects:
 *   - Awaits `onConfirm()` and toggles local loading state.
 *   - No toasts, no service calls, no navigations.
 *
 * Derived state notes:
 *   - `onClose` wraps `handleClose` plus a `setIsLoading(false)` reset so re-opening the modal starts clean.
 *   - The Save button surfaces "Saving" copy while `isLoading` is true (handled inline in JSX).
 */

import { useState } from "react";
// ui
import { Button } from "@plane/propel/button";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";

type Props = {
  isOpen: boolean;
  handleClose: () => void;
  onDiscard: () => void;
  onConfirm: () => Promise<void>;
};

export function ConfirmIssueDiscard(props: Props) {
  const { isOpen, handleClose, onDiscard, onConfirm } = props;

  const [isLoading, setIsLoading] = useState(false);

  const onClose = () => {
    handleClose();
    setIsLoading(false);
  };

  const handleDeletion = async () => {
    setIsLoading(true);
    await onConfirm();
    setIsLoading(false);
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={handleClose} position={EModalPosition.TOP} width={EModalWidth.XXL}>
      <div className="px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
        <div className="sm:flex sm:items-start">
          <div className="mt-3 text-center sm:mt-0 sm:text-left">
            <h3 className="text-16 leading-6 font-medium text-primary">Save this draft?</h3>
            <div className="mt-2">
              <p className="text-13 text-secondary">
                You can save this work item to Drafts so you can come back to it later.{" "}
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="flex justify-between gap-2 p-4 sm:px-6">
        <div>
          <Button variant="secondary" onClick={onDiscard}>
            Discard
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleDeletion} loading={isLoading}>
            {isLoading ? "Saving" : "Save to Drafts"}
          </Button>
        </div>
      </div>
    </ModalCore>
  );
}
