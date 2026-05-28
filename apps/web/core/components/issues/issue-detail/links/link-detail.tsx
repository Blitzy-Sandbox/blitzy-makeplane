/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Per-link card renderer used by `./links.tsx` to display a single issue link in the issue-detail panel.
 *
 * Rendered purpose: a vertical card with a contextual icon (resolved from the URL via
 * `getIconForLink`), tooltip-wrapped link text (title or URL), inline action group
 * (edit / new-tab / delete) visible only when the viewer has permission, and a footer showing
 * relative creation time and creator attribution (with "Bot" suffix for bot users).
 *
 * Counterpart to `./link-item.tsx`, which renders the denser row-style variant of the same link.
 *
 * Props (`TIssueLinkDetail`, exported):
 *   - linkId (string, required): id used to resolve the link record from the issue-detail store.
 *   - linkOperations (TLinkOperationsModal, required): update/remove handlers supplied by
 *     `IssueLinkRoot` in `./root` and forwarded by `./links.tsx`.
 *   - isNotAllowed (boolean, required): when true, hides the entire inline action group
 *     (edit / new-tab / delete).
 *
 * MobX stores read:
 *   - `useIssueDetail()` — `link.getLinkById(linkId)` for the hydrated link record,
 *     `toggleIssueLinkModal` to open the shared modal, and `setIssueLinkData(linkDetail)` to
 *     stage the record for edit. Operates against the default `ISSUES` namespace.
 *   - `useMember()` — `getUserDetails(linkDetail.created_by_id)` for the creator attribution row.
 *
 * Non-store hooks:
 *   - `usePlatformOS()` — `isMobile` flag forwarded to `Tooltip` for mobile-mode rendering.
 *
 * Side effects:
 *   - Clicking the card body (NOT the action buttons) calls `copyTextToClipboard(linkDetail.url)`
 *     from `@plane/utils` and emits a `TOAST_TYPE.SUCCESS` toast ("Link copied!" / "Link copied to
 *     clipboard"). The card-body click handler is the canonical "copy" affordance here.
 *   - The new-tab `<a>` performs default browser navigation to `linkDetail.url` in a new tab with
 *     `rel="noopener noreferrer"`.
 *   - The delete button calls `linkOperations.remove(linkDetail.id)`, which fans out to
 *     `IssueLinkService.remove` → DELETE against `apps/api`'s `IssueLinkViewSet`.
 *   - The edit button toggles the shared create/update modal open and stages `linkDetail` as
 *     `issueLinkData` so the form rehydrates with the existing record.
 *
 * Imperative DOM/event notes:
 *   - Each action button calls `e.preventDefault(); e.stopPropagation();` so the wrapping clickable
 *     card-body does NOT also fire the copy-to-clipboard handler. Preserve these calls verbatim.
 *
 * Defensive rendering: returns an empty fragment when `getLinkById(linkId)` is undefined (the link
 * may have been removed by another client mid-render).
 *
 * Footer attribution: the creator's `display_name` is shown by default; when `is_bot` is true on
 * the resolved user record, the suffix " Bot" is appended to `first_name` instead.
 */

import { NewTabIcon, EditIcon, TrashIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import { getIconForLink, copyTextToClipboard, calculateTimeAgo } from "@plane/utils";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useMember } from "@/hooks/store/use-member";
import { usePlatformOS } from "@/hooks/use-platform-os";
// types
import type { TLinkOperationsModal } from "./create-update-link-modal";

export type TIssueLinkDetail = {
  linkId: string;
  linkOperations: TLinkOperationsModal;
  isNotAllowed: boolean;
};

export function IssueLinkDetail(props: TIssueLinkDetail) {
  // props
  const { linkId, linkOperations, isNotAllowed } = props;
  // hooks
  const {
    toggleIssueLinkModal: toggleIssueLinkModalStore,
    link: { getLinkById },
    setIssueLinkData,
  } = useIssueDetail();
  const { getUserDetails } = useMember();
  const { isMobile } = usePlatformOS();
  const linkDetail = getLinkById(linkId);
  if (!linkDetail) return <></>;

  const Icon = getIconForLink(linkDetail.url);

  const toggleIssueLinkModal = (modalToggle: boolean) => {
    toggleIssueLinkModalStore(modalToggle);
    setIssueLinkData(linkDetail);
  };

  const createdByDetails = getUserDetails(linkDetail.created_by_id);

  return (
    <div key={linkId}>
      <div className="relative flex flex-col rounded-md bg-surface-2 p-2.5">
        <div
          className="flex w-full cursor-pointer items-start justify-between gap-2"
          onClick={() => {
            copyTextToClipboard(linkDetail.url);
            setToast({
              type: TOAST_TYPE.SUCCESS,
              title: "Link copied!",
              message: "Link copied to clipboard",
            });
          }}
        >
          <div className="flex items-start gap-2 truncate">
            <span className="py-1">
              <Icon className="size-3 flex-shrink-0 stroke-2 text-tertiary group-hover:text-primary" />
            </span>
            <Tooltip
              tooltipContent={linkDetail.title && linkDetail.title !== "" ? linkDetail.title : linkDetail.url}
              isMobile={isMobile}
            >
              <span className="truncate text-11">
                {linkDetail.title && linkDetail.title !== "" ? linkDetail.title : linkDetail.url}
              </span>
            </Tooltip>
          </div>

          {!isNotAllowed && (
            <div className="z-[1] flex flex-shrink-0 items-center gap-2">
              <button
                type="button"
                className="flex items-center justify-center p-1 hover:bg-layer-1"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleIssueLinkModal(true);
                }}
              >
                <EditIcon className="h-3 w-3 stroke-[1.5] text-secondary" />
              </button>
              <a
                href={linkDetail.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center p-1 hover:bg-layer-1"
              >
                <NewTabIcon className="h-3 w-3 stroke-[1.5] text-secondary" />
              </a>
              <button
                type="button"
                className="flex items-center justify-center p-1 hover:bg-layer-1"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  linkOperations.remove(linkDetail.id);
                }}
              >
                <TrashIcon className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

        <div className="px-5">
          <p className="mt-0.5 stroke-[1.5] text-11 text-tertiary">
            Added {calculateTimeAgo(linkDetail.created_at)}
            <br />
            {createdByDetails && (
              <>
                by {createdByDetails?.is_bot ? createdByDetails?.first_name + " Bot" : createdByDetails?.display_name}
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
