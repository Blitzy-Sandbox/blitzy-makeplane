/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Empty-state surface for the profile work-item view (a user's profile page
 * listing their work items). The copy (title + description) is resolved
 * dynamically from translation keys derived from the active `profileViewId`
 * route segment (e.g. `profile.empty_state.<profileViewId>.title`).
 *
 * Hooks read:
 *   - useTranslation() (from `@plane/i18n`) — returns `t`
 *   - useParams() (from `next/navigation`) — returns the `profileViewId` segment
 *
 * No MobX stores are read here; this component is a pure route-aware adapter.
 *
 * Side effects: none — pure render. No mutations, no navigations, no API calls.
 *
 * NOTE: The existing in-file `// TODO` (preserved verbatim above the export)
 * acknowledges that the dynamic translation-key construction couples the
 * `profileViewId` route segment to a finite, enumerated set of i18n keys;
 * unmatched segments will surface as raw key strings rather than localized copy.
 *
 * Consumed by: `./index.tsx` (`IssueLayoutEmptyState`) when
 * `storeType === EIssuesStoreType.PROFILE`.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// components
import { useTranslation } from "@plane/i18n";
import { EmptyStateDetailed } from "@plane/propel/empty-state";

/**
 * Renders the profile work-item view empty state.
 *
 * Props: none — `profileViewId` is read from the route via `useParams()`.
 *
 * Returns `null` when `profileViewId` is absent (guards against off-route mounts).
 *
 * Translation keys consumed:
 *   - `profile.empty_state.<profileViewId>.title`
 *   - `profile.empty_state.<profileViewId>.description`
 *
 * Side effects: none.
 */
// TODO: If projectViewId changes, everything breaks. Figure out a better way to handle this.
export const ProfileViewEmptyState = observer(function ProfileViewEmptyState() {
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { profileViewId } = useParams();

  if (!profileViewId) return null;

  return (
    <EmptyStateDetailed
      assetKey="work-item"
      title={t(`profile.empty_state.${profileViewId.toString()}.title`)}
      description={t(`profile.empty_state.${profileViewId.toString()}.description`)}
    />
  );
});
