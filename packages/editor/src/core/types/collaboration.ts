/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Collaboration lifecycle type contracts for `@plane/editor`.
 *
 * Models the staged connection state machine (`CollabStage`), the error
 * variants surfaced when connectivity or authentication fails
 * (`CollaborationError`), the public snapshot consumers observe
 * (`CollaborationState`), and the consumer-supplied handler that reacts to
 * state transitions (`TServerHandler`).
 *
 * These types form the contract between the Hocuspocus-backed Yjs provider
 * setup inside the editor and any component that needs to render or react
 * to collaboration status (e.g., a "syncing…" indicator or a reconnect UI).
 *
 * Consumers: `core/hooks/use-yjs-setup.ts` (drives stage transitions and
 * emits `CollaborationState` updates), `core/contexts/collaboration-context.tsx`
 * (re-exposes the setup return value via React context), and any editor
 * variant accepting a `serverHandler` prop — currently the collaborative
 * document editor (`ICollaborativeDocumentEditorProps.serverHandler`).
 */

/**
 * Discriminated union of collaboration error variants surfaced to consumers
 * when the Yjs/Hocuspocus connection cannot be established or maintained.
 *
 * The `type` field is the discriminator; each variant has a distinct
 * semantic that consumers may need to differentiate (e.g., retry vs. show
 * an auth prompt vs. fall back to read-only):
 *
 * - `"auth-failed"` — the auth token attached to the WebSocket upgrade was
 *   rejected by `apps/live` (e.g., expired or invalid session cookie). Not
 *   recoverable by simple reconnect; usually requires re-authentication.
 * - `"network-error"` — transport-level failure (socket dropped, DNS, TLS,
 *   etc.) not initiated by a server-policy decision. Eligible for the
 *   standard reconnect-with-backoff loop.
 * - `"forced-close"` — the server actively terminated the connection. The
 *   numeric `code` is a secondary discriminator that maps to a server-policy
 *   reason (e.g., page locked, archived, or content size exceeded). Consumers
 *   should treat this as terminal and surface the cause to the user.
 * - `"max-retries"` — the reconnect-with-backoff loop exhausted its attempt
 *   budget without recovering connectivity. Treated as terminal by the
 *   editor; consumers typically prompt the user to reload.
 */
export type CollaborationError =
  | { type: "auth-failed"; message: string }
  | { type: "network-error"; message: string }
  | { type: "forced-close"; code: number; message: string }
  | { type: "max-retries"; message: string };

/**
 * Single-stage state machine for collaboration lifecycle.
 * Stages represent the sequential progression: initial → connecting → awaiting-sync → synced
 *
 * Invariants:
 * - "awaiting-sync" only occurs when connection is successful and sync is pending
 * - "synced" occurs only after connection success and onSynced callback
 * - "reconnecting" with attempt > 0 when retrying after a connection drop
 * - "disconnected" is terminal (connection failed or forced close)
 */
export type CollabStage =
  | { kind: "initial" }
  | { kind: "connecting" }
  | { kind: "awaiting-sync" }
  | { kind: "synced" }
  | { kind: "reconnecting"; attempt: number }
  | { kind: "disconnected"; error: CollaborationError };

/**
 * Public collaboration state exposed to consumers.
 * Contains the current stage and derived booleans for convenience.
 */
export type CollaborationState = {
  stage: CollabStage;
  isServerSynced: boolean;
  isServerDisconnected: boolean;
};

/**
 * Consumer-supplied handler that observes collaboration state transitions.
 *
 * The editor owns the staged transitions internally; consumers subscribe via
 * `onStateChange` to react to milestones — for example, showing a "syncing…"
 * indicator while in `awaiting-sync`, prompting the user on `disconnected`,
 * or revealing the document once `synced` is reached. A callback is used
 * (rather than direct state access) so that consumers can be notified
 * imperatively from inside the provider's lifecycle hooks without coupling
 * to the editor's internal stage representation.
 *
 * Consumer: editor variants wiring `serverHandler` — currently the
 * collaborative document editor via `ICollaborativeDocumentEditorProps.serverHandler`.
 */
export type TServerHandler = {
  onStateChange: (state: CollaborationState) => void;
};
