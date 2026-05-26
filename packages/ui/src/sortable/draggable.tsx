/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Wrapper component making children draggable via the Atlaskit `@atlaskit/pragmatic-drag-and-drop` library.
 *
 * Combines a `draggable` source and a `dropTargetForElements` target on the same DOM node so
 * each list item can be both picked up and dropped onto. Uses `attachClosestEdge` /
 * `extractClosestEdge` from the hitbox helper so the parent `Sortable` component can read
 * the edge (top or bottom) the pointer was nearest at drop time and compute the correct
 * insertion index.
 */

// @ts-expect-error Due to live server dependencies
import { combine } from "@atlaskit/pragmatic-drag-and-drop/dist/cjs/entry-point/combine.js";
import {
  draggable,
  dropTargetForElements,
  // @ts-expect-error Due to live server dependencies
} from "@atlaskit/pragmatic-drag-and-drop/dist/cjs/entry-point/element/adapter.js";
import {
  attachClosestEdge,
  extractClosestEdge,
  // @ts-expect-error Due to live server dependencies
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/dist/cjs/closest-edge.js";
import { isEqual } from "lodash-es";
import React, { useEffect, useRef, useState } from "react";
import { DropIndicator } from "../drop-indicator";
import { cn } from "../utils";

type Props = {
  children: React.ReactNode;
  data: any; //@todo make this generic
  className?: string;
};

/**
 * Wraps children to act as both a drag source and a drop target for Atlaskit pragmatic-drag-and-drop.
 *
 * The same DOM node is registered as a `draggable` and a `dropTargetForElements` because the
 * sortable reorder pattern requires every list item to accept drops from its siblings. The
 * `canDrop` predicate compares payload equality (rejecting self-drops via `lodash-es.isEqual`)
 * and matches the shared `__uuid__` token set by the parent `Sortable` so items from a
 * different list mounted on the same page cannot be moved here.
 *
 * Drag feedback is rendered via two `<DropIndicator>` siblings — one above and one below the
 * children — and is shown based on whether `attachClosestEdge`/`extractClosestEdge` report the
 * pointer as nearest to the top or bottom edge. The wrapper element fades to `opacity-25`
 * while the item is being dragged.
 *
 * Props (see local `Props` type):
 *   - `children`: the rendered list item content.
 *   - `data`: payload exchanged with the drop target; must carry the `__uuid__` token set by
 *     the parent `Sortable` (the inline `//@todo make this generic` annotates the intentional
 *     looseness of this type).
 *   - `className`: extra Tailwind classes merged onto the wrapper `div`.
 *
 * Accessibility: Atlaskit pragmatic-drag-and-drop emits ARIA live-region announcements during
 * drag operations. INTENT UNCLEAR: no explicit keyboard drag-and-drop bindings (e.g., Space
 * to pick up, arrow keys to move) are wired in this wrapper; keyboard support depends entirely
 * on what the Atlaskit element adapter provides out of the box.
 */
function Draggable({ children, data, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<boolean>(false); // NEW
  const [isDraggedOver, setIsDraggedOver] = useState(false);

  const [closestEdge, setClosestEdge] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;

    if (el) {
      combine(
        draggable({
          element: el,
          onDragStart: () => setDragging(true), // NEW
          onDrop: () => setDragging(false), // NEW
          getInitialData: () => data,
        }),
        dropTargetForElements({
          element: el,
          // @ts-expect-error Due to live server dependencies
          onDragEnter: (args) => {
            setIsDraggedOver(true);
            setClosestEdge(extractClosestEdge(args.self.data));
          },
          onDragLeave: () => setIsDraggedOver(false),
          onDrop: () => {
            setIsDraggedOver(false);
          },
          // @ts-expect-error Due to live server dependencies
          canDrop: ({ source }) => !isEqual(source.data, data) && source.data.__uuid__ === data.__uuid__,
          // @ts-expect-error Due to live server dependencies
          getData: ({ input, element }) =>
            attachClosestEdge(data, {
              input,
              element,
              allowedEdges: ["top", "bottom"],
            }),
        })
      );
    }
  }, [data]);

  return (
    <div ref={ref} className={cn(dragging && "opacity-25", className)}>
      {<DropIndicator isVisible={isDraggedOver && closestEdge === "top"} />}
      {children}
      {<DropIndicator isVisible={isDraggedOver && closestEdge === "bottom"} />}
    </div>
  );
}

export { Draggable };
