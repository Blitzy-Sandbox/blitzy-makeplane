/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Container that renders the chips for every label currently assigned to a work item.
 *
 * Rendered purpose: maps `values` (the work item's `label_ids`) to one `LabelListItem` per id and
 * forwards the shared mutation contract so each chip can remove its label without re-resolving
 * issue context. Guards against missing issue context or missing label values by short-circuiting
 * to an empty fragment.
 *
 * Props (TLabelList, file-local type):
 *   - workspaceSlug (string, required): scopes the removal mutation in each child item
 *   - projectId (string, required): scopes the removal mutation
 *   - issueId (string, required): the work item whose labels are being listed
 *   - values (string[], required): the current `label_ids` array; each id renders one chip
 *   - labelOperations (TLabelOperations from `./root`, required): the label-mutation contract —
 *     here, only `updateIssue` is reached transitively via the child item's remove handler
 *   - disabled (boolean, required): when true, child chips render without the remove `X` affordance
 *
 * MobX stores read: none directly — this component is purely structural. Label metadata is
 * resolved per-item inside `LabelListItem` via `useLabel().getLabelById(labelId)`. The `observer`
 * wrapping is preserved because removal in a child triggers a parent re-render via the upstream
 * `label_ids` observable held by `useIssueDetail()` in `./root`.
 *
 * Side effects: none directly — all persistence happens inside `LabelListItem` via
 * `labelOperations.updateIssue(...)` against `apps/api`'s `IssueViewSet` (PATCH `label_ids`).
 *
 * Derived state notes:
 *   - `issueLabels = values || undefined` normalizes a falsy `values` to `undefined` so the early
 *     return covers both "no value" and "empty array" cases (the empty-array case still renders
 *     an empty fragment from the `.map`; the early return suppresses the wrapping fragment when
 *     the `values` prop itself is missing).
 *   - Returns `<></>` early when `issueId` is missing OR `issueLabels` is undefined.
 */

import { observer } from "mobx-react";
// components
import { LabelListItem } from "./label-list-item";
// types
import type { TLabelOperations } from "./root";

type TLabelList = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  values: string[];
  labelOperations: TLabelOperations;
  disabled: boolean;
};

export const LabelList = observer(function LabelList(props: TLabelList) {
  const { workspaceSlug, projectId, issueId, values, labelOperations, disabled } = props;
  const issueLabels = values || undefined;

  if (!issueId || !issueLabels) return <></>;
  return (
    <>
      {issueLabels.map((labelId) => (
        <LabelListItem
          key={labelId}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issueId}
          labelId={labelId}
          values={issueLabels}
          labelOperations={labelOperations}
          disabled={disabled}
        />
      ))}
    </>
  );
});
