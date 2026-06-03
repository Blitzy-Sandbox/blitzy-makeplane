/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared loading-state placeholder rendered inside dropdown panels while options are being
 * fetched.
 */

import { range } from "lodash-es";
import React from "react";

/**
 * Six-row pulsing skeleton displayed when a dropdown's `options` prop is `undefined` and no
 * custom `loader` node is supplied.
 *
 * The row count (6) is a heuristic chosen to fill the panel's visible scroll area at typical
 * sizes; row dimensions match the height of a populated option (`h-[1.925rem]`) so the swap
 * to real data does not cause a layout shift.
 *
 * Props: none. The component is purely presentational.
 */
export function DropdownOptionsLoader() {
  return (
    <div className="flex animate-pulse flex-col gap-1">
      {range(6).map((index) => (
        <div key={index} className="flex h-[1.925rem] w-full rounded-sm bg-surface-2 px-1 py-1.5" />
      ))}
    </div>
  );
}
