/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Extended login-medium label placeholder merged with `CORE_LOGIN_MEDIUM_LABELS`
 * by `./index.ts`; empty in CE and populated by downstream variants.
 */

import type { TExtendedLoginMediums } from "@plane/types";

/**
 * Extended (non-core) auth medium label map — empty in CE, typed exhaustively so
 * any added `TExtendedLoginMediums` member fails compilation until labeled.
 */
export const EXTENDED_LOGIN_MEDIUM_LABELS: Record<TExtendedLoginMediums, string> = {};
