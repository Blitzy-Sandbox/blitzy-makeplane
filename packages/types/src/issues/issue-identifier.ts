/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue identifier display contracts for the `@plane/types/issues` subfolder.
 *
 * Models the canonical `<project_identifier>-<sequence_id>` label (e.g.
 * `"PLN-1234"`) rendered by the `<IssueIdentifier>` component family in
 * `apps/web/core/components/issues/`. The label surfaces in issue lists,
 * search results, breadcrumbs, peek overviews, sub-issue panels, and
 * shareable URLs — anywhere an issue is referenced compactly.
 *
 * Two complementary call-site flavors are exposed because identifier
 * rendering happens in BOTH store-hydrated contexts (issue lists with the
 * issue loaded in MobX) and store-less contexts (search hits, notification
 * payloads, webhook receipts where only a stub of the issue is available):
 *   - {@link TIssueIdentifierFromStore} — caller passes `issueId` and the
 *     component reads `projectMap[projectId].identifier` plus
 *     `issueMap[issueId].sequence_id` from the MobX stores in
 *     `apps/web/core/store/`.
 *   - {@link TIssueIdentifierWithDetails} — caller passes the pre-computed
 *     `projectIdentifier` prefix and `issueSequenceId` directly, bypassing
 *     any store lookup.
 * The two are combined as the discriminated union
 * {@link TIssueIdentifierProps}; TypeScript narrows on the structural
 * presence of `issueId` vs `projectIdentifier`/`issueSequenceId` rather
 * than on a literal discriminant field.
 *
 * Re-exported as a top-level surface DIRECTLY from
 * `packages/types/src/index.ts` (not via the `./base.ts` folder barrel) so
 * the identifier rendering concern stays decoupled from the core issue
 * entity types.
 */

import type { IIssueDisplayProperties } from "../view-props";

/**
 * Discrete size token controlling identifier text scale — maps to the
 * Tailwind text-size scale (`text-xs` / `text-sm` / `text-base` /
 * `text-lg`) inside the `<IssueIdentifier>` family in
 * `apps/web/core/components/issues/`. A string literal union (rather than
 * a free `number` of pixels) is used so the design-system contract stays
 * enumerable and consumers cannot opt into off-token sizes.
 *
 * - `"xs"` — extra-small; reserved for compact list / spreadsheet rows
 *   where vertical density matters more than legibility.
 * - `"sm"` — small; the default in most issue list contexts.
 * - `"md"` — medium; used in the peek-overview header where the
 *   identifier sits alongside the issue title.
 * - `"lg"` — large; used in the issue detail page header where the
 *   identifier is one of the page's primary affordances.
 */
export type TIssueIdentifierSize = "xs" | "sm" | "md" | "lg";

/**
 * Color token controlling the identifier label's text color. The variant
 * encodes context (active vs completed/archived issue, primary vs
 * secondary surface) rather than a raw color so theming and dark-mode
 * mappings stay in the design layer.
 *
 * - `"default"` — neutral foreground for in-flight issues.
 * - `"secondary"` — muted foreground for non-primary contexts (e.g. an
 *   identifier rendered inside a parent issue's sub-issue list).
 * - `"tertiary"` — most-muted foreground for tertiary contexts (e.g. an
 *   identifier referenced inside a comment body or activity log entry).
 * - `"primary"` — accent foreground for emphasized identifiers (e.g. the
 *   currently selected issue in a list).
 * - `"primary-subtle"` — accent foreground at reduced opacity, used when
 *   the surrounding surface already carries the accent color.
 * - `"success"` — green foreground used to signal a completed / closed
 *   issue without needing a separate strikethrough or icon.
 */
export type TIdentifierTextVariant = "default" | "secondary" | "tertiary" | "primary" | "primary-subtle" | "success";

/**
 * Common props shared by both identifier flavors — combined with one of
 * {@link TIssueIdentifierFromStore} or {@link TIssueIdentifierWithDetails}
 * via the {@link TIssueIdentifierProps} union. Carries the always-required
 * `projectId` plus the optional styling and behavior toggles.
 */
export type TIssueIdentifierBaseProps = {
  /**
   * Project id whose `identifier` prefix (e.g. `"PLN"`) is used to format
   * the label. Required for both flavors because even the with-details
   * flavor uses `projectId` when looking up the issue-type icon from the
   * issue-types store keyed per project.
   */
  projectId: string;
  /** Size token; see {@link TIssueIdentifierSize}. Consumers default to `"sm"` when omitted. */
  size?: TIssueIdentifierSize;
  /** Color token; see {@link TIdentifierTextVariant}. Consumers default to `"default"` when omitted. */
  variant?: TIdentifierTextVariant;
  /**
   * Active issue-list display settings. When present, consumers may
   * suppress rendering based on `displayProperties.key` — issue lists let
   * users hide the identifier column independently of other columns.
   */
  displayProperties?: IIssueDisplayProperties | undefined;
  /**
   * When `true`, the identifier text renders as a click-to-copy chip
   * (copies the full `<prefix>-<seq>` string to the clipboard). Defaults
   * to `false` in consumers so list rows stay click-through to the issue
   * detail page rather than swallowing the click as a copy gesture.
   */
  enableClickToCopyIdentifier?: boolean;
};

/**
 * "Lookup" identifier flavor — caller supplies only `issueId` and
 * `projectId` (via the extended base) and the rendering component reads
 * the project identifier and the issue sequence id from the MobX stores.
 * Used wherever the issue is already loaded into the store (issue lists,
 * issue detail page, kanban / spreadsheet rows).
 *
 * The component reads `projectMap[projectId].identifier` from the project
 * store and `issueMap[issueId].sequence_id` from
 * `apps/web/core/store/issue/`.
 */
export type TIssueIdentifierFromStore = TIssueIdentifierBaseProps & {
  /**
   * Id of the issue whose sequence id should be looked up from the MobX
   * issue store. Required because the store is the source of truth for
   * the sequence id in store-hydrated contexts.
   */
  issueId: string;
};

/**
 * "Inline" identifier flavor — caller supplies the project prefix and
 * sequence id directly, bypassing all MobX lookups. This flavor exists
 * because search results, notification payloads, and webhook receipts
 * surface issue identifiers from the API WITHOUT loading the full issue
 * into the store, so a store-based lookup would render an empty label.
 */
export type TIssueIdentifierWithDetails = TIssueIdentifierBaseProps & {
  /**
   * Optional issue type id used to render the small type icon next to
   * the label. `null` (versus `undefined`) is a meaningful signal from
   * callers that the issue has no type configured and the icon slot must
   * be suppressed rather than left as a loading placeholder.
   */
  issueTypeId?: string | null;
  /** Pre-computed project identifier prefix (e.g. `"PLN"`). */
  projectIdentifier: string;
  /**
   * Sequence id portion of the label. Accepted as `string | number`
   * because the backend serializes the integer sequence id as a JSON
   * number in some endpoints (the canonical issue payload) and as a
   * string in others (search and webhook envelopes); typing the union
   * keeps callers from having to coerce at every site.
   */
  issueSequenceId: string | number;
};

/**
 * Discriminated union of the two identifier flavors — consumers select
 * the flavor structurally at the call site by passing either `issueId`
 * (store flavor) or `projectIdentifier` + `issueSequenceId` (inline
 * flavor). The discriminant is structural rather than a literal tag
 * field so existing call sites don't need to add a redundant kind label;
 * TypeScript narrows automatically on the presence of the optional
 * fields.
 */
export type TIssueIdentifierProps = TIssueIdentifierFromStore | TIssueIdentifierWithDetails;

/**
 * Props for the small issue-type icon rendered next to the identifier
 * label when the issue has a configured type. Separated from the
 * identifier prop types so the icon can also be rendered standalone
 * (e.g. inside dropdown option rows in the issue-type picker).
 */
export type TIssueTypeIdentifier = {
  /**
   * Issue type id used to look up the type's icon glyph and accent color
   * from the issue-types store in `apps/web/core/store/`.
   */
  issueTypeId: string;
  /** Size token; see {@link TIssueIdentifierSize}. */
  size?: TIssueIdentifierSize;
};

/**
 * Lowest-level rendering props for the final identifier-text leaf
 * component — takes the already-formatted identifier string plus
 * styling tokens. The composition (prefix + sequence id) is intentionally
 * pushed up to the caller so that this leaf can render identifiers
 * sourced from either flavor above without re-implementing the format
 * rule.
 */
export type TIdentifierTextProps = {
  /**
   * Fully-formatted identifier string (e.g. `"PLN-1234"`). The caller is
   * responsible for the `<prefix>-<seq>` formatting; the leaf component
   * renders this verbatim.
   */
  identifier: string;
  /** See {@link TIssueIdentifierBaseProps.enableClickToCopyIdentifier}. */
  enableClickToCopyIdentifier?: boolean;
  /** Size token; see {@link TIssueIdentifierSize}. */
  size?: TIssueIdentifierSize;
  /** Color token; see {@link TIdentifierTextVariant}. */
  variant?: TIdentifierTextVariant;
};
