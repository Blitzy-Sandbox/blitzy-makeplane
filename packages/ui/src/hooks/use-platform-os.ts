/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * React hook detecting whether the client is running on a mobile platform (iOS or Android).
 *
 * Centralizes a narrow user-agent heuristic so consumers — currently
 * `packages/ui/src/dropdowns/context-menu/root.tsx` — don't duplicate UA parsing when they
 * need to gate touch-vs-pointer behavior (e.g., suppressing right-click context menus on touch).
 */

/**
 * Returns a `{ isMobile }` flag derived from `window.navigator.userAgent`.
 *
 * `isMobile` is `true` when the user agent string matches `/iPhone|iPad|iPod|Android/i`.
 * The hook does NOT distinguish macOS/Windows/Linux and does NOT detect iPadOS 13+ devices
 * that masquerade as macOS desktops — its scope is narrowly "iOS/Android touch device or not".
 *
 * @returns An object containing the single boolean field `isMobile`.
 */
// INTENT UNCLEAR: this hook reads `window.navigator.userAgent` synchronously at call time
// without a `typeof window !== "undefined"` guard, so it will throw during server-side
// rendering. The implicit contract is "client-only" but is not explicit in source.
export const usePlatformOS = () => {
  const userAgent = window.navigator.userAgent;
  const isMobile = /iPhone|iPad|iPod|Android/i.test(userAgent);

  return { isMobile };
};
