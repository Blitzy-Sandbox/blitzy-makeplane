/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Tabbed-content composition built on `@headlessui/react` `Tab.Group` with
 * optional local-storage persistence of the selected tab.
 *
 * Acts as the primary composition surface for the tabs feature: header
 * rendering is delegated to the sibling `./tab-list` (`TabList`), while panel
 * rendering uses `@headlessui/react`'s `Tab.Panel`. Active-tab persistence is
 * routed through `useLocalStorage` from `@plane/hooks` (first-party hook).
 */

import { Tab } from "@headlessui/react";
import React, { Fragment, useEffect, useState } from "react";
// helpers
import { useLocalStorage } from "@plane/hooks";
import { cn } from "../utils";
// types
import type { TabListItem } from "./tab-list";
import { TabList } from "./tab-list";

/**
 * Content slot for a single tab panel — wraps the `React.ReactNode` rendered
 * inside the active `<Tab.Panel>` of the parent `Tabs` composition.
 */
export type TabContent = {
  content: React.ReactNode;
};

/**
 * Full tab definition combining the header descriptor from `TabListItem`
 * (`key`, `label`, `icon`, `disabled`, `onClick`) with the panel `content`
 * slot from `TabContent`.
 */
export type TabItem = TabListItem & TabContent;

type TTabsProps = {
  tabs: TabItem[];
  storageKey?: string;
  actions?: React.ReactNode;
  defaultTab?: string;
  containerClassName?: string;
  tabListContainerClassName?: string;
  tabListClassName?: string;
  tabClassName?: string;
  tabPanelClassName?: string;
  size?: "sm" | "md" | "lg";
  storeInLocalStorage?: boolean;
};

/**
 * Tabbed interface that lets users switch between content panels, optionally
 * persisting the selected tab across sessions via `localStorage`.
 *
 * Local-storage persistence (WHY): preserves the user's selected tab across
 * page refreshes and route navigation for views with many sub-tabs (e.g.
 * issue detail tabs, project settings) — without persistence, every load
 * would reset to the default tab and force the user to re-navigate. The
 * storage key resolves to `tab-<storageKey>` when `storageKey` is provided,
 * otherwise it falls back to `tab-<tabs[0]?.key>`; the stored value is read
 * on mount and re-written whenever the selected tab changes (gated by
 * `storeInLocalStorage`, which defaults to `true`).
 *
 * Accessibility: ARIA semantics (`role="tablist"`, `role="tab"`,
 * `role="tabpanel"`) and keyboard navigation (Left/Right/Up/Down arrows,
 * Home, End) are inherited from `@headlessui/react`'s `Tab.Group` / `Tab.List`
 * / `Tab.Panel` primitives — no roles are added or overridden here.
 *
 * @param props - Component props (see the local `TTabsProps` declaration).
 * @param props.tabs - Required. Array of `TabItem` entries (`key`, `label`, `icon`, `disabled`, `onClick`, `content`); each tab's `key` must be unique within the array.
 * @param props.storageKey - Optional. Suffix combined as `tab-<storageKey>` for the `localStorage` entry; when omitted, the persistence key falls back to `tab-<tabs[0]?.key>`.
 * @param props.actions - Optional. `React.ReactNode` rendered in the tab strip header next to the tab list, wrapped in a `flex-grow` container so it occupies remaining horizontal space.
 * @param props.defaultTab - Optional. Initial selected tab key when no stored value is present. Defaults to `tabs[0]?.key` (the first tab's key, if any).
 * @param props.containerClassName - Optional. Class merged on the inner flex-column wrapper holding the header row and the panels. Defaults to `""`.
 * @param props.tabListContainerClassName - Optional. Class merged on the header row containing `TabList` and the `actions` slot. Defaults to `""`.
 * @param props.tabListClassName - Optional. Class forwarded to `TabList`'s `<Tab.List>` element. Defaults to `""`.
 * @param props.tabClassName - Optional. Class forwarded per-tab inside `TabList` to style individual `<Tab>` triggers. Defaults to `""`.
 * @param props.tabPanelClassName - Optional. Class merged on every `<Tab.Panel>` rendered for `tabs`. Defaults to `""`.
 * @param props.size - Optional. Typography / icon size token forwarded to `TabList`. Defaults to `"md"`.
 * @param props.storeInLocalStorage - Optional. When `false`, suppresses the write-back to `localStorage` on tab change. Defaults to `true` — persistence is the default behavior.
 * @returns A React element: a flex-column wrapper containing `<Tab.Group>` with the header row (`TabList` + `actions`) and the rendered `<Tab.Panels>` (one `<Tab.Panel>` per `tabs` entry).
 */
export function Tabs(props: TTabsProps) {
  const {
    tabs,
    storageKey,
    actions,
    defaultTab = tabs[0]?.key,
    containerClassName = "",
    tabListContainerClassName = "",
    tabListClassName = "",
    tabClassName = "",
    tabPanelClassName = "",
    size = "md",
    storeInLocalStorage = true,
  } = props;
  // local storage
  const { storedValue, setValue } = useLocalStorage(
    storeInLocalStorage && storageKey ? `tab-${storageKey}` : `tab-${tabs[0]?.key}`,
    defaultTab
  );
  // state
  const [selectedTab, setSelectedTab] = useState(storedValue ?? defaultTab);

  useEffect(() => {
    if (storeInLocalStorage) {
      setValue(selectedTab);
    }
  }, [selectedTab, setValue, storeInLocalStorage, storageKey]);

  const currentTabIndex = (tabKey: string): number => tabs.findIndex((tab) => tab.key === tabKey);

  const handleTabChange = (key: string) => {
    setSelectedTab(key);
  };

  return (
    <div className="flex h-full w-full flex-col">
      <Tab.Group defaultIndex={currentTabIndex(selectedTab)}>
        <div className={cn("flex h-full w-full flex-col gap-2", containerClassName)}>
          <div className={cn("flex w-full items-center gap-4", tabListContainerClassName)}>
            <TabList
              tabs={tabs}
              tabListClassName={tabListClassName}
              tabClassName={tabClassName}
              size={size}
              onTabChange={handleTabChange}
            />
            {actions && <div className="flex-grow">{actions}</div>}
          </div>
          <Tab.Panels as={Fragment}>
            {tabs.map((tab) => (
              <Tab.Panel key={tab.key} as="div" className={cn("relative outline-none", tabPanelClassName)}>
                {tab.content}
              </Tab.Panel>
            ))}
          </Tab.Panels>
        </div>
      </Tab.Group>
    </div>
  );
}
