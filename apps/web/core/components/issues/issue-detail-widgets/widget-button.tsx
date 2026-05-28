/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared visual primitive for the issue-detail widget trigger toolbar. Wraps the
 * Propel `Button` with a fixed secondary/large variant + optional leading icon so
 * every widget trigger (sub-issues, relations, links, attachments) renders with
 * the same shape regardless of which specialized action component owns the click
 * handler.
 *
 * Rendered purpose:
 *   Render a secondary, large Propel Button with an optional leading icon and a
 *   compact (`text-body-xs-medium`) label suitable for the issue-detail toolbar.
 *
 * MobX stores read: None.
 * Side effects: None. Click behavior is owned by the parent (the wrapper just
 * forwards visual state; the parent passes this element as `customButton` to a
 * specialized action component).
 */

import React from "react";
// helpers
import { Button } from "@plane/propel/button";

type Props = {
  icon: React.ReactNode;
  title: string;
  disabled?: boolean;
};

/**
 * Render the shared widget trigger button used across the issue-detail widget
 * toolbar. The component renders the icon (if provided) before the label, both
 * inside a secondary, large Propel `Button`.
 *
 * @param props.icon - React node rendered before the label. Pass `undefined`/`null` to omit.
 * @param props.title - Visible label text rendered with `text-body-xs-medium` typography.
 * @param props.disabled - Optional; defaults to `false`. When true, the underlying Button renders disabled and click is suppressed.
 */
export function IssueDetailWidgetButton(props: Props) {
  const { icon, title, disabled = false } = props;
  return (
    <Button variant={"secondary"} disabled={disabled} size="lg">
      {icon && icon}
      <span className="text-body-xs-medium">{title}</span>
    </Button>
  );
}
