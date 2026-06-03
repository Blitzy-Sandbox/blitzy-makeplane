/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Administrative command protocol for cross-server orchestration in the apps/live
 * Hocuspocus cluster.
 *
 * Commands are transported over Redis pub/sub on the `"hocuspocus:admin"` channel
 * (declared as `ADMIN_CHANNEL` in `apps/live/src/extensions/redis.ts`). Redis is
 * used here for command transport only — task queueing in this stack is handled
 * by Celery via RabbitMQ in apps/api.
 *
 * Consumers:
 *   - `apps/live/src/extensions/redis.ts` — owns the admin channel pub/sub and
 *     the `adminHandlers` dispatch table populated via `onAdminCommand`.
 *   - `apps/live/src/extensions/force-close-handler.ts` — registers the
 *     `FORCE_CLOSE` handler and exports `forceCloseDocumentAcrossServers`,
 *     which publishes `ForceCloseCommandData` cluster-wide.
 *   - `apps/live/src/extensions/database.ts` — maps oversized-document errors
 *     onto `ForceCloseReason` / `CloseCode` values before delegating to the
 *     force-close path.
 *
 * The module exposes both compile-time definitions (enums, interfaces, the
 * discriminated `AdminCommandData` union) and runtime helpers (type guards,
 * reason validator, user-facing message mapper). The shared `command`
 * discriminator on every payload is what enables type-safe handler dispatch
 * and narrowing through the type guards declared below.
 */

/**
 * Approved reason set for terminating a document collaboration session;
 * serialized into `ForceCloseCommandData.reason` for cluster-wide commands and
 * into `ClientForceCloseMessage.reason` for the message delivered to clients.
 *
 * Consumed by `extensions/force-close-handler.ts` for cluster-wide termination,
 * by `extensions/database.ts` for the oversized-document termination path, and
 * by `getForceCloseMessage` for client-facing message lookup. Adding a new
 * value here requires extending the `getForceCloseMessage` mapping so the new
 * reason has a user-facing string.
 */
export enum ForceCloseReason {
  CRITICAL_ERROR = "critical_error",
  MEMORY_LEAK = "memory_leak",
  DOCUMENT_TOO_LARGE = "document_too_large",
  ADMIN_REQUEST = "admin_request",
  SERVER_SHUTDOWN = "server_shutdown",
  SECURITY_VIOLATION = "security_violation",
  CORRUPTION_DETECTED = "corruption_detected",
}

/**
 * WebSocket close codes used when terminating a Hocuspocus connection.
 *
 * Covers the RFC 6455 standard range (1000–1015) plus application-specific
 * custom codes in the 4000–4999 range reserved by the WebSocket spec for
 * private use. Consumed by `extensions/force-close-handler.ts` when invoking
 * `connection.close({ code, reason })`.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/code
 */
export enum CloseCode {
  /** Normal closure; the connection successfully completed */
  NORMAL = 1000,
  /** The endpoint is going away (server shutdown or browser navigating away) */
  GOING_AWAY = 1001,
  /** Protocol error */
  PROTOCOL_ERROR = 1002,
  /** Unsupported data */
  UNSUPPORTED_DATA = 1003,
  /** Reserved (no status code was present) */
  NO_STATUS = 1005,
  /** Abnormal closure */
  ABNORMAL = 1006,
  /** Invalid frame payload data */
  INVALID_DATA = 1007,
  /** Policy violation */
  POLICY_VIOLATION = 1008,
  /** Message too big */
  MESSAGE_TOO_BIG = 1009,
  /** Client expected extension not negotiated */
  MANDATORY_EXTENSION = 1010,
  /** Server encountered unexpected condition */
  INTERNAL_ERROR = 1011,
  /** Custom: Force close requested */
  FORCE_CLOSE = 4000,
  /** Custom: Document too large */
  DOCUMENT_TOO_LARGE = 4001,
  /** Custom: Memory pressure */
  MEMORY_PRESSURE = 4002,
  /** Custom: Security violation */
  SECURITY_VIOLATION = 4003,
}

/**
 * Discriminant values for server-to-server admin messages published on the
 * Redis `"hocuspocus:admin"` channel; each value selects a payload variant of
 * the `AdminCommandData` union.
 *
 * Consumed by `extensions/redis.ts` via the `adminHandlers` dispatch table
 * registered through `onAdminCommand`. `extensions/force-close-handler.ts`
 * registers the `FORCE_CLOSE` handler; `RESTART_DOCUMENT` is reserved for a
 * future cluster-wide document restart command and has no handler today.
 */
export enum AdminCommand {
  FORCE_CLOSE = "force_close",
  HEALTH_CHECK = "health_check",
  RESTART_DOCUMENT = "restart_document",
}

/**
 * Payload published over the Redis admin channel to request termination of a
 * specific document's collaboration session across every server in the cluster.
 *
 * @property command - Discriminant literal `AdminCommand.FORCE_CLOSE` selecting
 *   this variant of the `AdminCommandData` union.
 * @property docId - Hocuspocus document ID to terminate; matches the
 *   `instance.documents.get(docId)` lookup in `force-close-handler.ts`.
 * @property reason - Structured termination reason; surfaced to clients via
 *   `getForceCloseMessage`.
 * @property code - WebSocket close code applied to each connection during
 *   `connection.close({ code, reason })`.
 * @property originServer - Identifier of the publishing server, used for
 *   tracing and so receivers can ignore loop-back messages from themselves.
 * @property timestamp - Optional ISO-8601 publication timestamp.
 */
export interface ForceCloseCommandData {
  command: AdminCommand.FORCE_CLOSE;
  docId: string;
  reason: ForceCloseReason;
  code: CloseCode;
  originServer: string;
  timestamp?: string;
}

/**
 * Payload for `AdminCommand.HEALTH_CHECK` messages, used to probe cluster
 * member responsiveness over the admin channel.
 *
 * @property command - Discriminant literal `AdminCommand.HEALTH_CHECK`.
 * @property originServer - Identifier of the publishing server, used by
 *   responders to address replies.
 * @property timestamp - Publication timestamp (required here, unlike the
 *   optional `timestamp` on `ForceCloseCommandData`).
 */
export interface HealthCheckCommandData {
  command: AdminCommand.HEALTH_CHECK;
  originServer: string;
  timestamp: string;
}

/**
 * Discriminated union of every admin command payload; consumers narrow on the
 * shared `command` discriminator to obtain the correct variant.
 *
 * Consumer pattern: `extensions/redis.ts` parses the incoming JSON, casts to
 * `AdminCommandData`, then dispatches via `this.adminHandlers.get(data.command)`
 * inside `handleAdminMessage`.
 */
export type AdminCommandData = ForceCloseCommandData | HealthCheckCommandData;

/**
 * Stateless message broadcast to clients when their collaboration session is
 * being terminated server-side, immediately before the WebSocket close frame
 * is sent.
 *
 * Delivered per-connection via `connection.sendStateless(JSON.stringify(message))`
 * inside `extensions/force-close-handler.ts`, with a brief delay before
 * `connection.close({ code, reason })` so clients have time to render the
 * reason.
 *
 * @property type - Literal `"force_close"` discriminant for the client-side
 *   message router.
 * @property reason - Structured termination reason mirrored from the
 *   originating admin command.
 * @property code - WebSocket close code paired with the close frame.
 * @property message - Optional user-facing explanation, typically populated
 *   from `getForceCloseMessage(reason)`.
 * @property timestamp - Optional ISO-8601 timestamp of when the close was
 *   initiated.
 */
export interface ClientForceCloseMessage {
  type: "force_close";
  reason: ForceCloseReason;
  code: CloseCode;
  message?: string;
  timestamp?: string;
}

/**
 * Synchronous or asynchronous handler signature for processing an admin command.
 *
 * The generic parameter `T extends AdminCommandData` lets registration sites
 * narrow the input type (for example, `AdminCommandHandler<ForceCloseCommandData>`
 * in `force-close-handler.ts`). Handlers are registered with
 * `Redis.onAdminCommand(command, handler)` and invoked from
 * `Redis.handleAdminMessage` when a matching message arrives on the admin
 * channel.
 */
export type AdminCommandHandler<T extends AdminCommandData = AdminCommandData> = (data: T) => Promise<void> | void;

/**
 * Type guard narrowing `AdminCommandData` to `ForceCloseCommandData` via the
 * `command` discriminator.
 *
 * Used as a defensive runtime check inside the force-close handler before
 * destructuring `docId` / `reason` / `code` from the incoming payload (see
 * `extensions/force-close-handler.ts`), since admin messages arrive over
 * untrusted Redis pub/sub.
 */
export function isForceCloseCommand(data: AdminCommandData): data is ForceCloseCommandData {
  return data.command === AdminCommand.FORCE_CLOSE;
}

/**
 * Type guard narrowing `AdminCommandData` to `HealthCheckCommandData` via the
 * `command` discriminator.
 *
 * Exported alongside the force-close guard so health-probe consumers can adopt
 * the same dispatch pattern; no handler for `HEALTH_CHECK` is wired in
 * `extensions/` today.
 */
export function isHealthCheckCommand(data: AdminCommandData): data is HealthCheckCommandData {
  return data.command === AdminCommand.HEALTH_CHECK;
}

/**
 * Runtime validator asserting that an arbitrary string matches one of the
 * `ForceCloseReason` enum values.
 *
 * Admin messages arrive over Redis pub/sub from external publishers — other
 * server instances or operator scripts — so the `reason` field cannot be
 * trusted at compile time. This guard runs before the value is propagated into
 * a `ClientForceCloseMessage` or used to look up a user-facing string via
 * `getForceCloseMessage`.
 */
export function isValidForceCloseReason(reason: string): reason is ForceCloseReason {
  return Object.values(ForceCloseReason).includes(reason as ForceCloseReason);
}

/**
 * Maps a `ForceCloseReason` enum value to a user-facing explanation string for
 * the `ClientForceCloseMessage.message` field, falling back to a generic
 * message for unknown values.
 *
 * Consumed by `extensions/force-close-handler.ts` when assembling the
 * client-bound stateless message immediately before broadcasting. The generic
 * fallback exists specifically to absorb forward-compatibility cases where a
 * remote server publishes a `reason` value not yet known to the local build.
 */
export function getForceCloseMessage(reason: ForceCloseReason): string {
  const messages: Record<ForceCloseReason, string> = {
    [ForceCloseReason.CRITICAL_ERROR]: "A critical error occurred. Please refresh the page.",
    [ForceCloseReason.MEMORY_LEAK]: "Memory limit exceeded. Please refresh the page.",
    [ForceCloseReason.DOCUMENT_TOO_LARGE]:
      "Content limit reached and live sync is off. Create a new page or use nested pages to continue syncing.",
    [ForceCloseReason.ADMIN_REQUEST]: "Connection closed by administrator. Please try again later.",
    [ForceCloseReason.SERVER_SHUTDOWN]: "Server is shutting down. Please reconnect in a moment.",
    [ForceCloseReason.SECURITY_VIOLATION]: "Security violation detected. Connection terminated.",
    [ForceCloseReason.CORRUPTION_DETECTED]: "Data corruption detected. Please refresh the page.",
  };

  return messages[reason] || "Connection closed. Please refresh the page.";
}
