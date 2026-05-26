/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Tab-list header renderer for the `Tabs` composition, controlling tab strip layout and styling.
 *
 * Exports `TabList` (the component) and `TabListItem` (its tab-entry contract); the
 * local `TabListInner` helper holds the HeadlessUI rendering so `TabList` can optionally
 * wrap itself in a `<Tab.Group>` for standalone use.
 */

import { Tab } from "@headlessui/react";
import type { LucideProps } from "lucide-react";
import type { FC } from "react";
import React from "react";
// helpers
import { cn } from "../utils";

/**
 * Header entry contract for a single tab in the tab strip — defines the unique `key`,
 * optional `icon`/`label`, `disabled` state, and per-tab `onClick` callback.
 */
export type TabListItem = {
  key: string;
  icon?: FC<LucideProps>;
  label?: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
};

type TTabListProps = {
  tabs: TabListItem[];
  tabListClassName?: string;
  tabClassName?: string;
  size?: "sm" | "md" | "lg";
  selectedTab?: string;
  autoWrap?: boolean;
  onTabChange?: (key: string) => void;
};

/**
 * Renders the visible tab strip for the `Tabs` composition; split out from `tabs.tsx`
 * so the strip can be styled and reused independently without touching the underlying
 * HeadlessUI logic.
 *
 * Accessibility (`role="tablist"`, `role="tab"`, arrow-key / Home / End navigation, and
 * focus management) is inherited from HeadlessUI's `<Tab.List>` and `<Tab>` primitives;
 * the selected tab is visually marked via the `shadow-sm bg-layer-transparent-active
 * text-primary` class set.
 *
 * @param tabs - Tab definitions to render (required). Each entry must carry a unique `key`.
 * @param tabListClassName - Optional class string merged onto the outer `<Tab.List>` strip
 *   wrapper for per-call style overrides.
 * @param tabClassName - Optional class string merged onto every individual `<Tab>` button.
 * @param size - Display size knob (`"sm" | "md" | "lg"`, default `"md"`) that drives both
 *   label typography (`text-11` / `text-13` / `text-14`) and icon dimensions
 *   (`size-3` / `size-4` / `size-5`).
 * @param selectedTab - Optional controlled-selection override; when provided the tab whose
 *   `key` matches gets the selected styling regardless of HeadlessUI's internal
 *   `<Tab.Group>` selection state, so external state (e.g., a URL param or parent store)
 *   can drive selection instead of the Tab.Group's own state.
 * @param autoWrap - Whether to wrap the inner strip in a `<Tab.Group>` (default `true`).
 *   The default lets `TabList` be used standalone; pass `false` when an ancestor already
 *   provides a `<Tab.Group>` (e.g., the parent `Tabs` composition) to avoid nested groups.
 * @param onTabChange - Optional callback invoked with the clicked tab's `key` before the
 *   per-tab `onClick` fires; both callbacks are skipped when the tab is `disabled`.
 */
export function TabList({ autoWrap = true, ...props }: TTabListProps) {
  return autoWrap ? (
    <Tab.Group>
      <TabListInner {...props} />
    </Tab.Group>
  ) : (
    <TabListInner {...props} />
  );
}

/**
 * Inner renderer that expects an enclosing `<Tab.Group>` context, supplied either by
 * `TabList`'s `autoWrap = true` branch or by `tabs.tsx`'s top-level `<Tab.Group>`.
 */
function TabListInner({ tabs, tabListClassName, tabClassName, size = "md", selectedTab, onTabChange }: TTabListProps) {
  return (
    <Tab.List
      as="div"
      className={cn(
        "flex w-full min-w-fit items-center justify-between gap-1.5 rounded-md bg-layer-1 p-0.5 text-13",
        tabListClassName
      )}
    >
      {tabs.map((tab) => (
        <Tab
          className={({ selected }) =>
            cn(
              "flex w-full min-w-fit cursor-pointer items-center justify-center rounded-sm p-1 font-medium text-primary transition-all outline-none focus:outline-none",
              (selectedTab ? selectedTab === tab.key : selected)
                ? "shadow-sm bg-layer-transparent-active text-primary"
                : tab.disabled
                  ? "cursor-not-allowed text-placeholder"
                  : "text-placeholder hover:bg-layer-transparent-hover hover:text-tertiary",
              {
                "text-11": size === "sm",
                "text-13": size === "md",
                "text-14": size === "lg",
              },
              tabClassName
            )
          }
          key={tab.key}
          onClick={() => {
            if (!tab.disabled) {
              onTabChange?.(tab.key);
              tab.onClick?.();
            }
          }}
          disabled={tab.disabled}
        >
          {tab.icon && (
            <tab.icon className={cn({ "size-3": size === "sm", "size-4": size === "md", "size-5": size === "lg" })} />
          )}
          {tab.label}
        </Tab>
      ))}
    </Tab.List>
  );
}
