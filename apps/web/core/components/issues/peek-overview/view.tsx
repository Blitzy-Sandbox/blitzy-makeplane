/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Layout shell for the work item peek-overview panel.
 *
 * Rendered purpose: switches the peek between `side-peek` (right-docked drawer), `modal`
 * (centered overlay), and `full-screen` modes; manages dismissal via Escape key and
 * outside-click detection; portals the panel into `#full-screen-portal` unless embedded;
 * and composes the header, details, properties, widgets, and activity sections.
 *
 * Props (IIssueView):
 *   - workspaceSlug (string, required): scopes all child mutations and links
 *   - projectId (string, required): scopes all child mutations and links
 *   - issueId (string, required): identifies the work item rendered in the panel
 *   - isLoading (boolean, optional): when true, renders `<IssuePeekOverviewLoader />`
 *   - isError (boolean, optional): when true, renders `<IssuePeekOverviewError />`
 *   - is_archived (boolean, required): when true, the panel switches to read-only and the
 *     properties sidebar disables pointer events
 *   - disabled (boolean, optional, default=false): edit-disabled flag from the parent's permission check
 *   - embedIssue (boolean, optional, default=false): when true, the panel renders inline
 *     (no portal, no outside-click dismissal, no Escape handler)
 *   - embedRemoveCurrentNotification (() => void, optional): callback invoked alongside `removeRoutePeekId`
 *     when the panel is dismissed in embedded mode
 *   - issueOperations (TIssueOperations, required): the issue-update contract sourced from `../issue-detail`
 *
 * MobX stores read:
 *   - `useIssueDetail()` — `setPeekIssue` (mutation to close the peek), `isAnyModalOpen`,
 *     `issue.getIssueById(issueId)`
 *   - `useIssueDetail(EIssueServiceType.EPICS)` — `isAnyModalOpen` aliased as `isAnyEpicModalOpen` so
 *     epic-scoped modals do not trigger outside-click dismissal of the peek
 *
 * Side effects:
 *   - `setPeekIssue(undefined)` — closes the peek and clears the active peek id in the store
 *   - `embedRemoveCurrentNotification()` — called alongside the close in embedded mode (e.g. inbox row removal)
 *   - DOM portal: `createPortal(content, portalContainer)` mounts the panel into `#full-screen-portal`
 *     unless `embedIssue` is true (in which case the panel renders inline)
 *   - Keyboard listener: `useKeypress("Escape", ...)` dismisses the panel when no editor dropbar/full-screen
 *     image modal/dropdown input is focused and no MobX modal is open
 *   - Outside-click: `usePeekOverviewOutsideClickDetector` watches the ref and dismisses on outside click
 *     unless any modal, dropbar, local modal, or embed context is active. The "main-sidebar" element is
 *     excluded from the outside-click region so clicks on the global sidebar do not close the peek.
 *
 * Imperative DOM / derived state notes:
 *   - `peekOverviewIssueClassName` is composed via `cn(...)` from `@plane/utils` and switches the panel's
 *     positioning between right-docked, centered, and full-screen variants based on `peekMode`.
 *   - The full-screen mode renders a two-column layout (main content + right sidebar) inside an
 *     overflow-auto container. The side-peek / modal modes render a single-column layout.
 *   - `editorRef.current?.isAnyDropbarOpen()` is checked before dismissal so the panel does not close while
 *     a TipTap dropbar (e.g., link editor, image popover) is active.
 *   - On Escape dismissal, the parent issue card receives focus via
 *     `document.getElementById(`issue-${issueId}`)?.focus()` — preserves keyboard navigation context.
 *   - The local boolean states (`isDeleteIssueModalOpen`, `isArchiveIssueModalOpen`,
 *     `isDuplicateIssueModalOpen`, `isEditIssueModalOpen`) are aggregated into `isAnyLocalModalOpen` to
 *     prevent dismissal while a confirmation modal is open in front of the peek.
 *
 * Consumers:
 *   - `apps/web/core/components/issues/peek-overview/root.tsx` (the orchestration root)
 *
 * Architectural notes:
 *   - MobX exclusively — stores via React context.
 *   - Reactivity: wrapped in `observer(...)` so that changes to the resolved `issue` snapshot and to
 *     any of the watched modal flags re-render the panel.
 *   - The portal target `#full-screen-portal` is mounted at the app root by the layout shell; this
 *     component fails open (renders inline) if the portal is not yet attached to the DOM.
 */

import { useRef, useState } from "react";
import { observer } from "mobx-react";
import { createPortal } from "react-dom";
// plane imports
import type { EditorRefApi } from "@plane/editor";
import type { TNameDescriptionLoader } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import useKeypress from "@/hooks/use-keypress";
import usePeekOverviewOutsideClickDetector from "@/hooks/use-peek-overview-outside-click";
// local imports
import type { TIssueOperations } from "../issue-detail";
import { IssueActivity } from "../issue-detail/issue-activity";
import { IssueDetailWidgets } from "../issue-detail-widgets";
import { IssuePeekOverviewError } from "./error";
import type { TPeekModes } from "./header";
import { IssuePeekOverviewHeader } from "./header";
import { PeekOverviewIssueDetails } from "./issue-detail";
import { IssuePeekOverviewLoader } from "./loader";
import { PeekOverviewProperties } from "./properties";

interface IIssueView {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  isLoading?: boolean;
  isError?: boolean;
  is_archived: boolean;
  disabled?: boolean;
  embedIssue?: boolean;
  embedRemoveCurrentNotification?: () => void;
  issueOperations: TIssueOperations;
}

export const IssueView = observer(function IssueView(props: IIssueView) {
  const {
    workspaceSlug,
    projectId,
    issueId,
    isLoading,
    isError,
    is_archived,
    disabled = false,
    embedIssue = false,
    embedRemoveCurrentNotification,
    issueOperations,
  } = props;
  // states
  const [peekMode, setPeekMode] = useState<TPeekModes>("side-peek");
  const [isSubmitting, setIsSubmitting] = useState<TNameDescriptionLoader>("saved");
  const [isDeleteIssueModalOpen, setIsDeleteIssueModalOpen] = useState(false);
  const [isArchiveIssueModalOpen, setIsArchiveIssueModalOpen] = useState(false);
  const [isDuplicateIssueModalOpen, setIsDuplicateIssueModalOpen] = useState(false);
  const [isEditIssueModalOpen, setIsEditIssueModalOpen] = useState(false);
  // ref
  const issuePeekOverviewRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorRefApi>(null);
  // store hooks
  const {
    setPeekIssue,
    isAnyModalOpen,
    issue: { getIssueById },
  } = useIssueDetail();
  const { isAnyModalOpen: isAnyEpicModalOpen } = useIssueDetail(EIssueServiceType.EPICS);
  const issue = getIssueById(issueId);
  // remove peek id
  const removeRoutePeekId = () => {
    setPeekIssue(undefined);
    if (embedIssue && embedRemoveCurrentNotification) embedRemoveCurrentNotification();
  };

  const toggleDeleteIssueModal = (value: boolean) => setIsDeleteIssueModalOpen(value);
  const toggleArchiveIssueModal = (value: boolean) => setIsArchiveIssueModalOpen(value);
  const toggleDuplicateIssueModal = (value: boolean) => setIsDuplicateIssueModalOpen(value);
  const toggleEditIssueModal = (value: boolean) => setIsEditIssueModalOpen(value);

  const isAnyLocalModalOpen =
    isDeleteIssueModalOpen || isArchiveIssueModalOpen || isDuplicateIssueModalOpen || isEditIssueModalOpen;

  usePeekOverviewOutsideClickDetector(
    issuePeekOverviewRef,
    () => {
      const isAnyDropbarOpen = editorRef.current?.isAnyDropbarOpen();
      if (!embedIssue) {
        if (!isAnyModalOpen && !isAnyEpicModalOpen && !isAnyLocalModalOpen && !isAnyDropbarOpen) {
          removeRoutePeekId();
        }
      }
    },
    issueId,
    ["main-sidebar"]
  );

  const handleKeyDown = () => {
    const editorImageFullScreenModalElement = document.querySelector(".editor-image-full-screen-modal");
    const dropdownElement = document.activeElement?.tagName === "INPUT";
    const isAnyDropbarOpen = editorRef.current?.isAnyDropbarOpen();
    if (!isAnyModalOpen && !dropdownElement && !isAnyDropbarOpen && !editorImageFullScreenModalElement) {
      removeRoutePeekId();
      const issueElement = document.getElementById(`issue-${issueId}`);
      if (issueElement) issueElement?.focus();
    }
  };

  useKeypress("Escape", () => !embedIssue && handleKeyDown());

  const handleRestore = async () => {
    if (!issueOperations.restore) return;
    await issueOperations.restore(workspaceSlug, projectId, issueId);
    removeRoutePeekId();
  };

  const peekOverviewIssueClassName = cn(
    !embedIssue
      ? "absolute z-[25] flex flex-col overflow-hidden rounded-sm border border-subtle bg-surface-1 transition-all duration-300"
      : `h-full w-full`,
    !embedIssue && {
      "top-0 right-0 bottom-0 w-full border-0 border-l md:w-[50%]": peekMode === "side-peek",
      "top-[8.33%] left-[8.33%] size-5/6": peekMode === "modal",
      "absolute inset-0 m-4": peekMode === "full-screen",
    }
  );

  const shouldUsePortal = !embedIssue;

  const portalContainer = document.getElementById("full-screen-portal") as HTMLElement;

  const content = (
    <div className="w-full text-body-sm-regular">
      {issueId && (
        <div
          ref={issuePeekOverviewRef}
          className={peekOverviewIssueClassName}
          style={{
            boxShadow:
              "0px 4px 8px 0px rgba(0, 0, 0, 0.12), 0px 6px 12px 0px rgba(16, 24, 40, 0.12), 0px 1px 16px 0px rgba(16, 24, 40, 0.12)",
          }}
        >
          {isError ? (
            <div className="relative h-screen w-full overflow-hidden">
              <IssuePeekOverviewError removeRoutePeekId={removeRoutePeekId} />
            </div>
          ) : (
            isLoading && <IssuePeekOverviewLoader removeRoutePeekId={removeRoutePeekId} />
          )}
          {!isLoading && !isError && issue && (
            <>
              {/* header */}
              <IssuePeekOverviewHeader
                peekMode={peekMode}
                setPeekMode={(value) => setPeekMode(value)}
                removeRoutePeekId={removeRoutePeekId}
                toggleDeleteIssueModal={toggleDeleteIssueModal}
                toggleArchiveIssueModal={toggleArchiveIssueModal}
                toggleDuplicateIssueModal={toggleDuplicateIssueModal}
                toggleEditIssueModal={toggleEditIssueModal}
                handleRestoreIssue={handleRestore}
                isArchived={is_archived}
                issueId={issueId}
                workspaceSlug={workspaceSlug}
                projectId={projectId}
                isSubmitting={isSubmitting}
                disabled={disabled}
                embedIssue={embedIssue}
              />
              {/* content */}
              <div className="vertical-scrollbar relative scrollbar-md h-full w-full overflow-hidden overflow-y-auto">
                {["side-peek", "modal"].includes(peekMode) ? (
                  <div className="relative flex flex-col gap-3 space-y-3 px-8 py-5">
                    <PeekOverviewIssueDetails
                      editorRef={editorRef}
                      workspaceSlug={workspaceSlug}
                      projectId={projectId}
                      issueId={issueId}
                      issueOperations={issueOperations}
                      disabled={disabled}
                      isArchived={is_archived}
                      isSubmitting={isSubmitting}
                      setIsSubmitting={(value) => setIsSubmitting(value)}
                    />

                    <div className="py-2">
                      <IssueDetailWidgets
                        workspaceSlug={workspaceSlug}
                        projectId={projectId}
                        issueId={issueId}
                        disabled={disabled || is_archived}
                        issueServiceType={EIssueServiceType.ISSUES}
                      />
                    </div>

                    <PeekOverviewProperties
                      workspaceSlug={workspaceSlug}
                      projectId={projectId}
                      issueId={issueId}
                      issueOperations={issueOperations}
                      disabled={disabled || is_archived}
                    />

                    <IssueActivity
                      workspaceSlug={workspaceSlug}
                      projectId={projectId}
                      issueId={issueId}
                      disabled={is_archived}
                    />
                  </div>
                ) : (
                  <div className="vertical-scrollbar flex h-full w-full overflow-auto">
                    <div className="relative h-full w-full space-y-6 overflow-auto p-4 py-5">
                      <div className="space-y-3">
                        <PeekOverviewIssueDetails
                          editorRef={editorRef}
                          workspaceSlug={workspaceSlug}
                          projectId={projectId}
                          issueId={issueId}
                          issueOperations={issueOperations}
                          disabled={disabled}
                          isArchived={is_archived}
                          isSubmitting={isSubmitting}
                          setIsSubmitting={(value) => setIsSubmitting(value)}
                        />

                        <div className="py-2">
                          <IssueDetailWidgets
                            workspaceSlug={workspaceSlug}
                            projectId={projectId}
                            issueId={issueId}
                            disabled={disabled}
                            issueServiceType={EIssueServiceType.ISSUES}
                          />
                        </div>

                        <IssueActivity
                          workspaceSlug={workspaceSlug}
                          projectId={projectId}
                          issueId={issueId}
                          disabled={is_archived}
                        />
                      </div>
                    </div>
                    <div
                      className={`vertical-scrollbar scrollbar-sm h-full !w-[400px] flex-shrink-0 overflow-hidden border-l border-subtle p-4 py-5 ${
                        is_archived ? "pointer-events-none" : ""
                      }`}
                    >
                      <PeekOverviewProperties
                        workspaceSlug={workspaceSlug}
                        projectId={projectId}
                        issueId={issueId}
                        issueOperations={issueOperations}
                        disabled={disabled || is_archived}
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );

  return <>{shouldUsePortal && portalContainer ? createPortal(content, portalContainer) : content}</>;
});
