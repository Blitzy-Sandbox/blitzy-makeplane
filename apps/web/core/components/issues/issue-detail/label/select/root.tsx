/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue-context adapter that wires the generic `IssueLabelSelect` combobox to a specific
 * issue's label-mutation contract.
 *
 * Purpose:
 *   Binds `labelOperations.updateIssue` to the picker's `onSelect` callback (via the
 *   inline `handleLabel` closure) and forwards `labelOperations.createLabel` directly
 *   to `IssueLabelSelect`'s `onAddLabel` prop. Acts as the seam between the
 *   issue-context-aware `TLabelOperations` contract (constructed upstream in
 *   `apps/web/core/components/issues/issue-detail/label/root.tsx`) and the
 *   issue-context-agnostic `IssueLabelSelect` picker — keeping the picker reusable
 *   in non-issue surfaces (bulk-edit, draft issues) without coupling it to
 *   issue-detail mutation specifics.
 *
 * Props (see {@link TIssueLabelSelectRoot}):
 *   - `workspaceSlug` (string, required) — scopes persistence writes to the active workspace.
 *   - `projectId` (string, required) — scopes persistence writes to the active project.
 *   - `issueId` (string, required) — the work item whose `label_ids` field is being mutated.
 *   - `values` (string[], required) — currently selected `label_ids`, forwarded as the
 *     picker's initial selection.
 *   - `labelOperations` (TLabelOperations from `../root`, required) — the issue-detail
 *     mutation contract exposing `updateIssue` and `createLabel`.
 *
 * MobX stores read:
 *   None directly. The wrapper owns zero observables and is intentionally NOT
 *   `observer`-wrapped; the inner `IssueLabelSelect` is `observer`-wrapped at its own
 *   definition site for the label-store reactivity it requires.
 *
 * Side effects:
 *   - `handleLabel(_labelIds)` calls `labelOperations.updateIssue` with the bound
 *     `(workspaceSlug, projectId, issueId)` triplet and `{ label_ids: _labelIds }`;
 *     this mutation reaches `apps/api`'s `IssueViewSet.partial_update` through
 *     `useIssueDetail().updateIssue` inside `labelOperations`.
 *   - `labelOperations.createLabel` is forwarded directly to `onAddLabel` (no wrapping)
 *     because the picker already supplies the `(workspaceSlug, projectId, data)`
 *     positional arguments matching the contract signature; the new label persists to
 *     `apps/api`'s `LabelViewSet.create` through `useLabel().createLabel`.
 *   - Toast notifications (success and failure) for both operations are emitted
 *     UPSTREAM by `labelOperations` in `../root.tsx`; this wrapper does NOT emit toasts.
 *
 * Consumers:
 *   - `IssueLabel` in `apps/web/core/components/issues/issue-detail/label/root.tsx`,
 *     which mounts this wrapper when the issue is not disabled.
 */

// components
import type { TLabelOperations } from "../root";
import { IssueLabelSelect } from "./label-select";
// types

/**
 * Props for {@link IssueLabelSelectRoot}; binds the active workspace / project / issue
 * context to the upstream `TLabelOperations` mutation contract and the initial `values`
 * selection forwarded to `IssueLabelSelect`.
 */
type TIssueLabelSelectRoot = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  values: string[];
  labelOperations: TLabelOperations;
};

/**
 * Issue-context adapter for the generic `IssueLabelSelect` picker — see the module-level
 * JSDoc above for the full purpose, MobX-store, and side-effect contract.
 *
 * @param props - See {@link TIssueLabelSelectRoot}.
 * @returns A configured `IssueLabelSelect` whose `onSelect` persists `label_ids` via
 *   `labelOperations.updateIssue` and whose `onAddLabel` forwards
 *   `labelOperations.createLabel` directly.
 */
export function IssueLabelSelectRoot(props: TIssueLabelSelectRoot) {
  const { workspaceSlug, projectId, issueId, values, labelOperations } = props;

  const handleLabel = async (_labelIds: string[]) => {
    await labelOperations.updateIssue(workspaceSlug, projectId, issueId, { label_ids: _labelIds });
  };

  return (
    <IssueLabelSelect
      workspaceSlug={workspaceSlug}
      projectId={projectId}
      issueId={issueId}
      values={values}
      onSelect={handleLabel}
      onAddLabel={labelOperations.createLabel}
    />
  );
}
