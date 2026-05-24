/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared primitive contracts for the `@plane/types` package.
 *
 * Defines foundational types reused throughout the monorepo — pagination envelope
 * (`TPaginationInfo`), entity logo props (`TLogoProps`), name/description loader states
 * (`TNameDescriptionLoader`), fetch status discriminator (`TFetchStatus`), and the custom
 * search-select option shape (`ICustomSearchSelectOption`). These types have no internal
 * dependencies and are intended to be widely imported by `apps/web`, `apps/admin`,
 * `@plane/ui`, `@plane/editor`, `@plane/propel`, and other sibling packages.
 */

/**
 * Pagination metadata envelope for cursor-based paginated responses returned by the
 * Plane Django backend (`apps/api`).
 *
 * Mirrors the `BasePaginator` response shape (`apps/api/plane/utils/paginator.py`) and
 * is consumed by MobX stores in `apps/web/core/store/` (e.g. `sticky.store.ts`,
 * `workspace.store.ts`) and `apps/admin/store/` to drive infinite-scroll and
 * pager-style UIs.
 */
export type TPaginationInfo = {
  /** Number of items returned in the current page. */
  count: number;
  /** Opaque endpoint-specific metadata (typed `string | null` for legacy reasons). */
  extra_stats: string | null;
  /** Opaque cursor pointing at the next page; empty string at the trailing boundary. */
  next_cursor: string;
  /** True when a subsequent page is available after `next_cursor`. */
  next_page_results: boolean;
  /** Opaque cursor pointing at the previous page; empty string at the leading boundary. */
  prev_cursor: string;
  /** True when a prior page is available before `prev_cursor`. */
  prev_page_results: boolean;
  /** Total page count across the full result set when known. */
  total_pages: number;
  /** Server-honored page size used to derive `total_pages`; absent when the endpoint does not echo it. */
  per_page?: number;
  /** Total item count across all pages of the full result set. */
  total_results: number;
};

/**
 * Entity logo configuration — either an emoji or a Lucide / Material icon descriptor.
 *
 * Discriminated by `in_use`:
 * - When `in_use === "emoji"`: `emoji.value` holds the emoji code-point (decimal string)
 *   and `emoji.url` optionally holds a rendered image URL fallback.
 * - When `in_use === "icon"`: `icon.name` + `icon.color` + `icon.background_color`
 *   describe the rendered icon.
 *
 * Mirrors the `logo_props` JSONField on backend models (project, page, view, sticky,
 * cycle, module, etc.) and is rendered by `packages/propel/src/emoji-icon-picker/logo.tsx`
 * and `packages/editor/src/core/extensions/callout/`.
 */
export type TLogoProps = {
  /** Discriminator selecting which sub-shape (`emoji` or `icon`) is active. */
  in_use: "emoji" | "icon";
  emoji?: {
    /** Emoji code-point as a decimal-string (e.g. `"128512"` for 😀). */
    value?: string;
    /** Optional pre-rendered emoji image URL used when code-point rendering is unavailable. */
    url?: string;
  };
  icon?: {
    /** Icon identifier matched against the Lucide / Material icon registry. */
    name?: string;
    /** Foreground stroke / fill color (CSS color string). */
    color?: string;
    /** Background fill color rendered behind the icon glyph (CSS color string). */
    background_color?: string;
  };
};

/**
 * Loading state for the name + description inline-edit pair on issue / page / cycle
 * peek-overview and detail views.
 *
 * Union values:
 * - `"submitting"`: a save mutation is in flight.
 * - `"submitted"`: the save resolved but the post-save indicator has not yet decayed.
 * - `"saved"`: the editor is idle and dirty changes have been flushed; UI fades the
 *   "Saved" badge out (see `apps/web/core/components/issues/issue-update-status.tsx`).
 */
export type TNameDescriptionLoader = "submitting" | "submitted" | "saved";

/**
 * Fetch lifecycle discriminator used by MobX stores in `apps/web` to distinguish
 * between an in-progress first-load and a re-fetch that already has cached data.
 *
 * Union values:
 * - `"partial"`: a fetch is in flight but stale data is already present in the store
 *   (consumer should keep showing it).
 * - `"complete"`: the most recent fetch has resolved.
 * - `undefined`: idle / no fetch has been issued yet.
 *
 * Consumed by stores such as `apps/web/core/store/project/project.store.ts` to gate
 * re-fetch decisions and skeleton rendering.
 */
export type TFetchStatus = "partial" | "complete" | undefined;

/**
 * Option shape for the custom search-select dropdown component in `@plane/ui`
 * (`packages/ui/src/dropdowns/`).
 *
 * Used wherever the UI needs a searchable single- or multi-select with custom row
 * rendering (project / cycle / module / view / page headers in `apps/web`).
 */
export type ICustomSearchSelectOption = {
  /** Opaque value passed through on selection; typed `any` because callers use heterogeneous identifiers (UUID strings, numbers, composite keys). */
  value: any;
  /** Searchable text used by the dropdown's filter logic to match user input. */
  query: string;
  /** JSX rendered for the option row (typically an icon + label pair). */
  content: React.ReactNode;
  /** When true, the option is rendered but cannot be selected. */
  disabled?: boolean;
  /** Optional tooltip shown on hover; supports plain text or arbitrary JSX. */
  tooltip?: string | React.ReactNode;
};
