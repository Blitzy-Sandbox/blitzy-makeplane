/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Foundational layout primitives (items, groups, drag-and-drop, render props, configs, component props) shared by every base layout adapter under `apps/web/core/components/base-layouts/` (`list/`, `kanban/`, `gantt/`).
 */

import type { ReactNode } from "react";

// Base Types

/**
 * Minimum-contract item rendered by the base layout system — concrete domain types (`TIssue`, `ICycle`, etc.) extend it via the open index signature while keeping `id: string`.
 */
export interface IBaseLayoutsBaseItem {
  id: string;
  [key: string]: unknown;
}

/**
 * Group/swimlane/column descriptor — `icon` accepts pre-rendered React nodes, `payload` is opaque metadata for render-prop callbacks, and `count` may exceed `groupedItemIds[group.id].length` under pagination.
 */
export interface IBaseLayoutsBaseGroup {
  id: string;
  name: string;
  icon?: ReactNode;
  payload?: Record<string, unknown>;
  count?: number;
}

// Drag & Drop Types

/**
 * Shared drag-and-drop wiring composed into all layout/group/item props — `enableDragDrop` is the master switch (when falsy neither `onDrop` nor `canDrag` runs), and `destinationId === null` in `onDrop` signals "end of destination group".
 */
export interface IDragDropHandlers<T extends IBaseLayoutsBaseItem> {
  enableDragDrop?: boolean;
  onDrop?: (
    sourceId: string,
    destinationId: string | null,
    sourceGroupId: string,
    destinationGroupId: string
  ) => Promise<void>;
  canDrag?: (item: T) => boolean;
}

// Render Props

/**
 * Render-prop contract for the consumer-supplied per-item renderer; `groupId` is passed so the same renderer can specialize per group (e.g. column-level selection styling).
 */
export interface IItemRenderProps<T extends IBaseLayoutsBaseItem> {
  renderItem: (item: T, groupId: string) => ReactNode;
}

/**
 * Group-collapse contract reused by every group-header consumer; `onToggleGroup` receives `groupId` so one callback can serve every group rendered.
 */
export interface IGroupHeaderControls {
  isCollapsed: boolean;
  onToggleGroup: (groupId: string) => void;
}

/**
 * Props passed to the `renderGroupHeader` callback in `apps/web/core/components/base-layouts/{list,kanban}/group-header.tsx`; `itemCount` falls back to `groupedItemIds[group.id].length` when `IBaseLayoutsBaseGroup.count` is not provided.
 */
export interface IGroupHeaderProps extends IGroupHeaderControls {
  group: IBaseLayoutsBaseGroup;
  itemCount: number;
}

/**
 * Render-prop contract for the optional group-header renderer; when `renderGroupHeader` is omitted layouts render their own default header (or none, per-layout decision).
 */
export interface IGroupRenderProps {
  renderGroupHeader?: (props: IGroupHeaderProps) => ReactNode;
}

/**
 * Combined render-prop contract (item + optional group-header) kept flat so layouts accept both renderers in one prop object; gantt extends a `Omit<…>` of this and replaces `renderItem` with `renderBlock`.
 */
export interface IRenderProps<T extends IBaseLayoutsBaseItem> extends IItemRenderProps<T>, IGroupRenderProps {}

// Layout Configuration

/**
 * Base-layout discriminant (`"list" | "kanban" | "gantt"`) used as both a runtime key and a compile-time narrowing tag by `LayoutSwitcher` in `apps/web/core/components/base-layouts/layout-switcher.tsx` and the `BASE_LAYOUTS` map in `constants.ts`.
 */
export type TBaseLayoutType = "list" | "kanban" | "gantt";

/**
 * Layout-switcher option descriptor used by `BASE_LAYOUTS` in `apps/web/core/components/base-layouts/constants.ts`; `icon` is an uninstantiated SVG component (e.g., a `lucide-react` icon) that the switcher instantiates inline.
 */
export interface IBaseLayoutConfig {
  key: TBaseLayoutType;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
}

// Base Layout Props
/**
 * Top-level props for any base layout (list/kanban/gantt) — `items` is a flat id-keyed map and `groupedItemIds` provides per-group ordering so items are not duplicated across groups.
 * Composes `IDragDropHandlers` + `IRenderProps`; the gantt variant extends an `Omit<…>` of this and replaces `renderItem` with `renderBlock`.
 */
export interface IBaseLayoutsBaseProps<T extends IBaseLayoutsBaseItem> extends IDragDropHandlers<T>, IRenderProps<T> {
  items: Record<string, T>;
  groupedItemIds: Record<string, string[]>;
  groups: IBaseLayoutsBaseGroup[];

  collapsedGroups?: string[];
  onToggleGroup?: (groupId: string) => void;

  isLoading?: boolean;
  loadMoreItems?: (groupId: string) => void;

  showEmptyGroups?: boolean;
  className?: string;
}

// Group Props

/**
 * Per-group rendering subcomponent props (one list section or one kanban column) that compose `IDragDropHandlers` + `IRenderProps`; extended by `IBaseLayoutsListGroupProps` / `IBaseLayoutsKanbanGroupProps`.
 */
export interface IBaseLayoutsBaseGroupProps<T extends IBaseLayoutsBaseItem>
  extends IDragDropHandlers<T>, IRenderProps<T> {
  group: IBaseLayoutsBaseGroup;
  itemIds: string[];
  items: Record<string, T>;
  isCollapsed: boolean;
  onToggleGroup: (groupId: string) => void;
  loadMoreItems?: (groupId: string) => void;
}

// Item Props

/**
 * Individual item subcomponent props (one list row or one kanban card); composes `IDragDropHandlers` + `IItemRenderProps` but intentionally excludes `IGroupRenderProps` since items do not render group headers.
 * `index` is the zero-based position within `itemIds` (used for drag-sort math) and `isLast === true` suppresses trailing separators/borders.
 */
export interface IBaseLayoutsBaseItemProps<T extends IBaseLayoutsBaseItem>
  extends IDragDropHandlers<T>, IItemRenderProps<T> {
  item: T;
  index: number;
  groupId: string;
  isLast: boolean;
}
