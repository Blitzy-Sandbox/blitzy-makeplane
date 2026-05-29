/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Thin adapter that maps an array of cycle IDs into a series of CyclesListItem
 * components, threading workspaceSlug and projectId through to each child and
 * using the cycle ID as the React key.
 *
 * Props:
 *   - cycleIds (string[], required): ordered list of cycle IDs to render; the
 *     output ordering matches the input ordering exactly.
 *   - projectId (string, required): forwarded to every rendered CyclesListItem
 *     for store lookups and navigation.
 *   - workspaceSlug (string, required): forwarded to every rendered
 *     CyclesListItem for store lookups, API calls, and link generation.
 *
 * MobX stores read: NONE — purely structural; observer wrapping happens inside
 * CyclesListItem so each row independently subscribes to its own cycle slice.
 *
 * Side effects: NONE — no API calls, navigations, mutations, or local state.
 * Renders an empty fragment when `cycleIds` is empty (no explicit empty-state UI;
 * the parent component is responsible for any zero-state messaging).
 *
 * Consumers: cycles/list/root.tsx (used for active-cycle archive, upcoming, and
 * completed sections).
 */

// components
import { CyclesListItem } from "./cycles-list-item";

type Props = {
  cycleIds: string[];
  projectId: string;
  workspaceSlug: string;
};

export function CyclesListMap(props: Props) {
  const { cycleIds, projectId, workspaceSlug } = props;

  return (
    <>
      {cycleIds.map((cycleId) => (
        <CyclesListItem key={cycleId} cycleId={cycleId} workspaceSlug={workspaceSlug} projectId={projectId} />
      ))}
    </>
  );
}
