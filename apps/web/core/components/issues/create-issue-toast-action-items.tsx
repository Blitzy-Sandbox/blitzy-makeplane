/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Toast follow-up actions that surface after a work item is created.
 *
 * Rendered purpose: a small inline row inside an open toast that exposes an external "View work item" / "View epic"
 * link plus a "Copy link" button with transient "Copied!" feedback (3000ms timeout).
 *
 * Props (TCreateIssueToastActionItems):
 *   - workspaceSlug (string, required): used to construct the work item URL via `generateWorkItemLink`
 *   - projectId (string, required): part of the toast contract (note: the resolved `issue.project_id` is what feeds
 *     the URL builder, since the issue payload is fetched from the store)
 *   - issueId (string, required): looked up via `getIssueById(issueId)` to resolve project identifier + sequence id
 *   - isEpic (boolean, optional, default=false): switches both the link copy ("epic" vs "work item") and the
 *     URL builder's `isEpic` flag
 *
 * MobX stores read:
 *   - `useIssueDetail()` — `issue.getIssueById(issueId)` to resolve the created issue
 *   - `useProject()` — `getProjectIdentifierById(issue.project_id)` for URL composition
 *
 * Side effects:
 *   - Clipboard write via `copyUrlToClipboard(workItemLink)` from `@plane/utils`.
 *   - Transient UI feedback via `setCopied(true)` followed by a 3000ms `setTimeout` to reset.
 *   - External link navigation via `<a target="_blank" rel="noopener noreferrer">` to the work item URL.
 *   - No mutations; no service calls.
 *
 * Derived state notes:
 *   - Returns `null` early when the issue is not present in the store (avoids rendering a toast action for an
 *     unreachable resource — e.g., the toast was emitted but the store snapshot has not propagated yet).
 *   - The "Copy link" button is hidden until the parent row receives `:hover` (Tailwind `group-hover:flex`).
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
import { copyUrlToClipboard, generateWorkItemLink } from "@plane/utils";
// plane imports
// helpers
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";

type TCreateIssueToastActionItems = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  isEpic?: boolean;
};

export const CreateIssueToastActionItems = observer(function CreateIssueToastActionItems(
  props: TCreateIssueToastActionItems
) {
  const { workspaceSlug, issueId, isEpic = false } = props;
  // state
  const [copied, setCopied] = useState(false);
  // store hooks
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const { getProjectIdentifierById } = useProject();

  // derived values
  const issue = getIssueById(issueId);
  const projectIdentifier = getProjectIdentifierById(issue?.project_id);

  if (!issue) return null;

  const workItemLink = generateWorkItemLink({
    workspaceSlug,
    projectId: issue?.project_id,
    issueId,
    projectIdentifier,
    sequenceId: issue?.sequence_id,
    isEpic,
  });

  const copyToClipboard = async (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    try {
      await copyUrlToClipboard(workItemLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (_error) {
      setCopied(false);
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="-ml-2 flex items-center gap-1 text-11 text-secondary">
      <a
        href={workItemLink}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-sm px-2 py-1 font-medium text-accent-primary hover:bg-surface-2"
      >
        {`View ${isEpic ? "epic" : "work item"}`}
      </a>

      {copied ? (
        <>
          <span className="cursor-default px-2 py-1 text-secondary">Copied!</span>
        </>
      ) : (
        <>
          <button
            className="hidden cursor-pointer rounded-sm px-2 py-1 text-tertiary group-hover:flex hover:bg-surface-2 hover:text-secondary"
            onClick={copyToClipboard}
          >
            Copy link
          </button>
        </>
      )}
    </div>
  );
});
