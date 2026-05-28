/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Single label chip rendered inside the issue-detail label list.
 *
 * Rendered purpose: a `Button` (variant `tertiary`, size `sm`) containing a colored
 * `LabelFilledIcon`, the label's name, and a `CloseIcon` remove affordance (only when not
 * disabled). Clicking the chip removes the label from the work item's `label_ids` and persists
 * the update.
 *
 * Props (TLabelListItem, file-local type):
 *   - workspaceSlug (string, required): scopes the removal mutation
 *   - projectId (string, required): scopes the removal mutation
 *   - issueId (string, required): the work item this chip belongs to
 *   - labelId (string, required): the label id this chip represents; resolved against the label
 *     store to obtain name/color
 *   - values (string[], required): the work item's current `label_ids`; the chip's remove handler
 *     filters this id out and passes the result back through the mutation contract
 *   - labelOperations (TLabelOperations from `./root`, required): provides `updateIssue(...)`,
 *     which routes to `IssueService.patchIssue` against `apps/api`
 *   - disabled (boolean, required): when true, suppresses both the remove `X` affordance and the
 *     click handler (the `<Button disabled>` attribute also prevents pointer events)
 *
 * MobX stores read:
 *   - `useLabel()` — `getLabelById(labelId)` resolves the label snapshot ({ id, name, color, ... })
 *     for rendering; the `observer` wrap re-renders this chip when label metadata changes (rename,
 *     recolor) via the label store's observables.
 *
 * Side effects:
 *   - `labelOperations.updateIssue(workspaceSlug, projectId, issueId, { label_ids: currentLabels })`
 *     where `currentLabels = values.filter(_labelId => _labelId !== labelId)` — persists the
 *     removed label via the centralized issue-update contract. Toast emissions are handled inside
 *     the contract in `./root.tsx`.
 *
 * Derived state notes:
 *   - `label = getLabelById(labelId)` returns `undefined` when the label is no longer in the store
 *     (deleted in another tab, or never fetched). Returning `<></>` early in that case prevents
 *     rendering a broken chip with no name/color — the silently dropped row is intentional and
 *     matches the upstream `LabelList` contract that may pass stale ids during reconciliation.
 *   - The chip color falls back to `"#000000"` (black) when `label.color` is nullish; this is
 *     defensive only — labels should always carry a non-null color from `apps/api`.
 *
 * Accessibility notes:
 *   - The `Button` primitive from `@plane/propel/button` provides native button semantics
 *     (`role="button"`, Enter/Space activation, focus ring).
 *   - The `CloseIcon` is a child of the same `Button`, so the entire chip is one clickable region
 *     — there is NO separate close button. Clicking ANY part of the chip (icon, name, or X)
 *     triggers `handleLabel`.
 *   - When `disabled`, the close affordance is omitted and `Button` renders with its disabled styling.
 */

import { observer } from "mobx-react";
import { Button } from "@plane/propel/button";
import { CloseIcon, LabelFilledIcon } from "@plane/propel/icons";
// types
import { useLabel } from "@/hooks/store/use-label";
import type { TLabelOperations } from "./root";

type TLabelListItem = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  labelId: string;
  values: string[];
  labelOperations: TLabelOperations;
  disabled: boolean;
};

export const LabelListItem = observer(function LabelListItem(props: TLabelListItem) {
  const { workspaceSlug, projectId, issueId, labelId, values, labelOperations, disabled } = props;
  // hooks
  const { getLabelById } = useLabel();

  const label = getLabelById(labelId);

  const handleLabel = async () => {
    if (values && !disabled) {
      const currentLabels = values.filter((_labelId) => _labelId !== labelId);
      await labelOperations.updateIssue(workspaceSlug, projectId, issueId, { label_ids: currentLabels });
    }
  };

  if (!label) return <></>;
  return (
    <Button variant="tertiary" size="sm" key={labelId} onClick={handleLabel} disabled={disabled}>
      <LabelFilledIcon className="size-3" color={label.color ?? "#000000"} />
      <span className="text-body-xs-regular">{label.name}</span>
      {!disabled && <CloseIcon className="h-2.5 w-2.5 transition-all group-hover:text-danger-primary" />}
    </Button>
  );
});
