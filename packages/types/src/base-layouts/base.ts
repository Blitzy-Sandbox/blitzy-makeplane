/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Foundational layout primitive types shared across the `list`, `kanban`, and `gantt`
 * base layouts.
 *
 * Standardizes reusable contracts (items, groups, drag-and-drop, render props, layout
 * configuration, and component props) so every layout adapter (`./list`, `./kanban`,
 * `./gantt`) builds on a single consistent typing model rather than redefining shapes.
 *
 * Consumers: `apps/web/core/components/base-layouts/` (and its `list/`, `kanban/`,
 * `gantt/` subdirectories), plus `apps/web/core/components/base-layouts/layout-switcher.tsx`
 * (which consumes `TBaseLayoutType`) and `apps/web/core/components/base-layouts/constants.ts`
 * (which consumes `IBaseLayoutConfig`).
 */

import type { ReactNode } from "react";

// Base Types

/**
 * Minimal contract for any item rendered by the base layout system (issue, cycle, module, etc.).
 *
 * The layout system is generic over `T extends IBaseLayoutsBaseItem`, so every renderable
 * item must at minimum carry a string `id`; concrete domain types (e.g. `TIssue`, `ICycle`)
 * extend this shape via the index signature without redeclaring known fields.
 *
 * Consumers: every layout adapter (`./list`, `./kanban`, `./gantt`) and every component
 * under `apps/web/core/components/base-layouts/`.
 *
 * Fields with non-obvious semantics:
 * - `[key: string]: unknown` — index signature; concrete domain types extending this
 *   interface MUST keep `id` typed as `string` and may add any additional fields.
 */
export interface IBaseLayoutsBaseItem {
  id: string;
  [key: string]: unknown;
}

/**
 * Shape describing a group / swimlane / column in the layout (e.g. a state-based group
 * of issues).
 *
 * Consumers: every layout adapter and the per-group rendering subcomponents.
 *
 * Fields with non-obvious semantics:
 * - `icon`: optional pre-rendered icon for the group header; lets callers supply
 *   component-based icons rather than icon-name strings.
 * - `payload`: opaque group metadata available to render-prop callbacks; the layout core
 *   does not interpret it.
 * - `count`: total item count for display; may differ from `groupedItemIds[group.id].length`
 *   when pagination is in effect.
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
 * Drag-and-drop enablement contract reused across all base layouts.
 *
 * Centralizes the opt-in toggle, `onDrop` callback, and `canDrag` predicate so every
 * layout consumes the same drag-and-drop wiring rather than reimplementing it.
 *
 * Consumers: composed into `IBaseLayoutsBaseProps`, `IBaseLayoutsBaseGroupProps`, and
 * `IBaseLayoutsBaseItemProps` (all three of the top-level component prop contracts).
 *
 * Fields with non-obvious semantics:
 * - `enableDragDrop`: master switch; when `false` or `undefined`, neither `onDrop` nor
 *   `canDrag` is invoked by the layout.
 * - `onDrop`: async drop callback; `destinationId` is `null` when the drop target is the
 *   end of the destination group (i.e. dropping at the bottom of a column / list).
 * - `canDrag`: per-item drag predicate; consulted by the drag layer to gate `onDragStart`.
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
 * Render-prop contract for the consumer-supplied per-item renderer.
 *
 * Consumers: `IRenderProps`, `IBaseLayoutsBaseItemProps`, and the list / kanban / gantt
 * render-prop chains.
 *
 * Fields with non-obvious semantics:
 * - `renderItem`: required render callback; `groupId` is supplied so the renderer can
 *   vary by group context (e.g. highlight selection within a column).
 */
export interface IItemRenderProps<T extends IBaseLayoutsBaseItem> {
  renderItem: (item: T, groupId: string) => ReactNode;
}

/**
 * Collapse / toggle state contract shared by every group-header consumer.
 *
 * Consumers: composed into `IGroupHeaderProps`, and indirectly into `IBaseLayoutsBaseProps`
 * via `IRenderProps` / `IGroupRenderProps`.
 *
 * Fields with non-obvious semantics:
 * - `isCollapsed`: current collapse state for the specific group being rendered.
 * - `onToggleGroup`: toggle invoker; receives the group id so the same callback can
 *   serve multiple groups.
 */
export interface IGroupHeaderControls {
  isCollapsed: boolean;
  onToggleGroup: (groupId: string) => void;
}

/**
 * Props passed to the consumer-supplied `renderGroupHeader` callback.
 *
 * Extends `IGroupHeaderControls` because the header renderer needs both the collapse
 * state and the group data + item count to render itself.
 *
 * Consumers: `renderGroupHeader` implementations in
 * `apps/web/core/components/base-layouts/list/group-header.tsx` and
 * `apps/web/core/components/base-layouts/kanban/group-header.tsx`.
 *
 * Fields with non-obvious semantics:
 * - `itemCount`: number of items in the group; sourced from
 *   `IBaseLayoutsBaseGroup.count` when present, else from `groupedItemIds[group.id].length`.
 */
export interface IGroupHeaderProps extends IGroupHeaderControls {
  group: IBaseLayoutsBaseGroup;
  itemCount: number;
}

/**
 * Render-prop contract for the optional consumer-supplied group-header renderer.
 *
 * Consumers: composed into `IRenderProps`; consumed by every layout adapter.
 *
 * Fields with non-obvious semantics:
 * - `renderGroupHeader`: optional override; when omitted, layouts may render a default
 *   group header or none at all (per-layout decision).
 */
export interface IGroupRenderProps {
  renderGroupHeader?: (props: IGroupHeaderProps) => ReactNode;
}

/**
 * Combined render-prop contract — the per-item renderer plus the optional group-header
 * renderer in a single shape.
 *
 * Every layout root accepts both renderers together; combining the two interfaces keeps
 * the layout prop signature flat instead of forcing callers to pass nested render-prop
 * objects.
 *
 * Consumers: `IBaseLayoutsBaseProps`, `IBaseLayoutsBaseGroupProps`, plus
 * `IBaseLayoutsGanttProps` (which omits `renderItem` and replaces it with `renderBlock`).
 */
export interface IRenderProps<T extends IBaseLayoutsBaseItem> extends IItemRenderProps<T>, IGroupRenderProps {}

// Layout Configuration

/**
 * Discriminant union enumerating the three supported base layouts: `"list"`, `"kanban"`,
 * `"gantt"`.
 *
 * Modeled as a string-literal union so it serves both as a runtime-comparable key and
 * as a compile-time discriminant for layout-switcher logic.
 *
 * Valid values: `"list"`, `"kanban"`, `"gantt"`.
 *
 * Consumers: `IBaseLayoutConfig.key`, `LayoutSwitcher` in
 * `apps/web/core/components/base-layouts/layout-switcher.tsx`, and the `BASE_LAYOUTS`
 * config map in `apps/web/core/components/base-layouts/constants.ts`.
 */
export type TBaseLayoutType = "list" | "kanban" | "gantt";

/**
 * Descriptor used by the layout-switcher UI to render one selectable layout option.
 *
 * Consumers: the `BASE_LAYOUTS` array in
 * `apps/web/core/components/base-layouts/constants.ts`, consumed by `LayoutSwitcher` in
 * `apps/web/core/components/base-layouts/layout-switcher.tsx`.
 *
 * Fields with non-obvious semantics:
 * - `key`: the `TBaseLayoutType` discriminant identifying which layout this entry
 *   represents (and used to render the switcher's active state).
 * - `icon`: uninstantiated SVG component (e.g. a `lucide-react` icon); the switcher
 *   instantiates it inline.
 * - `label`: human-readable label, typically translated via `@plane/i18n` before rendering.
 */
export interface IBaseLayoutConfig {
  key: TBaseLayoutType;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
}

// Base Layout Props
/**
 * Top-level props contract for any base layout component — list, kanban, and gantt all
 * extend or specialize this shape.
 *
 * Composes `IDragDropHandlers` + `IRenderProps` because every layout supports the same
 * opt-in drag/drop and the same render-prop contracts.
 *
 * Consumers: `IBaseLayoutsListProps` and `IBaseLayoutsKanbanProps` alias or extend this;
 * `IBaseLayoutsGanttProps` extends an `Omit<…>` of this (replacing `renderItem` with
 * `renderBlock`).
 *
 * Fields with non-obvious semantics:
 * - `items`: id-keyed map of all items; layouts look up items by id via `groupedItemIds`
 *   to avoid duplicating item objects per group.
 * - `groupedItemIds`: group-id → ordered array of item ids; the source of rendering
 *   order within each group.
 * - `groups`: the ordered list of groups to render (column / row order).
 * - `collapsedGroups`: group ids currently in the collapsed state; layouts compare each
 *   group id against this list to determine `isCollapsed` per group.
 * - `onToggleGroup`: global collapse-toggle handler; layouts forward this to each
 *   group's header.
 * - `isLoading`: when true, layouts render loader chrome instead of (or in addition to)
 *   group / item content.
 * - `loadMoreItems`: optional per-group "load more" callback; consumed by infinite-scroll
 *   sentinel logic inside the layout body.
 * - `showEmptyGroups`: when false, groups with zero items are skipped by the renderer.
 * - `className`: passthrough class applied to the layout root element.
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
 * Props contract for an individual group's rendering subcomponent — e.g. a single list
 * section or a single kanban column.
 *
 * Per-group subcomponents need the same drag/drop handlers and item renderer as the
 * top-level layout, which is why `IDragDropHandlers` + `IRenderProps` are required at
 * this level as well.
 *
 * Consumers: the list `BaseListGroup` and kanban `BaseKanbanGroup` prop types extend
 * this (via `IBaseLayoutsListGroupProps` / `IBaseLayoutsKanbanGroupProps`).
 *
 * Fields with non-obvious semantics:
 * - `itemIds`: ordered ids of items belonging to this group (a slice of
 *   `groupedItemIds[group.id]` from the parent layout).
 * - `items`: the same id-keyed map as the parent layout; passed through so the group
 *   can resolve items without lifting state.
 * - `isCollapsed`: concrete collapse state for this specific group, derived from
 *   `IBaseLayoutsBaseProps.collapsedGroups`.
 * - `loadMoreItems`: per-group load-more callback; forwarded down so the group can
 *   attach it to its own sentinel.
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
 * Props contract for an individual item subcomponent — e.g. a single list row or a
 * single kanban card.
 *
 * Composes `IDragDropHandlers` + `IItemRenderProps` but intentionally NOT
 * `IGroupRenderProps`: items do not render group headers, so the group-header
 * render-prop is deliberately omitted at this level.
 *
 * Consumers: `IBaseLayoutsListItemProps` and `IBaseLayoutsKanbanItemProps` alias types.
 *
 * Fields with non-obvious semantics:
 * - `index`: zero-based position of this item within its group's `itemIds` array; used
 *   for drag-and-drop sort calculations.
 * - `groupId`: identifier of the parent group; passed to `renderItem` so the renderer
 *   can specialize per group.
 * - `isLast`: true when this item is the final entry in its group; consumers use this
 *   to suppress trailing separators / borders.
 */
export interface IBaseLayoutsBaseItemProps<T extends IBaseLayoutsBaseItem>
  extends IDragDropHandlers<T>, IItemRenderProps<T> {
  item: T;
  index: number;
  groupId: string;
  isLast: boolean;
}
