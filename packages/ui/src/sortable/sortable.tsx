/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Drop-zone component providing reorder semantics for a list of items rendered via `Draggable`.
 *
 * Subscribes to Atlaskit pragmatic-drag-and-drop's element monitor, computes the insertion
 * index from the closest-edge metadata attached to the drop target, removes the dragged item
 * from its current slot, splices it into the new slot, and invokes the consumer-provided
 * `onChange` callback with the reordered list and the moved item.
 *
 * Atlaskit pragmatic DnD is chosen here for its minimal runtime footprint and broad browser
 * support relative to heavier alternatives such as react-dnd or react-beautiful-dnd.
 */

// @ts-expect-error Due to live server dependencies
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/dist/cjs/entry-point/element/adapter.js";
import React, { Fragment, useEffect, useMemo } from "react";
import { Draggable } from "./draggable";

/**
 * Item shape augmented with a transient `__uuid__` marker that identifies the logical list
 * the item belongs to. The marker is stripped from items before they are emitted via `onChange`
 * (see `moveItem` below) and is used by `Draggable.canDrop` to reject cross-list drops.
 */
type TEnhancedData<T> = T & { __uuid__?: string };

type Props<T> = {
  data: TEnhancedData<T>[];
  render: (item: T, index: number) => React.ReactNode;
  onChange: (data: T[], movedItem?: T) => void;
  keyExtractor: (item: T, index: number) => string;
  containerClassName?: string;
  id?: string;
};

/**
 * Computes the reordered list after a drag-and-drop reorder operation.
 *
 * Reads the Atlaskit `Symbol(closestEdge)` from the destination payload (set by
 * `attachClosestEdge` in `draggable.tsx`) to decide whether the moved item lands above or
 * below the drop target. The destination index is adjusted by -1 when the source originally
 * sits before the destination because the source item is spliced out first, which shifts
 * all subsequent indices by one.
 *
 * Returns the cleaned list with `__uuid__` markers stripped and the moved item without its
 * marker so consumers do not leak the transient bookkeeping field into application state.
 */
const moveItem = <T,>(
  data: TEnhancedData<T>[],
  source: TEnhancedData<T>,
  destination: TEnhancedData<T> & Record<symbol, string>,
  keyExtractor: (item: T, index: number) => string
): {
  newData: T[];
  movedItem: T | undefined;
} => {
  const sourceIndex = data.findIndex((item, index) => keyExtractor(item, index) === keyExtractor(source, 0));
  if (sourceIndex === -1) return { newData: data, movedItem: undefined };

  const destinationIndex = data.findIndex((item, index) => keyExtractor(item, index) === keyExtractor(destination, 0));

  if (destinationIndex === -1) return { newData: data, movedItem: undefined };

  const symbolKey = Reflect.ownKeys(destination).find((key) => key.toString() === "Symbol(closestEdge)");
  const position = symbolKey ? destination[symbolKey as symbol] : "bottom"; // Add 'as symbol' to cast symbolKey to symbol

  // Calculate final position before removing source item
  const finalIndex = position === "bottom" ? destinationIndex + 1 : destinationIndex;

  // Adjust for the fact that we're removing the source item first
  // If source is before destination, removing it shifts everything back by 1
  const adjustedDestinationIndex = finalIndex > sourceIndex ? finalIndex - 1 : finalIndex;

  const newData = [...data];
  const [movedItem] = newData.splice(sourceIndex, 1);

  // Insert at the calculated position (bounds check is implicit in splice)
  newData.splice(adjustedDestinationIndex, 0, movedItem);

  const { __uuid__: movedItemId, ...movedItemData } = movedItem;
  return {
    newData: newData.map((item) => {
      const { __uuid__: uuid, ...rest } = item;
      return rest as T;
    }),
    movedItem: movedItemData as T,
  };
};

/**
 * Sortable list container that renders `data` through the consumer's `render` callback,
 * wires each item to a `Draggable`, and orchestrates reorder operations via Atlaskit
 * pragmatic-drag-and-drop's element monitor.
 *
 * Each render-pass attaches a shared `__uuid__` token (the `id` prop, or a random base-36
 * string when omitted) to every item so that `Draggable.canDrop` can reject drops from a
 * different `Sortable` mounted on the same page — preventing cross-list moves without an
 * explicit allow-list.
 *
 * Props (see local `Props<T>` type):
 *   - `data`: items to render (also the source of truth for ordering).
 *   - `render`: per-item React node renderer (signature `(item, index) => ReactNode`).
 *   - `onChange`: invoked after a drop with the reordered list and the moved item.
 *   - `keyExtractor`: required stable key for each item (used as React key and to locate items in `moveItem`).
 *   - `containerClassName`: optional class forwarded to each child `<Draggable>`.
 *   - `id`: optional cross-render-stable list identifier; when omitted, a random per-render token is generated.
 *
 * Accessibility: Atlaskit pragmatic-drag-and-drop emits ARIA live-region announcements during
 * drag operations. INTENT UNCLEAR: no explicit keyboard-reorder bindings (e.g., Space to pick
 * up, arrow keys to move) are wired in this wrapper; keyboard support depends entirely on
 * what the Atlaskit element adapter provides out of the box.
 */
export function Sortable<T>({ data, render, onChange, keyExtractor, containerClassName, id }: Props<T>) {
  useEffect(() => {
    const unsubscribe = monitorForElements({
      // @ts-expect-error Due to live server dependencies
      onDrop({ source, location }) {
        const destination = location?.current?.dropTargets[0];
        if (!destination) return;
        const { newData, movedItem } = moveItem(
          data,
          source.data as TEnhancedData<T>,
          destination.data as TEnhancedData<T> & { closestEdge: string },
          keyExtractor
        );
        onChange(newData, movedItem);
      },
    });

    // Clean up the subscription on unmount
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [data, keyExtractor, onChange]);

  const enhancedData = useMemo(() => {
    const uuid = id ? id : Math.random().toString(36).substring(7);
    return data.map((item) => ({ ...item, __uuid__: uuid }));
  }, [data, id]);

  return (
    <>
      {data.map((item, index) => (
        <Draggable
          key={keyExtractor(enhancedData[index], index)}
          data={enhancedData[index]}
          className={containerClassName}
        >
          <Fragment>{render(item, index)}</Fragment>
        </Draggable>
      ))}
    </>
  );
}

export default Sortable;
