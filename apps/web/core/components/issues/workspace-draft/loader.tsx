/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Skeleton loader shown while the workspace-draft list is loading.
 *
 * Rendered purpose: stacks `ListLoaderItemRow` skeletons in the same row dimensions as
 * the real `DraftIssueBlock` so the page does not visually reflow when the data resolves.
 *
 * Props (`TWorkspaceDraftIssuesLoader`):
 *   - items (number, optional, default=14): number of skeleton rows to render
 *
 * MobX stores read: none — this is a purely presentational skeleton.
 *
 * Side effects: none.
 *
 * Consumers:
 *   - `apps/web/core/components/issues/workspace-draft/root.tsx` (rendered between SWR fetches)
 */

import { range } from "lodash-es";
// components
import { ListLoaderItemRow } from "@/components/ui/loader/layouts/list-layout-loader";

type TWorkspaceDraftIssuesLoader = {
  items?: number;
};

export function WorkspaceDraftIssuesLoader(props: TWorkspaceDraftIssuesLoader) {
  const { items = 14 } = props;
  return (
    <div className="relative h-full w-full">
      {range(items).map((index) => (
        <ListLoaderItemRow key={index} />
      ))}
    </div>
  );
}
