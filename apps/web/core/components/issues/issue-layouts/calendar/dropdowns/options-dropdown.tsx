/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Calendar settings popover that lets users switch between month/week layouts
 * and toggle weekend visibility.
 *
 * Props:
 *   - issuesFilterStore (required): IProjectIssuesFilter | IModuleIssuesFilter |
 *     ICycleIssuesFilter | IProjectViewIssuesFilter — source of the current
 *     `displayFilters.calendar.layout` and `.show_weekends`.
 *   - updateFilters? (optional): (projectId, EIssueFilterType.DISPLAY_FILTERS,
 *     filters) => Promise<void> — persistence callback. If omitted, layout and
 *     weekend changes are no-ops because the component never calls the API
 *     directly.
 *
 * MobX stores and hooks read (via React context, MobX-exclusive):
 *   - issuesFilterStore.issueFilters.displayFilters.calendar for the active
 *     layout and show_weekends flag.
 *   - useParams() (next/navigation) for the current projectId.
 *   - useCalendarView() → issueCalendarView.updateCalendarPayload(...) to
 *     refresh the visible window after a layout switch.
 *   - useSize() for windowWidth — used to auto-close the popover on mobile.
 *   - useTranslation() for the "common.options" and
 *     "common.actions.show_weekends" labels.
 *
 * Side effects:
 *   - Layout change: persists the new layout via updateFilters(projectId,
 *     EIssueFilterType.DISPLAY_FILTERS, { calendar: { ..., layout } }), then
 *     calls issueCalendarView.updateCalendarPayload(...) to refetch the
 *     visible-window data. This is the persisted-filter slice — distinct from
 *     CalendarMonthsDropdown which mutates the local calendar-view state.
 *   - Weekend toggle: persists { show_weekends: !current } via the same
 *     updateFilters callback.
 *   - On mobile (windowWidth <= 768), the popover auto-closes after a layout
 *     change or weekend toggle.
 *   - No direct API calls — persistence is delegated to the optional
 *     updateFilters callback so consumers can route to the appropriate filter
 *     store (project / cycle / module / project-view).
 *
 * Constants consumed:
 *   - CALENDAR_LAYOUTS from "@/constants/calendar" — supplies the set of
 *     selectable layouts (month, week) rendered as menu rows with a CheckIcon
 *     next to the active selection.
 *
 * Trigger presentation:
 *   - Desktop (md+): text button "Options" + rotating ChevronUpIcon, gated by
 *     Tailwind's `md:flex` / `md:hidden` responsive classes.
 *   - Mobile: icon-only MoreVerticalIcon. `useSize` is used for the auto-close
 *     behavior, not for trigger visibility.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { usePopper } from "react-popper";
import { MoreVerticalIcon } from "lucide-react";
import { Popover, Transition } from "@headlessui/react";
// hooks
// ui
// icons
import type { TSupportedFilterTypeForUpdate } from "@plane/constants";
import { EIssueFilterType } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { CheckIcon, ChevronUpIcon } from "@plane/propel/icons";
import type { TCalendarLayouts, TSupportedFilterForUpdate } from "@plane/types";
import { ToggleSwitch } from "@plane/ui";
// types
// constants
import { CALENDAR_LAYOUTS } from "@/constants/calendar";
import { useCalendarView } from "@/hooks/store/use-calendar-view";
import useSize from "@/hooks/use-window-size";
import type { ICycleIssuesFilter } from "@/store/issue/cycle";
import type { IModuleIssuesFilter } from "@/store/issue/module";
import type { IProjectIssuesFilter } from "@/store/issue/project";
import type { IProjectViewIssuesFilter } from "@/store/issue/project-views";

interface ICalendarHeader {
  issuesFilterStore: IProjectIssuesFilter | IModuleIssuesFilter | ICycleIssuesFilter | IProjectViewIssuesFilter;
  updateFilters?: (
    projectId: string,
    filterType: TSupportedFilterTypeForUpdate,
    filters: TSupportedFilterForUpdate
  ) => Promise<void>;
}

/** Calendar header popover for switching layout (month/week) and toggling weekend visibility. */
export const CalendarOptionsDropdown = observer(function CalendarOptionsDropdown(props: ICalendarHeader) {
  const { issuesFilterStore, updateFilters } = props;

  const { t } = useTranslation();

  const { projectId } = useParams();

  const issueCalendarView = useCalendarView();
  const [windowWidth] = useSize();

  const [referenceElement, setReferenceElement] = useState<HTMLButtonElement | null>(null);
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);

  const { styles, attributes } = usePopper(referenceElement, popperElement, {
    placement: "auto",
    modifiers: [
      {
        name: "preventOverflow",
        options: {
          padding: 12,
        },
      },
    ],
  });

  const calendarLayout = issuesFilterStore.issueFilters?.displayFilters?.calendar?.layout ?? "month";
  const showWeekends = issuesFilterStore.issueFilters?.displayFilters?.calendar?.show_weekends ?? false;

  const handleLayoutChange = (layout: TCalendarLayouts, closePopover: any) => {
    if (!updateFilters) return;

    updateFilters(projectId?.toString(), EIssueFilterType.DISPLAY_FILTERS, {
      calendar: {
        ...issuesFilterStore.issueFilters?.displayFilters?.calendar,
        layout,
      },
    });

    issueCalendarView.updateCalendarPayload(
      layout === "month"
        ? issueCalendarView.calendarFilters.activeMonthDate
        : issueCalendarView.calendarFilters.activeWeekDate
    );
    if (windowWidth <= 768) closePopover(); // close the popover on mobile
  };

  const handleToggleWeekends = () => {
    const showWeekends = issuesFilterStore.issueFilters?.displayFilters?.calendar?.show_weekends ?? false;

    if (!updateFilters) return;

    updateFilters(projectId?.toString(), EIssueFilterType.DISPLAY_FILTERS, {
      calendar: {
        ...issuesFilterStore.issueFilters?.displayFilters?.calendar,
        show_weekends: !showWeekends,
      },
    });
  };

  return (
    <Popover className="relative flex items-center">
      {({ open, close: closePopover }) => (
        <>
          <Popover.Button as={React.Fragment}>
            <button type="button" ref={setReferenceElement}>
              <div
                className={`hidden items-center gap-1.5 rounded-sm bg-layer-1 px-2.5 py-1 text-11 outline-none hover:bg-layer-1 md:flex ${
                  open ? "text-primary" : "text-secondary"
                }`}
              >
                <div className="font-medium">{t("common.options")}</div>
                <div
                  className={`flex h-3.5 w-3.5 items-center justify-center transition-all ${open ? "" : "rotate-180"}`}
                >
                  <ChevronUpIcon width={12} strokeWidth={2} />
                </div>
              </div>
              <div className="md:hidden">
                <MoreVerticalIcon className="h-4 text-secondary" strokeWidth={2} />
              </div>
            </button>
          </Popover.Button>
          <Transition
            as={React.Fragment}
            enter="transition ease-out duration-200"
            enterFrom="opacity-0 translate-y-1"
            enterTo="opacity-100 translate-y-0"
            leave="transition ease-in duration-150"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 translate-y-1"
          >
            <Popover.Panel className="fixed z-50">
              <div
                ref={setPopperElement}
                style={styles.popper}
                {...attributes.popper}
                className="absolute right-0 z-10 mt-1 min-w-[12rem] overflow-hidden rounded-sm border border-subtle bg-surface-1 p-1 shadow-raised-200"
              >
                <div>
                  {Object.entries(CALENDAR_LAYOUTS).map(([layout, layoutDetails]) => (
                    <button
                      key={layout}
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-sm px-1 py-1.5 text-left text-11 hover:bg-layer-1"
                      onClick={() => handleLayoutChange(layoutDetails.key, closePopover)}
                    >
                      {layoutDetails.title}
                      {calendarLayout === layout && <CheckIcon width={12} height={12} strokeWidth={2} />}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded-sm px-1 py-1.5 text-left text-11 hover:bg-layer-1"
                    onClick={handleToggleWeekends}
                  >
                    {t("common.actions.show_weekends")}
                    <ToggleSwitch
                      value={showWeekends}
                      onChange={() => {
                        if (windowWidth <= 768) closePopover(); // close the popover on mobile
                      }}
                    />
                  </button>
                </div>
              </div>
            </Popover.Panel>
          </Transition>
        </>
      )}
    </Popover>
  );
});
