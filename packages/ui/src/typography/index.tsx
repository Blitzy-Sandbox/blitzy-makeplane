/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Re-exports the `SubHeading` typography primitive.
 *
 * Provides a stable directory-level import path for typography symbols so consumers do not
 * depend on the underlying file layout (e.g., `import { SubHeading } from "@plane/ui"`
 * resolves through `packages/ui/src/index.ts` → this barrel → `./sub-heading.tsx`).
 */

export * from "./sub-heading";
