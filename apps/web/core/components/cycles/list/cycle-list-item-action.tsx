/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * MobX-observed inline action and metadata strip for each cycle row in the
 * cycles list — exposes the "more details" peek button, optional work-item
 * count, transfer-issues affordance for completed cycles, date display
 * (live-formatted in active state or read-only DateRangeDropdown otherwise),
 * project-timezone offset indicator, creator/assignee avatars, the favorite
 * star toggle, and the desktop-only CycleQuickActions overflow trigger.
 *
 * Props:
 *   - workspaceSlug (string, required): workspace slug used for favorite
 *     mutations, peek navigation, permission checks, and forwarded to
 *     CycleQuickActions.
 *   - projectId (string, required): project ID used for favorite mutations,
 *     timezone resolution, permission checks, and forwarded to CycleAdditionalActions
 *     and CycleQuickActions.
 *   - cycleId (string, required): cycle ID used for favorite mutations, peek
 *     query-string toggling, and forwarded to TransferIssuesModal +
 *     CycleAdditionalActions + CycleQuickActions.
 *   - cycleDetails (ICycle, required): full cycle entity (status, dates,
 *     issue counts, assignee_ids, created_by, is_favorite, archived_at) — drives
 *     all conditional rendering and prefills the react-hook-form reset effect.
 *   - parentRef (React.RefObject<HTMLDivElement>, required): forwarded to
 *     CycleQuickActions as the anchor element for its context menu.
 *   - isActive (boolean, optional, default=false): when true, swaps the date
 *     display to a Tooltip-wrapped MergedDateDisplay with the project UTC offset
 *     pill and hides the assignee avatar group; when false, renders the
 *     read-only DateRangeDropdown and shows the assignee group.
 *
 * MobX stores read:
 *   - useCycle (cycle store): addCycleToFavorites, removeCycleFromFavorites
 *     actions used by the favorite toggle handlers.
 *   - useUserPermissions (user permissions store): allowPermissions to gate the
 *     favorite star (and any future edit affordance) to ADMIN/MEMBER roles at
 *     PROJECT level for the current workspaceSlug + projectId.
 *   - useMember (member store): getUserDetails to resolve the creator and each
 *     assignee for the Avatar / AvatarGroup rendering.
 *
 * Other hooks consumed:
 *   - useTranslation from @plane/i18n for every user-facing string (toast
 *     copy, button labels, dropdown placeholders, transfer count).
 *   - usePlatformOS for the isMobile flag that affects tooltip behavior and the
 *     visibility of the inline "more details" button.
 *   - useTimeZoneConverter(projectId) for renderFormattedDateInUserTimezone,
 *     isProjectTimeZoneDifferent, and getProjectUTCOffset — drives the Tooltip
 *     content and the UTC pill on active cycles.
 *   - useLocalStorage<boolean>(IS_FAVORITE_MENU_OPEN, false) — used by the
 *     favorite handler to auto-open the favorites side menu on first favorite.
 *   - useForm(react-hook-form) with start_date/end_date defaults — the reset
 *     effect synchronizes form state when cycleDetails changes.
 *   - useParams, useSearchParams, usePathname (next/navigation) plus
 *     useAppRouter — for the peek-cycle query-string toggle on the
 *     "more details" button.
 *
 * Side effects:
 *   - API calls (via cycle store actions, both wired to CycleService):
 *       - addCycleToFavorites(workspaceSlug, projectId, cycleId) on the favorite
 *         star click when the cycle is not yet favorited.
 *       - removeCycleFromFavorites(workspaceSlug, projectId, cycleId) on the
 *         favorite star click when the cycle is already favorited.
 *   - Toasts (via @plane/propel/toast setPromiseToast): one promise toast per
 *     favorite/unfavorite action with i18n loading / success / failed messages
 *     keyed under `project_cycles.action.favorite.*` and
 *     `project_cycles.action.unfavorite.*`.
 *   - Local storage: toggleFavoriteMenu(true) on the FIRST successful favorite
 *     of any cycle, so the favorites side menu auto-opens for the user.
 *   - Navigation: useAppRouter().push to `${pathname}?${query}` to toggle the
 *     `peekCycle` search param on the "more details" button — sets it on first
 *     click, clears it on second click.
 *   - Modal mount: TransferIssuesModal is always mounted but controlled by the
 *     local `transferIssuesModal` useState flag; opened from the inline
 *     "Transfer work items" button when the cycle status is completed and there
 *     are transferable issues remaining.
 *   - Imperative form reset: a useEffect calls react-hook-form's reset({
 *     ...cycleDetails }) whenever cycleDetails changes; the form is unused for
 *     display but kept for compatibility with the surrounding date-range flow.
 *
 * Conditional rendering:
 *   - "more details" button visibility: shown when the row is hovered (always
 *     via group-hover), the platform is mobile, or the cycle is active without
 *     the peek panel currently open.
 *   - Work-item count badge: shown only when cycleStatus is "draft" or
 *     "upcoming" (showIssueCount memo).
 *   - Transfer-issues affordance: shown only when routerProjectId is present,
 *     cycleStatus is "completed", AND transferableIssuesCount > 0.
 *   - Date display: Tooltip + MergedDateDisplay + UTC pill when isActive;
 *     otherwise read-only DateRangeDropdown if cycleDetails.start_date is set.
 *   - Assignee avatar group: hidden when isActive.
 *   - Favorite star: shown only when the user has ADMIN/MEMBER permission AND
 *     the cycle is NOT archived (preventing favoriting of archived cycles).
 *
 * Consumers: cycles/list/cycles-list-item.tsx (mounted via the ListItem's
 * `actionableItems` slot).
 */

import type { MouseEvent } from "react";
import React, { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { Eye, ArrowRight, CalendarDays } from "lucide-react";
// plane imports
import { EUserPermissions, EUserPermissionsLevel, IS_FAVORITE_MENU_OPEN } from "@plane/constants";
import { useLocalStorage } from "@plane/hooks";
import { useTranslation } from "@plane/i18n";
import { TransferIcon, WorkItemsIcon, MembersPropertyIcon } from "@plane/propel/icons";
import { setPromiseToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import type { ICycle, TCycleGroups } from "@plane/types";
import { Avatar, AvatarGroup, FavoriteStar } from "@plane/ui";
import { getDate, getFileURL, generateQueryParams } from "@plane/utils";
// components
import { DateRangeDropdown } from "@/components/dropdowns/date-range";
import { ButtonAvatars } from "@/components/dropdowns/member/avatar";
import { MergedDateDisplay } from "@/components/dropdowns/merged-date";
// hooks
import { useCycle } from "@/hooks/store/use-cycle";
import { useMember } from "@/hooks/store/use-member";
import { useUserPermissions } from "@/hooks/store/user";
import { useAppRouter } from "@/hooks/use-app-router";
import { usePlatformOS } from "@/hooks/use-platform-os";
import { useTimeZoneConverter } from "@/hooks/use-timezone-converter";
// plane web components
import { CycleAdditionalActions } from "@/plane-web/components/cycles";
// local imports
import { CycleQuickActions } from "../quick-actions";
import { TransferIssuesModal } from "../transfer-issues-modal";

type Props = {
  workspaceSlug: string;
  projectId: string;
  cycleId: string;
  cycleDetails: ICycle;
  parentRef: React.RefObject<HTMLDivElement>;
  isActive?: boolean;
};

const defaultValues: Partial<ICycle> = {
  start_date: null,
  end_date: null,
};

export const CycleListItemAction = observer(function CycleListItemAction(props: Props) {
  const { workspaceSlug, projectId, cycleId, cycleDetails, parentRef, isActive = false } = props;
  // router
  const { projectId: routerProjectId } = useParams();
  //states
  const [transferIssuesModal, setTransferIssuesModal] = useState(false);
  // hooks
  const { isMobile } = usePlatformOS();
  const { t } = useTranslation();
  const { isProjectTimeZoneDifferent, getProjectUTCOffset, renderFormattedDateInUserTimezone } =
    useTimeZoneConverter(projectId);
  // router
  const router = useAppRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  // store hooks
  const { addCycleToFavorites, removeCycleFromFavorites } = useCycle();
  const { allowPermissions } = useUserPermissions();

  // local storage
  const { setValue: toggleFavoriteMenu, storedValue: isFavoriteMenuOpen } = useLocalStorage<boolean>(
    IS_FAVORITE_MENU_OPEN,
    false
  );

  const { getUserDetails } = useMember();

  // form
  const { reset } = useForm({
    defaultValues,
  });

  // derived values
  const cycleStatus = cycleDetails.status ? (cycleDetails.status.toLocaleLowerCase() as TCycleGroups) : "draft";

  const showIssueCount = useMemo(() => cycleStatus === "draft" || cycleStatus === "upcoming", [cycleStatus]);

  const transferableIssuesCount = cycleDetails
    ? cycleDetails.total_issues - (cycleDetails.cancelled_issues + cycleDetails.completed_issues)
    : 0;

  const showTransferIssues = routerProjectId && transferableIssuesCount > 0 && cycleStatus === "completed";

  const projectUTCOffset = getProjectUTCOffset();

  const isEditingAllowed = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    projectId
  );

  // handlers
  const handleAddToFavorites = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (!workspaceSlug || !projectId) return;

    const addToFavoritePromise = addCycleToFavorites(workspaceSlug?.toString(), projectId.toString(), cycleId).then(
      () => {
        if (!isFavoriteMenuOpen) toggleFavoriteMenu(true);
      }
    );

    setPromiseToast(addToFavoritePromise, {
      loading: t("project_cycles.action.favorite.loading"),
      success: {
        title: t("project_cycles.action.favorite.success.title"),
        message: () => t("project_cycles.action.favorite.success.description"),
      },
      error: {
        title: t("project_cycles.action.favorite.failed.title"),
        message: () => t("project_cycles.action.favorite.failed.description"),
      },
    });
  };

  const handleRemoveFromFavorites = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (!workspaceSlug || !projectId) return;

    const removeFromFavoritePromise = removeCycleFromFavorites(
      workspaceSlug?.toString(),
      projectId.toString(),
      cycleId
    );

    setPromiseToast(removeFromFavoritePromise, {
      loading: t("project_cycles.action.unfavorite.loading"),
      success: {
        title: t("project_cycles.action.unfavorite.success.title"),
        message: () => t("project_cycles.action.unfavorite.success.description"),
      },
      error: {
        title: t("project_cycles.action.unfavorite.failed.title"),
        message: () => t("project_cycles.action.unfavorite.failed.description"),
      },
    });
  };

  const createdByDetails = cycleDetails.created_by ? getUserDetails(cycleDetails.created_by) : undefined;

  useEffect(() => {
    if (cycleDetails)
      reset({
        ...cycleDetails,
      });
  }, [cycleDetails, reset]);

  // handlers
  const openCycleOverview = (e: MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const query = generateQueryParams(searchParams, ["peekCycle"]);
    if (searchParams.has("peekCycle") && searchParams.get("peekCycle") === cycleId) {
      router.push(`${pathname}?${query}`);
    } else {
      router.push(`${pathname}?${query && `${query}&`}peekCycle=${cycleId}`);
    }
  };

  return (
    <>
      <TransferIssuesModal
        handleClose={() => setTransferIssuesModal(false)}
        isOpen={transferIssuesModal}
        cycleId={cycleId.toString()}
      />
      <button
        onClick={openCycleOverview}
        className={`z-[1] flex flex-shrink-0 gap-1 text-11 text-accent-secondary ${isMobile || (isActive && !searchParams.has("peekCycle")) ? "flex" : "hidden group-hover:flex"}`}
      >
        <Eye className="my-auto h-4 w-4 text-accent-secondary" />
        <span>{t("project_cycles.more_details")}</span>
      </button>
      {showIssueCount && (
        <div className="flex items-center gap-1">
          <WorkItemsIcon className="h-4 w-4 text-tertiary" />
          <span className="text-11 text-tertiary">{cycleDetails.total_issues}</span>
        </div>
      )}
      <CycleAdditionalActions cycleId={cycleId} projectId={projectId} />
      {showTransferIssues && (
        <div
          className="flex h-6 cursor-pointer items-center gap-1 px-2 text-accent-secondary"
          onClick={() => {
            setTransferIssuesModal(true);
          }}
        >
          <TransferIcon className="w-4 fill-accent-primary" />
          <span>{t("project_cycles.transfer_work_items", { count: transferableIssuesCount })}</span>
        </div>
      )}
      {isActive ? (
        <>
          <div className="flex gap-2">
            {/* Duration */}
            <Tooltip
              tooltipContent={
                <span className="flex gap-1">
                  {renderFormattedDateInUserTimezone(cycleDetails.start_date ?? "")}
                  <ArrowRight className="my-auto h-3 w-3 flex-shrink-0" />
                  {renderFormattedDateInUserTimezone(cycleDetails.end_date ?? "")}
                </span>
              }
              disabled={!isProjectTimeZoneDifferent()}
              tooltipHeading={t("project_cycles.in_your_timezone")}
            >
              <div className="flex items-center gap-1 text-11 font-medium text-tertiary">
                <CalendarDays className="my-auto h-3 w-3 flex-shrink-0" />
                <MergedDateDisplay startDate={cycleDetails.start_date} endDate={cycleDetails.end_date} />
              </div>
            </Tooltip>
            {projectUTCOffset && (
              <span className="cursor-default rounded-md bg-layer-1 px-2 py-1 text-11 text-tertiary">
                {projectUTCOffset}
              </span>
            )}
            {/* created by */}
            {createdByDetails && <ButtonAvatars showTooltip={false} userIds={createdByDetails?.id} />}
          </div>
        </>
      ) : (
        cycleDetails.start_date && (
          <>
            <DateRangeDropdown
              buttonVariant={"transparent-with-text"}
              buttonContainerClassName={`h-6 w-full cursor-auto flex items-center gap-1.5 text-tertiary rounded-sm text-11 [&>div]:hover:bg-transparent`}
              buttonClassName="p-0"
              minDate={new Date()}
              value={{
                from: getDate(cycleDetails.start_date),
                to: getDate(cycleDetails.end_date),
              }}
              placeholder={{
                from: t("project_cycles.start_date"),
                to: t("project_cycles.end_date"),
              }}
              showTooltip={isProjectTimeZoneDifferent()}
              customTooltipHeading={t("project_cycles.in_your_timezone")}
              customTooltipContent={
                <span className="flex gap-1">
                  {renderFormattedDateInUserTimezone(cycleDetails.start_date ?? "")}
                  <ArrowRight className="my-auto h-3 w-3 flex-shrink-0" />
                  {renderFormattedDateInUserTimezone(cycleDetails.end_date ?? "")}
                </span>
              }
              mergeDates
              required={cycleDetails.status !== "draft"}
              disabled
              hideIcon={{
                from: false,
                to: false,
              }}
            />
          </>
        )
      )}
      {/* created by */}
      {createdByDetails && !isActive && <ButtonAvatars showTooltip={false} userIds={createdByDetails?.id} />}
      {!isActive && (
        <Tooltip tooltipContent={`${cycleDetails.assignee_ids?.length} Members`} isMobile={isMobile}>
          <div className="flex w-min cursor-default items-center justify-center">
            {cycleDetails.assignee_ids && cycleDetails.assignee_ids?.length > 0 ? (
              <AvatarGroup showTooltip={false}>
                {cycleDetails.assignee_ids?.map((assignee_id) => {
                  const member = getUserDetails(assignee_id);
                  return (
                    <Avatar key={member?.id} name={member?.display_name} src={getFileURL(member?.avatar_url ?? "")} />
                  );
                })}
              </AvatarGroup>
            ) : (
              <MembersPropertyIcon className="h-4 w-4 text-tertiary" />
            )}
          </div>
        </Tooltip>
      )}
      {isEditingAllowed && !cycleDetails.archived_at && (
        <FavoriteStar
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (cycleDetails.is_favorite) handleRemoveFromFavorites(e);
            else handleAddToFavorites(e);
          }}
          selected={!!cycleDetails.is_favorite}
        />
      )}
      <div className="hidden md:block">
        <CycleQuickActions
          parentRef={parentRef}
          cycleId={cycleId}
          projectId={projectId}
          workspaceSlug={workspaceSlug}
        />
      </div>
    </>
  );
});
