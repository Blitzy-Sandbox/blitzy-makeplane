/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Generic debounce + abort engine that powers the title persistence runtime
 * in `./title-update-manager.ts`.
 *
 * Behavior: rapid `schedule()` calls collapse into a single trailing-edge
 * execution after the configured `wait` window has elapsed since the last
 * call. Leading-edge invocation is intentionally not supported so that
 * persistence never observes a partially-typed title.
 *
 * Abort-aware: in-progress invocations are aborted via `AbortController`
 * when a newer call arrives, preserving the latest arguments for the next
 * execution. The abort signal is forwarded to the user function as the
 * LAST argument, which makes it compatible with axios `signal` cancellation
 * (used by `TitleUpdateManager.updateTitle` to cancel in-flight page PATCH
 * requests).
 *
 * Memory safety: timers and abort controllers are cleared on `cancel()` and
 * `flush()` so consumers can release the manager without lingering work.
 *
 * Consumers (as of writing): the only consumer in `apps/live` is
 * `apps/live/src/extensions/title-update/title-update-manager.ts`
 * (`TitleUpdateManager`), which wraps this engine to persist Plane page
 * titles through the page service.
 *
 * Architectural note: this is a reusable generic utility — NOT a Hocuspocus
 * extension. It does not depend on Hocuspocus, Yjs, Redis, or any
 * persistence layer and could be used in any Node service. Its only
 * external dependency is `@plane/logger` for diagnostic error logging.
 *
 * Document lifecycle role (Plane real-time collaboration):
 *   - `edit`               → `schedule()` via `TitleUpdateManager.scheduleUpdate`
 *   - `persist`            → `performFunction()` invokes the page service PATCH
 *   - `disconnect` (graceful) → `flush()` via `TitleUpdateManager.forceSave`
 *   - `disconnect` (defensive) → `cancel()` via `TitleUpdateManager.cancel`
 */

import { logger } from "@plane/logger";

/**
 * DebounceState - Tracks the state of a debounced function
 *
 * Fields:
 *   - `lastArgs`: latest pending arguments captured by `schedule()`; consumed
 *     by `performFunction` on trailing-edge execution. `null` indicates no
 *     pending invocation.
 *   - `timerId`: handle for the active `setTimeout` (or `null` if no timer
 *     is pending). Cleared on cancel, flush, and on successful execution.
 *   - `lastCallTime`: epoch-ms timestamp of the most recent `schedule()`
 *     call. Used by `shouldInvoke()` and `remainingWait()` to decide whether
 *     the debounce window has elapsed. `undefined` until the first call.
 *   - `lastExecutionTime`: epoch-ms timestamp of the most recent
 *     `performFunction` invocation. Informational only — not consulted by
 *     `shouldInvoke`.
 *   - `inProgress`: true while `performFunction` is awaiting the user
 *     function; coordinates `abortOngoingOperation` with new `schedule()`
 *     calls.
 *   - `abortController`: controller whose signal is forwarded to the user
 *     function as the LAST argument; aborted when a newer call arrives
 *     mid-execution.
 */
export interface DebounceState {
  lastArgs: any[] | null;
  timerId: ReturnType<typeof setTimeout> | null;
  lastCallTime: number | undefined;
  lastExecutionTime: number;
  inProgress: boolean;
  abortController: AbortController | null;
}

/**
 * Creates a new DebounceState object
 *
 * Returns a fresh `DebounceState` with all fields initialized to no-op
 * values (`null` for refs, `undefined` for `lastCallTime`, `0` for
 * `lastExecutionTime`, `false` for `inProgress`). Used internally by
 * `DebounceManager`'s constructor; exported for testability so tests can
 * construct a clean state without instantiating a full manager.
 */
export const createDebounceState = (): DebounceState => ({
  lastArgs: null,
  timerId: null,
  lastCallTime: undefined,
  lastExecutionTime: 0,
  inProgress: false,
  abortController: null,
});

/**
 * DebounceOptions - Configuration options for debounce
 *
 * Fields:
 *   - `wait` (required): debounce window in milliseconds; controls how long
 *     after the last `schedule()` call the function fires on the trailing
 *     edge.
 *   - `logPrefix` (optional): prefix attached to `@plane/logger.error` calls
 *     so logs from concurrent debounce managers can be distinguished.
 *     `title-update-manager.ts` sets this to
 *     `"TitleManager[<first-8-chars-of-documentName>]"`.
 */
export interface DebounceOptions {
  /** The wait time in milliseconds */
  wait: number;

  /** Optional logging prefix for debug messages */
  logPrefix?: string;
}

/**
 * Enhanced debounce manager with abort support
 * Manages the state and timing of debounced function calls
 *
 * Trailing-edge debounce contract: every `schedule(func, ...args)` call
 * extends the timer to the full `wait` interval; the function is invoked
 * exactly once, with the LATEST arguments, after `wait` ms have elapsed
 * since the last call. Leading-edge invocation is intentionally not
 * supported — leading-edge would surface incomplete user input (e.g., a
 * half-typed page title) to the persistence layer.
 *
 * Abort behavior: if a new `schedule()` call arrives while the user
 * function is executing, the in-progress execution is aborted via
 * `AbortController.abort()` and the new arguments are queued for the next
 * cycle. The user function MUST accept the abort signal as its LAST
 * argument and check `signal.aborted` (or pass the signal to an
 * axios/fetch request) to opt into cooperative abort.
 *
 * Retry on error: if the user function throws a non-`AbortError`, the
 * manager logs via `@plane/logger.error` and re-arms the timer to retry on
 * the next cycle (provided `lastArgs` is still set). Transient errors —
 * e.g., a temporary network failure on the title PATCH — therefore
 * self-recover without caller intervention.
 *
 * State: holds a private `DebounceState` together with the `wait` and
 * `logPrefix` configuration captured at construction time.
 */
export class DebounceManager {
  private state: DebounceState;
  private wait: number;
  private logPrefix: string;

  /**
   * Creates a new DebounceManager
   *
   * Wraps `createDebounceState()` to initialize internal state, stores
   * `options.wait` as the debounce window, and stores `options.logPrefix`
   * (defaulting to an empty string) for diagnostic log correlation.
   *
   * @param options Debounce configuration options
   */
  constructor(options: DebounceOptions) {
    this.state = createDebounceState();
    this.wait = options.wait;
    this.logPrefix = options.logPrefix || "";
  }

  /**
   * Schedule a debounced function call
   *
   * Always overwrites any previously stored `args` with the latest values
   * and restarts the timer to fire `wait` ms later (resetting any pending
   * timer). Three branches handle the cases below; in all three, rapid
   * calls collapse into a single trailing-edge execution — leading-edge
   * invocation is intentionally not supported.
   *
   *   (a) in-progress operation — store new args + restart timer; the
   *       running execution will detect the changed args and the next
   *       cycle will pick them up.
   *   (b) already-scheduled timer — clear it and restart with the new
   *       wait window.
   *   (c) cold start — arm a fresh timer for the trailing-edge fire.
   *
   * @param func The function to call
   * @param args The arguments to pass to the function
   */
  schedule(func: (...args: any[]) => Promise<void>, ...args: any[]): void {
    // Always update the last arguments
    this.state.lastArgs = args;

    const time = Date.now();
    this.state.lastCallTime = time;

    // If an operation is in progress, just store the new args and start the timer
    if (this.state.inProgress) {
      // Always restart the timer for the new call, even if an operation is in progress
      if (this.state.timerId) {
        clearTimeout(this.state.timerId);
      }

      this.state.timerId = setTimeout(() => {
        this.timerExpired(func);
      }, this.wait);
      return;
    }

    // If already scheduled, update the args and restart the timer
    if (this.state.timerId) {
      clearTimeout(this.state.timerId);
      this.state.timerId = setTimeout(() => {
        this.timerExpired(func);
      }, this.wait);
      return;
    }

    // Start the timer for the trailing edge execution
    this.state.timerId = setTimeout(() => {
      this.timerExpired(func);
    }, this.wait);
  }

  /**
   * Called when the timer expires
   *
   * Invoked when `setTimeout` fires. Uses `shouldInvoke(time)` to decide
   * whether the full debounce window has truly elapsed since the last
   * `schedule()` call:
   *   - true  → calls `executeFunction(func, time)`.
   *   - false → re-arms the timer for `remainingWait(time)` more
   *             milliseconds. This handles the race where `schedule()` was
   *             called shortly before the timer fired, which must extend
   *             the wait window rather than execute prematurely.
   */
  private timerExpired(func: (...args: any[]) => Promise<void>): void {
    const time = Date.now();

    // Check if this timer expiration represents the end of the debounce period
    if (this.shouldInvoke(time)) {
      // Execute the function
      this.executeFunction(func, time);
      return;
    }

    // Otherwise restart the timer
    this.state.timerId = setTimeout(() => {
      this.timerExpired(func);
    }, this.remainingWait(time));
  }

  /**
   * Execute the debounced function
   *
   * Clears the timer (`timerId = null`), records `lastExecutionTime`, and
   * asynchronously dispatches `performFunction(func)`. The `.catch(...)`
   * tail logs any unhandled rejection via `@plane/logger.error` so a
   * swallowed Promise rejection cannot crash the Node process.
   */
  private executeFunction(func: (...args: any[]) => Promise<void>, time: number): void {
    this.state.timerId = null;
    this.state.lastExecutionTime = time;

    // Execute the function asynchronously
    this.performFunction(func).catch((error) => {
      logger.error(`${this.logPrefix}: Error in execution:`, error);
    });
  }

  /**
   * Perform the actual function call, handling any in-progress operations
   *
   * Executes the abort-aware trailing-edge sequence:
   *   1. Snapshot the current `lastArgs` (via `[...args]`) so we can detect
   *      whether `schedule()` updates them mid-execution.
   *   2. Abort any in-progress operation via `abortOngoingOperation()`
   *      (which waits 20 ms for the abort to propagate).
   *   3. Mark `inProgress = true` and allocate a fresh `AbortController`.
   *   4. Invoke `func(...currentArgs, abortController.signal)` — the
   *      `signal` is appended as the LAST argument so consumers can opt
   *      into abort-awareness without changing the function's normal
   *      signature.
   *   5. On success:
   *        - If `lastArgs` is unchanged (`arraysEqual`), clear `lastArgs`
   *          and the timer — we are done.
   *        - If `lastArgs` was updated mid-execution, ensure a timer is
   *          running so the next cycle picks up the new args.
   *   6. On `AbortError`: silent — the new call's timer is already running
   *      and will pick up the new args on the next cycle.
   *   7. On other errors: log via `@plane/logger.error` and arm a retry
   *      timer if `lastArgs` is still set, so transient errors self-recover.
   *   8. In `finally`: reset `inProgress` and `abortController` regardless
   *      of outcome.
   */
  private async performFunction(func: (...args: any[]) => Promise<void>): Promise<void> {
    const args = this.state.lastArgs;
    if (!args) return;

    // Store the args we're about to use
    const currentArgs = [...args];

    // If another operation is in progress, abort it
    await this.abortOngoingOperation();

    // Mark that we're starting a new operation
    this.state.inProgress = true;
    this.state.abortController = new AbortController();

    try {
      // Add the abort signal to the arguments if the function can use it
      const execArgs = [...currentArgs];
      execArgs.push(this.state.abortController.signal);

      await func(...execArgs);

      // Only clear lastArgs if they haven't been changed during this operation
      if (this.state.lastArgs && this.arraysEqual(this.state.lastArgs, currentArgs)) {
        this.state.lastArgs = null;

        // Clear any timer as we've successfully processed the latest args
        if (this.state.timerId) {
          clearTimeout(this.state.timerId);
          this.state.timerId = null;
        }
      } else if (this.state.lastArgs) {
        // If lastArgs have changed during this operation, the timer should already be running
        // but let's make sure it is
        if (!this.state.timerId) {
          this.state.timerId = setTimeout(() => {
            this.timerExpired(func);
          }, this.wait);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        // Nothing to do here, the new operation will be triggered by the timer expiration
      } else {
        logger.error(`${this.logPrefix}: Error during operation:`, error);

        // On error (not abort), make sure we have a timer running to retry
        if (!this.state.timerId && this.state.lastArgs) {
          this.state.timerId = setTimeout(() => {
            this.timerExpired(func);
          }, this.wait);
        }
      }
    } finally {
      this.state.inProgress = false;
      this.state.abortController = null;
    }
  }

  /**
   * Abort any ongoing operation
   *
   * If `inProgress` is true and an `AbortController` exists, calls
   * `abort()` and waits 20 ms (`await new Promise(r => setTimeout(r, 20))`)
   * to let the abort propagate to the awaiting user function. The wait is
   * empirical — long enough for axios cancellation tokens (used by
   * `TitleUpdateManager.updateTitle`'s page service PATCH) to observe the
   * abort, short enough to not noticeably delay the next cycle.
   *
   * Afterwards, double-checks state cleanup: if `inProgress` or
   * `abortController` is still set (e.g., the user function ignored the
   * abort signal), force-resets to defensive defaults so the next
   * `performFunction` call starts from a clean slate.
   */
  private async abortOngoingOperation(): Promise<void> {
    if (this.state.inProgress && this.state.abortController) {
      this.state.abortController.abort();

      // Small delay to ensure the abort has had time to propagate
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Double-check that state has been reset, force it if not
      if (this.state.inProgress || this.state.abortController) {
        this.state.inProgress = false;
        this.state.abortController = null;
      }
    }
  }

  /**
   * Determine if we should invoke the function now
   *
   * Returns `true` when this is the first call (`lastCallTime === undefined`)
   * OR the elapsed time since the last `schedule()` call
   * (`time - lastCallTime`) meets or exceeds `wait`. Used by `timerExpired`
   * to detect the race where `schedule()` was called between timer arming
   * and timer firing — in that case the timer must be re-armed instead of
   * executing.
   */
  private shouldInvoke(time: number): boolean {
    // Either this is the first call, or we've waited long enough since the last call
    return this.state.lastCallTime === undefined || time - this.state.lastCallTime >= this.wait;
  }

  /**
   * Calculate how much longer we should wait
   *
   * Returns the time remaining before the next execution should fire:
   * `max(0, wait - (time - lastCallTime))`. Used to re-arm the timer when
   * `shouldInvoke` returns false — i.e., a fresh `schedule()` call
   * extended the wait window between timer arming and timer firing.
   */
  private remainingWait(time: number): number {
    const timeSinceLastCall = time - (this.state.lastCallTime || 0);
    return Math.max(0, this.wait - timeSinceLastCall);
  }

  /**
   * Force immediate execution
   *
   * Public method that force-executes the pending operation immediately,
   * bypassing the debounce window. Clears the pending timer via
   * `clearTimeout`, resets `lastCallTime = undefined`, and calls
   * `performFunction(func)` directly if `lastArgs` is set; no-op when
   * there is nothing pending.
   *
   * Primary caller: `TitleUpdateManager.forceSave`, which is invoked from
   * `title-sync.ts.beforeUnloadDocument` to flush the pending title PATCH
   * before the document is unloaded.
   */
  async flush(func: (...args: any[]) => Promise<void>): Promise<void> {
    // Clear any pending timeout
    if (this.state.timerId) {
      clearTimeout(this.state.timerId);
      this.state.timerId = null;
    }

    // Reset timing state
    this.state.lastCallTime = undefined;

    // Perform the function immediately
    if (this.state.lastArgs) {
      await this.performFunction(func);
    }
  }

  /**
   * Cancel any pending operations without executing
   *
   * Public method that discards any pending operation WITHOUT executing.
   * Clears the timer, resets `lastCallTime = undefined`, aborts any
   * in-progress execution via `abortController.abort()`, and clears
   * `lastArgs` so subsequent `flush()` calls become no-ops.
   *
   * Primary caller: `TitleUpdateManager.cancel`, which is invoked from
   * `title-sync.ts.afterUnloadDocument` as a defense-in-depth cleanup for
   * the case where `beforeUnloadDocument` did not run (e.g., abrupt
   * disconnect).
   */
  cancel(): void {
    // Clear any pending timeout
    if (this.state.timerId) {
      clearTimeout(this.state.timerId);
      this.state.timerId = null;
    }

    // Reset timing state
    this.state.lastCallTime = undefined;

    // Abort any in-progress operation
    if (this.state.inProgress && this.state.abortController) {
      this.state.abortController.abort();
      this.state.inProgress = false;
      this.state.abortController = null;
    }

    // Clear args
    this.state.lastArgs = null;
  }

  /**
   * Compare two arrays for equality
   *
   * Element-wise strict-equality (`===`) check between two arrays of
   * `any`. Used in `performFunction` to detect whether `lastArgs` was
   * updated mid-execution (which would indicate `schedule()` was called
   * between the snapshot and the function call). Length check runs first
   * and bails immediately on mismatch.
   *
   * `===` reference equality is appropriate for the title-update use case
   * where the only argument is a primitive `string`. Future callers that
   * pass object or array arguments would need a deeper equality check.
   */
  private arraysEqual(a: any[], b: any[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
}
