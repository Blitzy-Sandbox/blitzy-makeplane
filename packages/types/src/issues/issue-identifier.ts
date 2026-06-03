/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Issue identifier display contracts (`<prefix>-<seq>` label e.g. `"PLN-1234"`)
 * for `<IssueIdentifier>` in `apps/web/core/components/issues/`; exposes a
 * store-hydrated flavor (`TIssueIdentifierFromStore` reads from MobX) and a
 * store-less flavor (`TIssueIdentifierWithDetails` for search/webhook
 * contexts) combined as the structurally-discriminated `TIssueIdentifierProps`.
 */

import type { IIssueDisplayProperties } from "../view-props";

/**
 * Identifier text-scale token mapped to the Tailwind `text-{xs|sm|base|lg}`
 * scale; literal-union (not free pixels) so the design-system contract
 * stays enumerable and off-token sizes are unreachable.
 */
export type TIssueIdentifierSize = "xs" | "sm" | "md" | "lg";

/**
 * Identifier text-color variant token encoding context (default/secondary/
 * tertiary/primary/primary-subtle/success) rather than a raw color so
 * theming and dark-mode mappings stay in the design layer.
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
 * "Lookup" identifier flavor: caller supplies only `issueId` (plus `projectId`
 * from the extended base) and the component reads `projectMap[projectId].identifier`
 * and `issueMap[issueId].sequence_id` from the MobX stores.
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
 * Leaf renderer props for the identifier text — takes an already-formatted
 * `identifier` string plus styling tokens; the `<prefix>-<seq>` composition
 * is intentionally pushed to the caller so this leaf renders either flavor.
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
