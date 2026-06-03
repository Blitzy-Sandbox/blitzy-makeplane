/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Calendar-specific quick-add entrypoint. Renders a popover menu with
 * "Add issue" (inline quick-add form) and "Add existing issue" (search modal)
 * options, scoped to the active workspace/project (and optionally module/cycle).
 *
 * Props (TCalendarQuickAddIssueActions, L26):
 *   - prePopulatedData (optional) — typically { target_date } from the calling
 *     day cell; used to date-stamp both new and existing issues.
 *   - quickAddCallback (optional) — forwarded to QuickAddIssueRoot for create.
 *   - addIssuesToView (optional) — when supplied, the existing-issue path
 *     batches updateIssue + addIssuesToView and the search modal switches to
 *     module/cycle scope.
 *   - onOpen (optional) — fired when the inline quick-add opens.
 *   - isEpic (optional) — swaps "issue" labels to "epic" and hides the
 *     "Add existing" menu item.
 *
 * Stores read:
 *   - useIssueDetail().updateIssue — applies prePopulatedData (target_date) to
 *     each existing issue before adding it to the view.
 *   - useTranslation() for menu labels and toast copy.
 *
 * Side effects:
 *   - handleAddIssuesToView: Promise.all(updateIssue(...)) -> addIssuesToView(ids),
 *     wrapped in setPromiseToast from @plane/propel/toast.
 *   - Opens the inline create form via local isOpen state; opens the existing-
 *     issue picker via isExistingIssueModalOpen.
 *   - shouldHideIssue filters candidates whose start_date > target_date
 *     (avoids creating an invalid date range).
 *
 * Consumers:
 *   - ./issue-blocks.tsx (CalendarIssueBlocks).
 */

import { useState } from "react";
import { differenceInCalendarDays } from "date-fns/differenceInCalendarDays";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";

import { useTranslation } from "@plane/i18n";
// plane imports
import { PlusIcon } from "@plane/propel/icons";
import { setPromiseToast } from "@plane/propel/toast";
import type { ISearchIssueResponse, TIssue } from "@plane/types";
import { EIssueLayoutTypes } from "@plane/types";
import { CustomMenu } from "@plane/ui";
import { cn } from "@plane/utils";
// components
import { ExistingIssuesListModal } from "@/components/core/modals/existing-issues-list-modal";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { QuickAddIssueRoot } from "../quick-add";

type TCalendarQuickAddIssueActions = {
  prePopulatedData?: Partial<TIssue>;
  quickAddCallback?: (projectId: string | null | undefined, data: TIssue) => Promise<TIssue | undefined>;
  addIssuesToView?: (issueIds: string[]) => Promise<any>;
  onOpen?: () => void;
  isEpic?: boolean;
};

/** Quick-add menu for the calendar that creates new issues or adds existing ones to the active view, dated to the cell. */
export const CalendarQuickAddIssueActions = observer(function CalendarQuickAddIssueActions(
  props: TCalendarQuickAddIssueActions
) {
  const { prePopulatedData, quickAddCallback, addIssuesToView, onOpen, isEpic = false } = props;
  const { t } = useTranslation();
  // router
  const { workspaceSlug, projectId, moduleId } = useParams();
  // states
  const [isOpen, setIsOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isExistingIssueModalOpen, setIsExistingIssueModalOpen] = useState(false);
  const { updateIssue } = useIssueDetail();
  // derived values
  const ExistingIssuesListModalPayload = addIssuesToView
    ? moduleId
      ? { module: moduleId.toString(), target_date: "none" }
      : { cycle: true, target_date: "none" }
    : { target_date: "none" };

  const handleAddIssuesToView = async (data: ISearchIssueResponse[]) => {
    if (!workspaceSlug || !projectId) return;

    const issueIds = data.map((i) => i.id);
    const addExistingIssuesPromise = Promise.all(
      data.map((issue) => updateIssue(workspaceSlug.toString(), projectId.toString(), issue.id, prePopulatedData ?? {}))
    ).then(() => addIssuesToView?.(issueIds));

    setPromiseToast(addExistingIssuesPromise, {
      loading: t("issue.adding", { count: issueIds.length }),
      success: {
        title: t("toast.success"),
        message: () => t("entity.add.success", { entity: t("issue.label", { count: 2 }) }),
      },
      error: {
        title: t("toast.error"),
        message: (err) => err?.message || t("common.errors.default.message"),
      },
    });
  };

  const handleNewIssue = () => {
    setIsOpen(true);
    if (onOpen) onOpen();
  };
  const handleExistingIssue = () => {
    setIsExistingIssueModalOpen(true);
  };

  if (!projectId) return null;

  return (
    <>
      {workspaceSlug && projectId && (
        <ExistingIssuesListModal
          workspaceSlug={workspaceSlug.toString()}
          projectId={projectId.toString()}
          isOpen={isExistingIssueModalOpen}
          handleClose={() => setIsExistingIssueModalOpen(false)}
          searchParams={ExistingIssuesListModalPayload}
          handleOnSubmit={handleAddIssuesToView}
          shouldHideIssue={(issue) => {
            if (issue.start_date && prePopulatedData?.target_date) {
              const issueStartDate = new Date(issue.start_date);
              const targetDate = new Date(prePopulatedData.target_date);
              const diffInDays = differenceInCalendarDays(targetDate, issueStartDate);
              if (diffInDays < 0) return true;
            }
            return false;
          }}
        />
      )}
      <QuickAddIssueRoot
        isQuickAddOpen={isOpen}
        setIsQuickAddOpen={(isOpen) => setIsOpen(isOpen)}
        layout={EIssueLayoutTypes.CALENDAR}
        prePopulatedData={prePopulatedData}
        quickAddCallback={quickAddCallback}
        customQuickAddButton={
          <div
            className={cn(
              "overflow-hidden rounded-sm bg-layer-transparent hover:bg-layer-transparent-hover md:opacity-0 md:group-hover:opacity-100",
              {
                block: isMenuOpen,
              }
            )}
          >
            <CustomMenu
              placement="bottom-start"
              menuButtonOnClick={() => setIsMenuOpen(true)}
              onMenuClose={() => setIsMenuOpen(false)}
              className="w-full"
              customButtonClassName="w-full"
              customButton={
                <div className="flex w-full items-center gap-x-[6px] rounded-md px-2 py-1.5 text-tertiary hover:text-tertiary">
                  <PlusIcon className="h-3.5 w-3.5 flex-shrink-0 stroke-2" />
                  <span className="flex-shrink-0 text-13 font-medium">
                    {isEpic ? t("epic.add.label") : t("issue.add.label")}
                  </span>
                </div>
              }
            >
              <CustomMenu.MenuItem onClick={handleNewIssue}>
                {isEpic ? t("epic.add.label") : t("issue.add.label")}
              </CustomMenu.MenuItem>
              {!isEpic && (
                <CustomMenu.MenuItem onClick={handleExistingIssue}>{t("issue.add.existing")}</CustomMenu.MenuItem>
              )}
            </CustomMenu>
          </div>
        }
        isEpic={isEpic}
      />
    </>
  );
});
