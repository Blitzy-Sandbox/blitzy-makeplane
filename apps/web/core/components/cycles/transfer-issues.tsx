/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Static notice strip shown on completed cycles informing the user that the cycle
 * is read-only, optionally exposing a "Transfer work items" button that delegates
 * to the caller's handler when transfer is permitted.
 *
 * Props:
 *   - handleClick (() => void, required): callback invoked when the user clicks the
 *     transfer button; the caller typically opens a TransferIssuesModal.
 *   - canTransferIssues (boolean, optional, default=false): when true, renders the
 *     transfer button alongside the notice; when false, only the notice is shown.
 *   - disabled (boolean, optional, default=false): forwarded to the Button to disable
 *     the action while a transfer is in flight or the user lacks permission.
 *
 * MobX stores read: NONE — this is a pure presentational component with no store
 * subscriptions.
 *
 * Side effects: NONE directly — the parent owns the click behavior and any resulting
 * navigation, API call, or store mutation.
 *
 * Consumers: rendered above the work items panel for completed cycles in the cycle
 * detail / peek experiences.
 */
import React from "react";
import { AlertCircle } from "lucide-react";
// ui
import { Button } from "@plane/propel/button";
import { TransferIcon } from "@plane/propel/icons";

type Props = {
  handleClick: () => void;
  canTransferIssues?: boolean;
  disabled?: boolean;
};

export function TransferIssues(props: Props) {
  const { handleClick, canTransferIssues = false, disabled = false } = props;
  return (
    <div className="-mt-2 mb-4 flex items-center justify-between px-4 pt-6">
      <div className="flex items-center gap-2 text-13 text-secondary">
        <AlertCircle className="h-3.5 w-3.5 text-secondary" />
        <span>Completed cycles are not editable.</span>
      </div>

      {canTransferIssues && (
        <div>
          <Button variant="primary" size="lg" prependIcon={<TransferIcon />} onClick={handleClick} disabled={disabled}>
            Transfer work items
          </Button>
        </div>
      )}
    </div>
  );
}
