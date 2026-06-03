/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Responsive breadcrumb navigation rendering an ordered trail of links with truncation
 * and dropdown collapse for narrow viewports.
 *
 * Exposes a `Breadcrumbs` parent plus attached primitives (`Item`, `Icon`, `Label`,
 * `Separator`, `ItemWrapper`) and a `BreadcrumbItemLoader` skeleton. Consumers compose
 * breadcrumb trails by passing items as children; the parent switches between full-trail
 * rendering and a collapsed (`...` back-affordance + terminal segment) layout at a 640px
 * viewport breakpoint.
 */

import * as React from "react";
import { ChevronRightIcon } from "@plane/propel/icons";
import { Tooltip } from "@plane/propel/tooltip";
import { cn } from "../utils";

type BreadcrumbsProps = {
  className?: string;
  children: React.ReactNode;
  onBack?: () => void;
  isLoading?: boolean;
};

/**
 * Skeleton placeholder rendered in place of a breadcrumb item while its data is loading.
 *
 * Used internally by `Breadcrumbs` when its `isLoading` prop is true; can also be rendered
 * by consumers that need a standalone breadcrumb skeleton. Pulses a 16px-wide icon stub
 * and a 64px-wide label stub at `bg-layer-1` to mirror a typical icon+label item shape.
 */
export function BreadcrumbItemLoader() {
  return (
    <div className="flex h-7 animate-pulse items-center gap-2">
      <div className="group flex h-full items-center gap-2 rounded-sm px-2 py-1 text-13 font-medium">
        <span className="h-full w-5 rounded-sm bg-layer-1" />
        <span className="h-full w-16 rounded-sm bg-layer-1" />
      </div>
    </div>
  );
}

/**
 * Root breadcrumb container that lays out child items horizontally with responsive collapse at ≤640px.
 *
 * Subscribes to `window` resize events to drive an internal `isSmallScreen` flag. On wide
 * viewports (>640px) it renders every child sequentially and injects `isLast` into the
 * terminal item so descendants can suppress separators or mark themselves as current. On
 * narrow viewports (≤640px) it collapses the intermediate trail to a `...` back affordance
 * (when `onBack` is provided) plus the terminal segment to preserve horizontal space. When
 * `isLoading` is true, every slot in the wide layout is replaced with `BreadcrumbItemLoader`.
 *
 * @param props.className - Optional extra classes applied to the outer flex container.
 * @param props.children - Breadcrumb items composed via `Breadcrumbs.Item`, `Breadcrumbs.ItemWrapper`, or one of the dropdown variants.
 * @param props.onBack - Optional callback invoked when the user taps the `...` collapsed affordance on small screens.
 * @param props.isLoading - When true, every visible slot in the wide layout is replaced with `BreadcrumbItemLoader` (default: false).
 */
// INTENT UNCLEAR: a `nav` landmark with `aria-label="Breadcrumb"` and `aria-current="page"` on the terminal item are not implemented here; consumers relying on screen-reader semantics must layer these externally.
function Breadcrumbs({ className, children, onBack, isLoading = false }: BreadcrumbsProps) {
  const [isSmallScreen, setIsSmallScreen] = React.useState(false);

  React.useEffect(() => {
    const handleResize = () => {
      setIsSmallScreen(window.innerWidth <= 640); // Adjust this value as per your requirement
    };

    window.addEventListener("resize", handleResize);
    handleResize(); // Call it initially to set the correct state
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const childrenArray = React.Children.toArray(children);

  return (
    <div className={cn("flex flex-grow items-center gap-0.5 overflow-hidden", className)}>
      {!isSmallScreen && (
        <>
          {childrenArray.map((child, index) => {
            if (isLoading) {
              return (
                <>
                  <BreadcrumbItemLoader />
                </>
              );
            }
            if (React.isValidElement<BreadcrumbItemProps>(child)) {
              return React.cloneElement(child, {
                isLast: index === childrenArray.length - 1,
              });
            }
            return child;
          })}
        </>
      )}

      {isSmallScreen && childrenArray.length > 1 && (
        <>
          <div className="flex items-center gap-2.5 p-1">
            {onBack && (
              <span onClick={onBack} className="text-secondary">
                ...
              </span>
            )}
            <ChevronRightIcon className="h-3.5 w-3.5 flex-shrink-0 text-placeholder" aria-hidden="true" />
          </div>
          <div className="flex items-center gap-2.5 p-1">
            {isLoading ? (
              <BreadcrumbItemLoader />
            ) : React.isValidElement(childrenArray[childrenArray.length - 1]) ? (
              React.cloneElement(childrenArray[childrenArray.length - 1] as React.ReactElement, {
                isLast: true,
              })
            ) : (
              childrenArray[childrenArray.length - 1]
            )}
          </div>
        </>
      )}
      {isSmallScreen && childrenArray.length === 1 && childrenArray}
    </div>
  );
}

// breadcrumb item
type BreadcrumbItemProps = {
  component?: React.ReactNode;
  showSeparator?: boolean;
  isLast?: boolean;
};

/**
 * Single segment within a breadcrumb trail rendering its `component` and an optional trailing chevron separator.
 *
 * The parent `Breadcrumbs` injects `isLast` via `React.cloneElement` for the terminal
 * segment; this prop is what suppresses the separator on that final item.
 *
 * @param props.component - The visual content for this segment (typically a `Breadcrumbs.ItemWrapper`-wrapped link).
 * @param props.showSeparator - Whether to append a `BreadcrumbSeparator` after the segment when it is not the last item (default: true).
 * @param props.isLast - Set by the parent `Breadcrumbs` for the terminal segment to suppress the separator (default: false).
 */
function BreadcrumbItem(props: BreadcrumbItemProps) {
  const { component, showSeparator = true, isLast = false } = props;
  return (
    <div className="flex h-6 items-center gap-0.5">
      {component}
      {showSeparator && !isLast && <BreadcrumbSeparator />}
    </div>
  );
}

// breadcrumb icon
type BreadcrumbIconProps = {
  children: React.ReactNode;
  className?: string;
};

/**
 * Fixed 16×16 icon slot for a breadcrumb segment, clipping any overflow.
 *
 * @param props.children - The icon node (typically a `lucide-react` or `@plane/propel/icons` icon).
 * @param props.className - Optional additional Tailwind classes applied to the slot wrapper.
 */
function BreadcrumbIcon(props: BreadcrumbIconProps) {
  const { children, className } = props;
  return <div className={cn("flex size-4 items-center justify-start overflow-hidden", className)}>{children}</div>;
}

// breadcrumb label
type BreadcrumbLabelProps = {
  children: React.ReactNode;
  className?: string;
};

/**
 * Text label for a breadcrumb segment, capped at 150px width and truncated with an ellipsis on overflow.
 *
 * @param props.children - The label content (commonly a workspace, project, or entity name).
 * @param props.className - Optional additional Tailwind classes for typography or width overrides.
 */
function BreadcrumbLabel(props: BreadcrumbLabelProps) {
  const { children, className } = props;
  return (
    <div className={cn("relative line-clamp-1 block max-w-[150px] truncate overflow-hidden", className)}>
      {children}
    </div>
  );
}

// breadcrumb separator
type BreadcrumbSeparatorProps = {
  className?: string;
  containerClassName?: string;
  iconClassName?: string;
  showDivider?: boolean;
};

/**
 * Chevron-right separator drawn between adjacent breadcrumb segments.
 *
 * @param props.className - Optional classes applied to the outer wrapper (height/padding adjustments).
 * @param props.containerClassName - Optional classes applied to the inner icon container (background/hover overrides).
 * @param props.iconClassName - Optional classes applied to the chevron itself (color or rotation transitions).
 * @param props.showDivider - When true, renders a thin vertical bar at the left edge to visually segment dropdown-style triggers (default: false).
 */
function BreadcrumbSeparator(props: BreadcrumbSeparatorProps) {
  const { className, containerClassName, iconClassName, showDivider = false } = props;
  return (
    <div className={cn("relative flex h-full items-center justify-center px-1.5 py-1", className)}>
      {showDivider && <span className="absolute top-0 -left-0.5 h-full w-[1.8px] bg-surface-1" />}
      <div
        className={cn(
          "flex flex-shrink-0 items-center justify-center rounded-sm text-placeholder transition-all",
          containerClassName
        )}
      >
        <ChevronRightIcon className={cn("h-3.5 w-3.5 flex-shrink-0", iconClassName)} />
      </div>
    </div>
  );
}

// breadcrumb wrapper
type BreadcrumbItemWrapperProps = {
  label?: string;
  disableTooltip?: boolean;
  children: React.ReactNode;
  className?: string;
  type?: "link" | "text";
  isLast?: boolean;
};

/**
 * Wraps breadcrumb segment content in a tooltip plus a hover-styled container, switching tone for the terminal item.
 *
 * Terminal items (`isLast === true`) render in `text-primary` and skip the hover affordance
 * to signal "you are here". Non-terminal `type="link"` items render in `text-tertiary` and
 * gain a hover state (`hover:bg-layer-transparent-hover`, `hover:text-primary`) to signal
 * that they are navigable. `type="text"` items render flat without the hover affordance
 * regardless of `isLast`.
 *
 * @param props.label - Tooltip content shown on hover; the tooltip is disabled when this is empty/undefined or when `disableTooltip` is true.
 * @param props.disableTooltip - Forces the tooltip off regardless of `label` (default: false).
 * @param props.children - Visual content (typically `Breadcrumbs.Icon` + `Breadcrumbs.Label`).
 * @param props.className - Optional extra classes merged into the container.
 * @param props.type - `"link"` enables the hover affordance for non-terminal items; `"text"` renders flat (default: `"link"`).
 * @param props.isLast - Marks the segment as the current page so it renders in primary text color without the hover affordance (default: false).
 */
function BreadcrumbItemWrapper(props: BreadcrumbItemWrapperProps) {
  const { label, disableTooltip = false, children, className, type = "link", isLast = false } = props;
  return (
    <Tooltip tooltipContent={label} position="bottom" disabled={!label || label === "" || disableTooltip}>
      <div
        className={cn(
          "group flex h-full cursor-default items-center gap-2 rounded-sm px-1.5 py-1 text-13 font-medium",
          {
            "text-primary": isLast,
            "text-tertiary": !isLast,
            "cursor-pointer hover:bg-layer-transparent-hover hover:text-primary": type === "link" && !isLast,
          },
          className
        )}
      >
        {children}
      </div>
    </Tooltip>
  );
}

Breadcrumbs.Item = BreadcrumbItem;
Breadcrumbs.Icon = BreadcrumbIcon;
Breadcrumbs.Label = BreadcrumbLabel;
Breadcrumbs.Separator = BreadcrumbSeparator;
Breadcrumbs.ItemWrapper = BreadcrumbItemWrapper;

export { Breadcrumbs, BreadcrumbItem, BreadcrumbIcon, BreadcrumbLabel, BreadcrumbSeparator, BreadcrumbItemWrapper };
