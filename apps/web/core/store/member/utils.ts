/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared pure utilities for member filtering and sorting.
 *
 * This module is intentionally MobX-free: every export is a pure function (or
 * a structural type) so the same comparator/filter logic is used by both
 * project- and workspace-scoped member stores without duplication. It is
 * imported by:
 *   - apps/web/core/store/member/project/project-member-filters.store.ts
 *       (uses sortProjectMembers and IMemberFilters)
 *   - apps/web/core/store/member/project/base-project-member.store.ts
 *       (uses sortProjectMembers via the project filter store)
 *   - apps/web/core/store/member/workspace/workspace-member-filters.store.ts
 *       (uses sortWorkspaceMembers and IMemberFilters)
 *   - apps/web/core/store/member/workspace/workspace-member.store.ts
 *       (uses sortWorkspaceMembers)
 *
 * Behavioral contracts captured here that callers depend on:
 *   - All sort helpers are immutable: they return a NEW array (via `[...m].sort`)
 *     so MobX observable arrays are never mutated in place.
 *   - Invalid or missing `joining_date` sorts as `new Date(0)` (oldest) so
 *     members without a joining date appear last in ascending order.
 *   - Workspace suspended members (`is_active === false`) are excluded from
 *     normal role filters and are only returned when the literal string
 *     `"suspended"` is present in `filters.roles`.
 */
import type { EUserPermissions, TMemberOrderByOptions } from "@plane/constants";
import type { IUserLite, TProjectMembership } from "@plane/types";

/**
 * Shared filter shape used by both project and workspace member filter stores.
 * `order_by` is a member ordering token (e.g. `"display_name"`, `"-joining_date"`);
 * `roles` is an array of role discriminants (and the literal `"suspended"` is a
 * special workspace-only value handled by filterWorkspaceMembersByRole).
 */
export interface IMemberFilters {
  order_by?: TMemberOrderByOptions;
  roles?: string[];
}

/**
 * Parse a member-ordering token into a `{ field, direction }` descriptor.
 * Defaults to `display_name` ascending when no token is provided; a leading
 * `-` marks descending order (e.g. `-joining_date` → `{ field: "joining_date",
 * direction: "desc" }`).
 */
export const parseOrderKey = (orderKey?: TMemberOrderByOptions): { field: string; direction: "asc" | "desc" } => {
  // Default to sorting by display_name in ascending order when no order key is provided
  if (!orderKey) {
    return {
      field: "display_name",
      direction: "asc",
    };
  }

  const isDescending = orderKey.startsWith("-");
  const field = isDescending ? orderKey.slice(1) : orderKey;
  return {
    field,
    direction: isDescending ? "desc" : "asc",
  };
};

/**
 * Extract a comparison key from a member's `IUserLite` profile for the given
 * field. Supports `display_name`, `full_name`, `email`, `joining_date` (Date),
 * and `role`. Missing/invalid joining dates return `new Date(0)` so they sort
 * last under ascending order.
 */
export const getMemberSortKey = (memberDetails: IUserLite, field: string, memberRole?: string): string | Date => {
  switch (field) {
    case "display_name":
      return memberDetails.display_name?.toLowerCase() || "";
    case "full_name": {
      const firstName = memberDetails.first_name || "";
      const lastName = memberDetails.last_name || "";
      return `${firstName} ${lastName}`.toLowerCase().trim();
    }
    case "email":
      return memberDetails.email?.toLowerCase() || "";
    case "joining_date": {
      if (!memberDetails.joining_date) {
        // Return a very old date for missing dates to sort them last
        return new Date(0);
      }
      const date = new Date(memberDetails.joining_date);
      // Return a very old date for invalid dates to sort them last
      return isNaN(date.getTime()) ? new Date(0) : date;
    }
    case "role":
      return (memberRole ?? "").toString().toLowerCase();
    default:
      return "";
  }
};

/**
 * Filter project memberships by role. Falls back to `original_role` when the
 * current role is undefined. An empty `roleFilters` array returns the input
 * unchanged.
 */
export const filterProjectMembersByRole = (
  members: TProjectMembership[],
  roleFilters: string[]
): TProjectMembership[] => {
  if (roleFilters.length === 0) return members;

  return members.filter((member) => {
    const memberRole = String(member.role ?? member.original_role ?? "");
    return roleFilters.includes(memberRole);
  });
};

/**
 * Filter workspace members by role with special handling for suspended users:
 * when `is_active === false` the member is treated as suspended and is included
 * only if `"suspended"` is in `roleFilters`. Active members match against the
 * remaining (non-suspended) filter entries.
 */
export const filterWorkspaceMembersByRole = <T extends { role: string | EUserPermissions; is_active?: boolean }>(
  members: T[],
  roleFilters: string[]
): T[] => {
  if (roleFilters.length === 0) return members;

  return members.filter((member) => {
    const memberRole = String(member.role ?? "");
    const isSuspended = member.is_active === false;

    // Check if suspended is in the role filters
    const hasSuspendedFilter = roleFilters.includes("suspended");
    // Get non-suspended role filters
    const activeRoleFilters = roleFilters.filter((role) => role !== "suspended");

    // For suspended users, include them only if suspended filter is selected
    if (isSuspended) {
      return hasSuspendedFilter;
    }

    // For active users, include them only if their role matches any active role filter
    return activeRoleFilters.includes(memberRole);
  });
};

/**
 * Immutable, generic member sort. Returns the input untouched when `orderBy`
 * is omitted; otherwise produces a new array sorted by the field extracted via
 * `getMemberSortKey`. `joining_date` is compared numerically (invalid dates
 * treated as `0`); all other fields use `localeCompare` for stable alphabetical
 * order. Descending direction is applied by negating the comparison result.
 */
export const sortMembers = <T>(
  members: T[],
  memberDetailsMap: Record<string, IUserLite>,
  getMemberKey: (member: T) => string,
  getMemberRole: (member: T) => string,
  orderBy?: TMemberOrderByOptions
): T[] => {
  if (!orderBy) return members;

  const { field, direction } = parseOrderKey(orderBy);

  return [...members].sort((a, b) => {
    const aKey = getMemberKey(a);
    const bKey = getMemberKey(b);
    const aMemberDetails = memberDetailsMap[aKey];
    const bMemberDetails = memberDetailsMap[bKey];

    if (!aMemberDetails || !bMemberDetails) return 0;

    const aRole = getMemberRole(a);
    const bRole = getMemberRole(b);

    const aValue = getMemberSortKey(aMemberDetails, field, aRole);
    const bValue = getMemberSortKey(bMemberDetails, field, bRole);

    let comparison = 0;

    if (field === "joining_date") {
      // For dates, we need to handle Date objects and ensure they're valid
      const aDate = aValue instanceof Date ? aValue : new Date(aValue);
      const bDate = bValue instanceof Date ? bValue : new Date(bValue);

      // Handle invalid dates by treating them as very old dates
      const aTime = isNaN(aDate.getTime()) ? 0 : aDate.getTime();
      const bTime = isNaN(bDate.getTime()) ? 0 : bDate.getTime();

      comparison = aTime - bTime;
    } else {
      // For strings, use localeCompare for proper alphabetical sorting
      const aStr = String(aValue);
      const bStr = String(bValue);
      comparison = aStr.localeCompare(bStr);
    }

    return direction === "desc" ? -comparison : comparison;
  });
};

/**
 * Convenience pipeline that applies `filterProjectMembersByRole` followed by
 * `sortMembers` for project memberships. Role extraction uses
 * `member.role ?? member.original_role ?? ""` so memberships carrying only an
 * original role still sort correctly.
 */
export const sortProjectMembers = (
  members: TProjectMembership[],
  memberDetailsMap: Record<string, IUserLite>,
  getMemberKey: (member: TProjectMembership) => string,
  filters?: IMemberFilters
): TProjectMembership[] => {
  // Apply role filtering first
  const filteredMembers =
    filters?.roles && filters.roles.length > 0 ? filterProjectMembersByRole(members, filters.roles) : members;

  // If no order_by filter, return filtered members
  if (!filters?.order_by) return filteredMembers;

  // Apply sorting
  return sortMembers(
    filteredMembers,
    memberDetailsMap,
    getMemberKey,
    (member) => String(member.role ?? member.original_role ?? ""),
    filters.order_by
  );
};

/**
 * Convenience pipeline that applies `filterWorkspaceMembersByRole` (which
 * honors the suspended-member semantic) followed by `sortMembers` for
 * workspace memberships. Role extraction uses `String(member.role ?? "")`.
 */
export const sortWorkspaceMembers = <T extends { role: string | EUserPermissions; is_active?: boolean }>(
  members: T[],
  memberDetailsMap: Record<string, IUserLite>,
  getMemberKey: (member: T) => string,
  filters?: IMemberFilters
): T[] => {
  const filteredMembers =
    filters?.roles && filters.roles.length > 0 ? filterWorkspaceMembersByRole(members, filters.roles) : members;

  // If no order_by filter, return filtered members
  if (!filters?.order_by) return filteredMembers;

  // Apply sorting
  return sortMembers(
    filteredMembers,
    memberDetailsMap,
    getMemberKey,
    (member) => String(member.role ?? ""),
    filters.order_by
  );
};
