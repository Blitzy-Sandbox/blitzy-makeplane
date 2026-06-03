/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Mentions filter row inside the issue layout header filters Popover.
 *
 * Rendered purpose: renders a searchable, paginated, selectable list of mentionable members as
 * `FilterOption` rows; clicking a row toggles that member's id in / out of the active mentions
 * filter set. The header shows the active count as `Mention (N)` and the section can be collapsed
 * via `FilterHeader`'s preview toggle.
 *
 * Props (`Props`):
 *   - `appliedFilters` (`string[] | null`, required): currently-selected mentioned user ids for the
 *     `mentions` filter slot.
 *   - `handleUpdate` (`(val: string) => void`, required): invoked with the clicked member id; the
 *     parent route root flips it into / out of `appliedFilters` and persists via
 *     `issuesFilter.updateFilters(workspaceSlug, projectId, EIssueFilterType.FILTERS,
 *     { mentions: <next-array> })`.
 *   - `memberIds` (`string[] | undefined`, required): candidate roster of member ids to render;
 *     supplied by the parent (typically `workspaceMember` / `projectMember` MobX store selectors).
 *     `undefined` triggers a `Loader` skeleton fallback in the JSX.
 *   - `searchQuery` (`string`, required): substring filter applied case-insensitively to each
 *     member's `display_name` before sorting.
 *
 * MobX stores read:
 *   - `useMember()` -> `getUserDetails(memberId)` to resolve display name and avatar for each row.
 *   - `useUser()` -> `data` (the authenticated user) to label the current user's row as `"You"`
 *     and to pin the current user near the top of the sort order.
 *
 * Side effects: none directly. Row click invokes `handleUpdate`; pagination ("View all" / "View
 * less") only mutates the local `itemsToRender` state. No API calls, no router navigation, no
 * direct store writes.
 */

import { useMemo, useState } from "react";
import { sortBy } from "lodash-es";
import { observer } from "mobx-react";
// plane ui
import { Loader, Avatar } from "@plane/ui";
// components
import { getFileURL } from "@plane/utils";
import { FilterHeader, FilterOption } from "@/components/issues/issue-layouts/filters";
// helpers
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useUser } from "@/hooks/store/user";

type Props = {
  appliedFilters: string[] | null;
  handleUpdate: (val: string) => void;
  memberIds: string[] | undefined;
  searchQuery: string;
};

export const FilterMentions = observer(function FilterMentions(props: Props) {
  const { appliedFilters, handleUpdate, memberIds, searchQuery } = props;
  /**
   * Paginated render: only the first `itemsToRender` rows are mounted at a time so that large
   * rosters (e.g. workspaces with hundreds of members or labels) do not stall the dropdown's first
   * paint. The user clicks "Load More" to grow the slice.
   */
  // states
  const [itemsToRender, setItemsToRender] = useState(5);
  const [previewEnabled, setPreviewEnabled] = useState(true);
  // store hooks
  const { getUserDetails } = useMember();
  const { data: currentUser } = useUser();

  const appliedFiltersCount = appliedFilters?.length ?? 0;

  /**
   * Sort order: applied filters first, then the current user, then alphabetical — keeps active
   * filters and "me" pinned to the top so users can re-toggle them quickly without scrolling.
   */
  const sortedOptions = useMemo(() => {
    const filteredOptions = (memberIds || []).filter((memberId) =>
      getUserDetails(memberId)?.display_name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return sortBy(filteredOptions, [
      (memberId) => !(appliedFilters ?? []).includes(memberId),
      (memberId) => memberId !== currentUser?.id,
      (memberId) => getUserDetails(memberId)?.display_name.toLowerCase(),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  const handleViewToggle = () => {
    if (!sortedOptions) return;

    if (itemsToRender === sortedOptions.length) setItemsToRender(5);
    else setItemsToRender(sortedOptions.length);
  };

  return (
    <>
      <FilterHeader
        title={`Mention${appliedFiltersCount > 0 ? ` (${appliedFiltersCount})` : ""}`}
        isPreviewEnabled={previewEnabled}
        handleIsPreviewEnabled={() => setPreviewEnabled(!previewEnabled)}
      />
      {previewEnabled && (
        <div>
          {sortedOptions ? (
            sortedOptions.length > 0 ? (
              <>
                {sortedOptions.slice(0, itemsToRender).map((memberId) => {
                  const member = getUserDetails(memberId);

                  if (!member) return null;
                  return (
                    <FilterOption
                      key={`mentions-${member.id}`}
                      isChecked={appliedFilters?.includes(member.id) ? true : false}
                      onClick={() => handleUpdate(member.id)}
                      icon={
                        <Avatar
                          name={member?.display_name}
                          src={getFileURL(member?.avatar_url)}
                          showTooltip={false}
                          size={"md"}
                        />
                      }
                      title={currentUser?.id === member.id ? "You" : member?.display_name}
                    />
                  );
                })}
                {sortedOptions.length > 5 && (
                  <button
                    type="button"
                    className="ml-8 text-11 font-medium text-accent-primary"
                    onClick={handleViewToggle}
                  >
                    {itemsToRender === sortedOptions.length ? "View less" : "View all"}
                  </button>
                )}
              </>
            ) : (
              <p className="text-11 text-placeholder italic">No matches found</p>
            )
          ) : (
            <Loader className="space-y-2">
              <Loader.Item height="20px" />
              <Loader.Item height="20px" />
              <Loader.Item height="20px" />
            </Loader>
          )}
        </div>
      )}
    </>
  );
});
