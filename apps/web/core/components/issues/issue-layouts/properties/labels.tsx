/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Renders the inline Labels property for an issue row, switching between three modes based on the
 * number of selected labels and the configurable `maxRender` threshold:
 *   - 0 labels  → `NoLabel` placeholder (icon + `placeholderText`)
 *   - 1..maxRender → one `LabelDropdown`-wrapped `LabelItem` chip per selected label
 *   - > maxRender → single `LabelDropdown` showing a condensed `LabelSummary` ("N Labels") with the
 *     full list in a tooltip
 *
 * Exports:
 *   - `IIssuePropertyLabels` — props interface
 *   - `IssuePropertyLabels` — observer-wrapped React component
 *
 * Local helpers (not individually exported; referenced via the barrel):
 *   - `NoLabel` — empty-state renderer
 *   - `LabelSummary` — condensed count renderer with tooltip listing all selected labels
 *   - `LabelItem` — single-label chip renderer with the label's color dot and name
 *
 * Required props (from `IIssuePropertyLabels`):
 *   - `projectId: string | null` — scopes label fetch
 *   - `value: string[]` — selected label IDs (controlled)
 *   - `onChange: (data: string[]) => void` — emits the new label-id array; the parent dispatches it via
 *     `updateIssue` (see `all-properties.tsx` `handleLabel`)
 *
 * Optional props:
 *   - `defaultOptions?: unknown` — fallback labels when the store has none (used for guest views)
 *   - `disabled?: boolean` — disables the dropdown trigger
 *   - `hideDropdownArrow?: boolean` — hides the chevron in the trigger
 *   - `className?`, `buttonClassName?`, `optionsClassName?` — styling overrides
 *   - `placement?: Placement` — popper placement from `@popperjs/core`
 *   - `maxRender?: number` — chip/summary threshold
 *   - `noLabelBorder?: boolean` (default `false`) — strips the border on the empty/condensed renders
 *   - `placeholderText?: string` — shown inside `NoLabel`
 *   - `onClose?: () => void` — invoked when the dropdown closes
 *   - `renderByDefault?: boolean` (default `true`) — toggles `Tooltip.renderByDefault`
 *   - `fullWidth?`, `fullHeight?: boolean` (default `false`) — sizing controls
 *
 * MobX stores read:
 *   - `useLabel` → `getProjectLabels(projectId)` for the project's label catalog
 *   - `usePlatformOS` → `isMobile` (controls tooltip `renderByDefault` and search-input focus)
 *
 * Side effects:
 *   - Selection changes are NOT mutated here — emitted via `onChange` for the parent to dispatch
 *   - `onClose` fires on outside-click via `useOutsideClickDetector`
 *   - Search input is focused on desktop (`!isMobile`) when the dropdown opens
 */

import { useEffect, useRef, useState } from "react";
import type { Placement } from "@popperjs/core";
import { observer } from "mobx-react";
// plane helpers
import { useOutsideClickDetector } from "@plane/hooks";
// i18n
import { useTranslation } from "@plane/i18n";
import { LabelPropertyIcon } from "@plane/propel/icons";
// types
import { Tooltip } from "@plane/propel/tooltip";
import type { IIssueLabel } from "@plane/types";
// ui
// hooks
import { cn } from "@plane/utils";
import { useLabel } from "@/hooks/store/use-label";
import { usePlatformOS } from "@/hooks/use-platform-os";
import { LabelDropdown } from "./label-dropdown";

export interface IIssuePropertyLabels {
  projectId: string | null;
  value: string[];
  defaultOptions?: unknown;
  onChange: (data: string[]) => void;
  disabled?: boolean;
  hideDropdownArrow?: boolean;
  className?: string;
  buttonClassName?: string;
  optionsClassName?: string;
  placement?: Placement;
  maxRender?: number;
  noLabelBorder?: boolean;
  placeholderText?: string;
  onClose?: () => void;
  renderByDefault?: boolean;
  fullWidth?: boolean;
  fullHeight?: boolean;
}

type NoLabelProps = {
  isMobile: boolean;
  noLabelBorder: boolean;
  fullWidth: boolean;
  placeholderText?: string;
};

const NoLabel = observer(function NoLabel({ isMobile, noLabelBorder, fullWidth, placeholderText }: NoLabelProps) {
  const { t } = useTranslation();

  return (
    <Tooltip
      position="top"
      tooltipHeading={t("common.labels")}
      tooltipContent="None"
      isMobile={isMobile}
      renderByDefault={false}
    >
      <div
        className={cn(
          "flex h-full items-center justify-center gap-2 rounded-sm px-2.5 py-1 text-caption-sm-regular hover:bg-layer-1",
          noLabelBorder ? "rounded-none" : "border-[0.5px] border-strong",
          fullWidth && "w-full"
        )}
      >
        <LabelPropertyIcon className="h-3.5 w-3.5" />
        {placeholderText}
      </div>
    </Tooltip>
  );
});

type LabelSummaryProps = {
  isMobile: boolean;
  fullWidth: boolean;
  noLabelBorder: boolean;
  disabled?: boolean;
  projectLabels: IIssueLabel[];
  value: string[];
};

function LabelSummary({ isMobile, fullWidth, noLabelBorder, disabled, projectLabels, value }: LabelSummaryProps) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "flex h-5 flex-shrink-0 items-center justify-center rounded-sm px-2.5 text-caption-sm-regular",
        fullWidth && "w-full",
        noLabelBorder ? "rounded-none" : "border-[0.5px] border-strong",
        disabled ? "cursor-not-allowed" : "cursor-pointer"
      )}
    >
      <Tooltip
        isMobile={isMobile}
        position="top"
        tooltipHeading={t("common.labels")}
        tooltipContent={projectLabels
          ?.filter((l) => value.includes(l?.id))
          .map((l) => l?.name)
          .join(", ")}
        renderByDefault={false}
      >
        <div className="flex h-full items-center gap-1.5 text-secondary">
          <span className="h-2 w-2 flex-shrink-0 rounded-full bg-accent-primary" />
          {`${value.length} Labels`}
        </div>
      </Tooltip>
    </div>
  );
}

type LabelItemProps = {
  label: IIssueLabel;
  isMobile: boolean;
  renderByDefault: boolean;
  disabled?: boolean;
  fullWidth: boolean;
  noLabelBorder: boolean;
};

const LabelItem = observer(function LabelItem({
  label,
  isMobile,
  renderByDefault,
  disabled,
  fullWidth,
  noLabelBorder,
}: LabelItemProps) {
  const { t } = useTranslation();

  return (
    <Tooltip
      position="top"
      tooltipHeading={t("common.labels")}
      tooltipContent={label?.name ?? ""}
      isMobile={isMobile}
      renderByDefault={renderByDefault}
    >
      <div
        className={cn(
          "flex h-full max-w-full flex-shrink-0 items-center justify-center overflow-hidden rounded-sm px-2.5 text-caption-sm-regular hover:bg-layer-1",
          !disabled && "cursor-pointer",
          fullWidth && "w-full",
          noLabelBorder ? "rounded-none" : "border-[0.5px] border-strong"
        )}
      >
        <div className="flex max-w-full items-center gap-1.5 overflow-hidden text-secondary">
          <span
            className="h-2 w-2 flex-shrink-0 rounded-full"
            style={{
              backgroundColor: label?.color ?? "#000000",
            }}
          />
          <div className="line-clamp-1 inline-block w-auto max-w-[200px] truncate">{label?.name}</div>
        </div>
      </div>
    </Tooltip>
  );
});

export const IssuePropertyLabels = observer(function IssuePropertyLabels(props: IIssuePropertyLabels) {
  const {
    projectId,
    value,
    defaultOptions = [],
    onChange,
    onClose,
    disabled,
    hideDropdownArrow = false,
    buttonClassName = "",
    placement,
    maxRender = 2,
    noLabelBorder = false,
    placeholderText,
    renderByDefault = true,
    fullWidth = false,
    fullHeight = false,
  } = props;
  // states
  const [isOpen, setIsOpen] = useState(false);
  // refs
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // store hooks
  const { getProjectLabels } = useLabel();
  const { isMobile } = usePlatformOS();
  const storeLabels = getProjectLabels(projectId);

  const handleClose = () => {
    if (!isOpen) return;
    setIsOpen(false);
    if (onClose) onClose();
  };

  useOutsideClickDetector(dropdownRef, handleClose);

  useEffect(() => {
    if (isOpen && inputRef.current && !isMobile) {
      inputRef.current.focus();
    }
  }, [isOpen, isMobile]);

  let projectLabels: IIssueLabel[] = defaultOptions as IIssueLabel[];
  if (storeLabels && storeLabels.length > 0) projectLabels = storeLabels;

  return (
    <>
      {value.length > 0 ? (
        value.length <= maxRender ? (
          projectLabels
            ?.filter((l) => value.includes(l?.id))
            .map((label) => (
              <LabelDropdown
                key={label.id}
                projectId={projectId}
                value={value}
                onChange={onChange}
                buttonClassName={buttonClassName}
                placement={placement}
                hideDropdownArrow={hideDropdownArrow}
                fullWidth={fullWidth}
                fullHeight={fullHeight}
                label={
                  <LabelItem
                    label={label}
                    isMobile={isMobile}
                    renderByDefault={renderByDefault}
                    disabled={disabled}
                    fullWidth={fullWidth}
                    noLabelBorder={noLabelBorder}
                  />
                }
              />
            ))
        ) : (
          <LabelDropdown
            projectId={projectId}
            value={value}
            onChange={onChange}
            hideDropdownArrow={hideDropdownArrow}
            buttonClassName={buttonClassName}
            placement={placement}
            fullWidth={fullWidth}
            fullHeight={fullHeight}
            label={
              <LabelSummary
                isMobile={isMobile}
                fullWidth={fullWidth}
                noLabelBorder={noLabelBorder}
                disabled={disabled}
                projectLabels={projectLabels}
                value={value}
              />
            }
          />
        )
      ) : (
        <LabelDropdown
          projectId={projectId}
          value={value}
          onChange={onChange}
          hideDropdownArrow={hideDropdownArrow}
          buttonClassName={buttonClassName}
          placement={placement}
          fullWidth={fullWidth}
          fullHeight={fullHeight}
          label={
            <NoLabel
              isMobile={isMobile}
              noLabelBorder={noLabelBorder}
              fullWidth={fullWidth}
              placeholderText={placeholderText}
            />
          }
        />
      )}
    </>
  );
});
