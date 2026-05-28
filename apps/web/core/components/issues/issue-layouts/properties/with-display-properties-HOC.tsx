/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Conditional wrapper that gates property rendering based on the active `displayProperties` filter
 * state from the issue-layout. Used by `IssueProperties` (`all-properties.tsx`) to wrap every property
 * control so the user's display-property toggles (state, priority, dates, assignees, etc.) are
 * respected uniformly without per-control boilerplate. Pure gating helper — has no UI of its own.
 *
 * Exports:
 *   - `WithDisplayPropertiesHOC` — observer-wrapped React component
 *
 * Required props (from internal `IWithDisplayPropertiesHOC`):
 *   - `displayProperties: IIssueDisplayProperties` — the active display-property flags map
 *   - `displayPropertyKey: keyof IIssueDisplayProperties | (keyof IIssueDisplayProperties)[]` —
 *     single key OR array of keys; array case requires ALL keys to be enabled (`every` check)
 *   - `children: ReactNode` — content to render when the condition passes
 *
 * Optional props:
 *   - `shouldRenderProperty?: (displayProperties: IIssueDisplayProperties) => boolean` — additional
 *     predicate combined with the key check via logical AND; defaults to `true` when omitted
 *
 * MobX stores read: none directly — receives `displayProperties` as a prop; `observer` ensures the
 * component re-renders when the caller's observable mutates.
 *
 * Side effects: none — pure gating; renders `null` when the condition fails, otherwise the children.
 */

import type { ReactNode } from "react";
import { observer } from "mobx-react";
import type { IIssueDisplayProperties } from "@plane/types";

interface IWithDisplayPropertiesHOC {
  displayProperties: IIssueDisplayProperties;
  shouldRenderProperty?: (displayProperties: IIssueDisplayProperties) => boolean;
  displayPropertyKey: keyof IIssueDisplayProperties | (keyof IIssueDisplayProperties)[];
  children: ReactNode;
}

export const WithDisplayPropertiesHOC = observer(function WithDisplayPropertiesHOC({
  displayProperties,
  shouldRenderProperty,
  displayPropertyKey,
  children,
}: IWithDisplayPropertiesHOC) {
  let shouldDisplayPropertyFromFilters = false;
  if (Array.isArray(displayPropertyKey))
    shouldDisplayPropertyFromFilters = displayPropertyKey.every((key) => !!displayProperties[key]);
  else shouldDisplayPropertyFromFilters = !!displayProperties[displayPropertyKey];

  const renderProperty =
    shouldDisplayPropertyFromFilters && (shouldRenderProperty ? shouldRenderProperty(displayProperties) : true);

  if (!renderProperty) return null;

  return <>{children}</>;
});
