/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Top toolbar for the work item peek-overview panel.
 *
 * Rendered purpose: hosts the close button, an open-in-full-screen link, the peek-mode switcher
 * (`side-peek` / `modal` / `full-screen`), the save-status indicator, the subscription pill,
 * a copy-link icon button, and the work-item quick-action dropdown (edit / duplicate /
 * archive / delete / restore). Adapts tooltip behavior for mobile via `usePlatformOS`.
 *
 * Props (PeekOverviewHeaderProps):
 *   - peekMode (TPeekModes, required): "side-peek" | "modal" | "full-screen" — current peek layout
 *   - setPeekMode ((value: TPeekModes) => void, required): callback that mutates `peekMode` in the parent
 *   - removeRoutePeekId (() => void, required): close-peek callback supplied by the parent view shell
 *   - workspaceSlug (string, required): scopes mutations and the canonical link
 *   - projectId (string, required): scopes mutations
 *   - issueId (string, required): identifies the work item rendered in the peek
 *   - isArchived (boolean, required): when true, the subscription pill is hidden and the delete path
 *     routes through the archived-issues store
 *   - disabled (boolean, required): edit-disabled flag (propagated to `WorkItemDetailQuickActions.readOnly`)
 *   - embedIssue (boolean, required, default=false): when true, hides the peek-mode switcher (the
 *     embedded surface owns its own layout)
 *   - toggleDeleteIssueModal ((value: boolean) => void, required): opens/closes the delete confirm modal
 *   - toggleArchiveIssueModal ((value: boolean) => void, required): opens/closes the archive confirm modal
 *   - toggleDuplicateIssueModal ((value: boolean) => void, required): opens/closes the duplicate modal
 *   - toggleEditIssueModal ((value: boolean) => void, required): opens/closes the edit modal
 *   - handleRestoreIssue (() => Promise<void>, required): archive-restore handler from `root.tsx`
 *   - isSubmitting (TNameDescriptionLoader, required): "submitting" | "submitted" | "saved" — rendered
 *     via `<NameDescriptionUpdateStatus />`
 *
 * Exports:
 *   - TPeekModes (type): the peek layout discriminator
 *   - PeekOverviewHeaderProps (type): the public prop contract
 *   - IssuePeekOverviewHeader (observer component): the rendered header
 *
 * MobX stores read:
 *   - `useUser()` — `data` aliased as `currentUser`, used to gate the subscription pill
 *   - `useIssueDetail()` — `issue.getIssueById(issueId)`, `setPeekIssue`, `removeIssue`,
 *     `archiveIssue`, `getIsIssuePeeked`
 *   - `useIssues(EIssuesStoreType.ARCHIVED)` — `issues.removeIssue` aliased as `removeArchivedIssue`
 *     (used when `issueDetails?.archived_at` is truthy)
 *   - `useProject()` — `getProjectIdentifierById(issueDetails?.project_id)` for canonical-link composition
 *   - `usePlatformOS()` — `isMobile` for tooltip behavior
 *
 * Side effects:
 *   - Clipboard write via `copyUrlToClipboard(workItemLink)` from `@plane/utils`; followed by a
 *     success toast (`common.link_copied` / `common.link_copied_to_clipboard`).
 *   - API mutations (routed through the MobX issue store, which fans out to `IssueService` /
 *     `IssueArchiveService`):
 *       handleDeleteIssue   → `removeIssue` or `removeArchivedIssue` (DELETE) + `setPeekIssue(undefined)`
 *       handleArchiveIssue  → `archiveIssue` (POST) + conditional `removeRoutePeekId()` when peeked
 *       handleRestoreIssue  → parent-supplied restore handler from `root.tsx`
 *   - Toast emissions via `setToast` on copy-link success and on delete failure
 *     (`toast.error` / `entity.delete.failed`).
 *   - Navigation: `<Link href={workItemLink}>` opens the canonical work-item page after firing
 *     `removeRoutePeekId()` so the peek closes before navigation completes.
 *
 * Imperative DOM / derived state notes:
 *   - `parentRef` is a stable `useRef<HTMLDivElement>` forwarded to `WorkItemDetailQuickActions`
 *     so its dropdown menu can position relative to the header.
 *   - `currentMode = PEEK_OPTIONS.find((m) => m.key === peekMode)` resolves the active layout's
 *     icon + i18n title; the layout switcher is hidden entirely when `embedIssue === true`.
 *   - `workItemLink` is built via `generateWorkItemLink` from `@plane/utils` using the project
 *     identifier and sequence id; the `isArchived` flag selects the archived-route variant.
 *   - The full-screen mode adds a bottom border to the toolbar (`border-b border-subtle`).
 *
 * Consumers:
 *   - `apps/web/core/components/issues/peek-overview/view.tsx`
 *
 * Architectural notes:
 *   - MobX exclusively — stores via React context.
 *   - Routing: `Link` is imported from `next/link` (legacy import); preserved verbatim per the system
 *     boundary "No refactoring, renaming, or restructuring of any kind".
 *   - i18n: `useTranslation` from `@plane/i18n`; every visible string is an i18n key.
 *   - Layout switcher options are module-scope `PEEK_OPTIONS` and map keys to icons + i18n titles.
 */
import { useRef } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { MoveDiagonal, MoveRight } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { CenterPanelIcon, CopyLinkIcon, FullScreenPanelIcon, SidePanelIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import type { TNameDescriptionLoader } from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
import { CustomSelect } from "@plane/ui";
import { copyUrlToClipboard, generateWorkItemLink } from "@plane/utils";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useProject } from "@/hooks/store/use-project";
import { useUser } from "@/hooks/store/user";
import { usePlatformOS } from "@/hooks/use-platform-os";
// local imports
import { IssueSubscription } from "../issue-detail/subscription";
import { WorkItemDetailQuickActions } from "../issue-layouts/quick-action-dropdowns";
import { NameDescriptionUpdateStatus } from "../issue-update-status";
import { IconButton } from "@plane/propel/icon-button";

export type TPeekModes = "side-peek" | "modal" | "full-screen";

const PEEK_OPTIONS: { key: TPeekModes; icon: any; i18n_title: string }[] = [
  {
    key: "side-peek",
    icon: SidePanelIcon,
    i18n_title: "common.side_peek",
  },
  {
    key: "modal",
    icon: CenterPanelIcon,
    i18n_title: "common.modal",
  },
  {
    key: "full-screen",
    icon: FullScreenPanelIcon,
    i18n_title: "common.full_screen",
  },
];

export type PeekOverviewHeaderProps = {
  peekMode: TPeekModes;
  setPeekMode: (value: TPeekModes) => void;
  removeRoutePeekId: () => void;
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  isArchived: boolean;
  disabled: boolean;
  embedIssue: boolean;
  toggleDeleteIssueModal: (value: boolean) => void;
  toggleArchiveIssueModal: (value: boolean) => void;
  toggleDuplicateIssueModal: (value: boolean) => void;
  toggleEditIssueModal: (value: boolean) => void;
  handleRestoreIssue: () => Promise<void>;
  isSubmitting: TNameDescriptionLoader;
};

export const IssuePeekOverviewHeader = observer(function IssuePeekOverviewHeader(props: PeekOverviewHeaderProps) {
  const {
    peekMode,
    setPeekMode,
    workspaceSlug,
    projectId,
    issueId,
    isArchived,
    disabled,
    embedIssue = false,
    removeRoutePeekId,
    toggleDeleteIssueModal,
    toggleArchiveIssueModal,
    toggleDuplicateIssueModal,
    toggleEditIssueModal,
    handleRestoreIssue,
    isSubmitting,
  } = props;
  // ref
  const parentRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  // store hooks
  const { data: currentUser } = useUser();
  const {
    issue: { getIssueById },
    setPeekIssue,
    removeIssue,
    archiveIssue,
    getIsIssuePeeked,
  } = useIssueDetail();
  const { isMobile } = usePlatformOS();
  const { getProjectIdentifierById } = useProject();
  // derived values
  const issueDetails = getIssueById(issueId);
  const currentMode = PEEK_OPTIONS.find((m) => m.key === peekMode);
  const projectIdentifier = getProjectIdentifierById(issueDetails?.project_id);
  const {
    issues: { removeIssue: removeArchivedIssue },
  } = useIssues(EIssuesStoreType.ARCHIVED);

  const workItemLink = generateWorkItemLink({
    workspaceSlug,
    projectId: issueDetails?.project_id,
    issueId,
    projectIdentifier,
    sequenceId: issueDetails?.sequence_id,
    isArchived,
  });

  const handleCopyText = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    copyUrlToClipboard(workItemLink).then(() => {
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("common.link_copied"),
        message: t("common.link_copied_to_clipboard"),
      });
    });
  };

  const handleDeleteIssue = async () => {
    try {
      const deleteIssue = issueDetails?.archived_at ? removeArchivedIssue : removeIssue;

      return deleteIssue(workspaceSlug, projectId, issueId).then(() => {
        setPeekIssue(undefined);
      });
    } catch (_error) {
      setToast({
        title: t("toast.error"),
        type: TOAST_TYPE.ERROR,
        message: t("entity.delete.failed", { entity: t("issue.label", { count: 1 }) }),
      });
    }
  };

  const handleArchiveIssue = async () => {
    await archiveIssue(workspaceSlug, projectId, issueId);
    // check and remove if issue is peeked
    if (getIsIssuePeeked(issueId)) {
      removeRoutePeekId();
    }
  };

  return (
    <div
      className={`relative flex items-center justify-between p-4 ${
        currentMode?.key === "full-screen" ? "border-b border-subtle" : ""
      }`}
    >
      <div className="flex items-center gap-4">
        <Tooltip tooltipContent={t("common.close_peek_view")} isMobile={isMobile}>
          <button onClick={removeRoutePeekId}>
            <MoveRight className="h-4 w-4 text-tertiary hover:text-secondary" />
          </button>
        </Tooltip>

        <Tooltip tooltipContent={t("issue.open_in_full_screen")} isMobile={isMobile}>
          <Link href={workItemLink} onClick={() => removeRoutePeekId()}>
            <MoveDiagonal className="h-4 w-4 text-tertiary hover:text-secondary" />
          </Link>
        </Tooltip>
        {currentMode && embedIssue === false && (
          <div className="flex flex-shrink-0 items-center gap-2">
            <CustomSelect
              value={currentMode}
              onChange={(val: any) => setPeekMode(val)}
              customButton={
                <Tooltip tooltipContent={t("common.toggle_peek_view_layout")} isMobile={isMobile}>
                  <button type="button" className="">
                    <currentMode.icon className="h-4 w-4 text-tertiary hover:text-secondary" />
                  </button>
                </Tooltip>
              }
            >
              {PEEK_OPTIONS.map((mode) => (
                <CustomSelect.Option key={mode.key} value={mode.key}>
                  <div
                    className={`flex items-center gap-1.5 ${
                      currentMode.key === mode.key ? "text-secondary" : "text-placeholder hover:text-secondary"
                    }`}
                  >
                    <mode.icon className="-my-1 h-4 w-4 flex-shrink-0" />
                    {t(mode.i18n_title)}
                  </div>
                </CustomSelect.Option>
              ))}
            </CustomSelect>
          </div>
        )}
      </div>
      <div className="flex items-center gap-x-4">
        <NameDescriptionUpdateStatus isSubmitting={isSubmitting} />
        <div className="flex items-center gap-2">
          {currentUser && !isArchived && (
            <IssueSubscription workspaceSlug={workspaceSlug} projectId={projectId} issueId={issueId} />
          )}
          <Tooltip tooltipContent={t("common.actions.copy_link")} isMobile={isMobile}>
            <IconButton variant="secondary" size="lg" onClick={handleCopyText} icon={CopyLinkIcon} />
          </Tooltip>
          {issueDetails && (
            <WorkItemDetailQuickActions
              parentRef={parentRef}
              issue={issueDetails}
              handleDelete={handleDeleteIssue}
              handleArchive={handleArchiveIssue}
              handleRestore={handleRestoreIssue}
              readOnly={disabled}
              toggleDeleteIssueModal={toggleDeleteIssueModal}
              toggleArchiveIssueModal={toggleArchiveIssueModal}
              toggleDuplicateIssueModal={toggleDuplicateIssueModal}
              toggleEditIssueModal={toggleEditIssueModal}
              isPeekMode
            />
          )}
        </div>
      </div>
    </div>
  );
});
