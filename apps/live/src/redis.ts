/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Process-wide Redis access layer for the apps/live real-time collaboration service.
 *
 * Exports {@link RedisManager} (singleton class) and {@link redisManager} (the
 * default instance shared across the process).
 *
 * Architectural role: Redis here is used for caching, session, and pub/sub
 * awareness only — task queueing uses RabbitMQ via apps/api. The Hocuspocus
 * Redis extension in `apps/live/src/extensions/redis.ts` consumes this
 * manager's client (via `.duplicate()`) for multi-node awareness propagation
 * and the admin pub/sub channel, NOT for task queueing.
 *
 * Connection bootstrap is idempotent (in-flight Promise guard) and the
 * underlying ioredis client is configured with automatic reconnection
 * (exponential backoff capped at 2s), 30s keep-alive, 10s connect timeout,
 * 3 retries per request, and an enabled offline queue. {@link RedisManager.initialize}
 * performs an initial PING to confirm reachability before returning.
 */

import Redis from "ioredis";
import { logger } from "@plane/logger";
import { env } from "./env";

/**
 * Singleton ioredis manager for the apps/live process.
 *
 * Singleton pattern: private constructor + static `instance` field +
 * {@link RedisManager.getInstance} factory. The `redisManager` export at the
 * bottom of this module is the default instance — prefer that over calling
 * {@link RedisManager.getInstance} directly.
 *
 * Connection state:
 *  - `redisClient`: the ioredis instance, or `null` when disconnected or
 *    when no Redis URL is configured.
 *  - `isConnected`: boolean flag maintained by the ioredis event listeners
 *    (`connect`/`ready` → true; `error`/`close`/`reconnecting` → false).
 *  - `connectionPromise`: in-flight initialization guard so concurrent
 *    callers of {@link RedisManager.initialize} serialize on the same attempt.
 *
 * Configuration source: resolves the URL from `env.REDIS_URL` first, falling
 * back to `redis://${env.REDIS_HOST}:${env.REDIS_PORT}` when both are
 * provided. If neither path produces a URL, Redis is gracefully disabled —
 * {@link RedisManager.getClient} returns `null` and the convenience methods
 * short-circuit to `false`/`null`.
 *
 * ioredis options applied (tuned so Hocuspocus's `.duplicate()` inherits
 * cleanly into the pub/sub connection):
 *  - `lazyConnect: false` — eager connect for reliability
 *  - `keepAlive: 30000`
 *  - `connectTimeout: 10000`
 *  - `maxRetriesPerRequest: 3`
 *  - `enableOfflineQueue: true`
 *  - `retryStrategy`: exponential backoff `min(times * 50, 2000)` ms
 *
 * Architectural note: Redis is caching/session/pub-sub only — task queueing
 * uses RabbitMQ via apps/api.
 *
 * Convenience methods ({@link RedisManager.set}, {@link RedisManager.get},
 * {@link RedisManager.del}, {@link RedisManager.exists},
 * {@link RedisManager.expire}) each guard against a null client and log
 * errors via `@plane/logger` without throwing, so callers can use the return
 * value for control flow.
 */
export class RedisManager {
  private static instance: RedisManager;
  private redisClient: Redis | null = null;
  private isConnected: boolean = false;
  private connectionPromise: Promise<void> | null = null;

  private constructor() {}

  /**
   * Returns the process-wide {@link RedisManager} singleton, lazily
   * constructing it on first call. Used by `server.ts` and any module
   * needing process-wide Redis access.
   */
  public static getInstance(): RedisManager {
    if (!RedisManager.instance) {
      RedisManager.instance = new RedisManager();
    }
    return RedisManager.instance;
  }

  /**
   * Idempotently bootstraps the underlying ioredis client.
   *
   * Early-returns if the client already exists and is connected; if another
   * caller has an in-flight initialization, awaits that shared
   * `connectionPromise` instead of starting a second connection attempt.
   * Otherwise, kicks off {@link RedisManager.connect} and stores its promise
   * so concurrent callers serialize on the same attempt.
   *
   * Called once during server bootstrap from `server.ts.initialize()`;
   * subsequent invocations are safe no-ops.
   */
  public async initialize(): Promise<void> {
    if (this.redisClient && this.isConnected) {
      logger.info("REDIS_MANAGER: client already initialized and connected");
      return;
    }

    if (this.connectionPromise) {
      logger.info("REDIS_MANAGER: Redis connection already in progress, waiting...");
      await this.connectionPromise;
      return;
    }

    this.connectionPromise = this.connect();
    await this.connectionPromise;
  }

  /**
   * Resolves the Redis URL from environment configuration.
   *
   * Resolution order: `env.REDIS_URL` takes precedence; otherwise constructs
   * `redis://${env.REDIS_HOST}:${env.REDIS_PORT}` if both are present and
   * the port is numeric. Returns an empty string when neither path produces
   * a URL — the empty string is the signal that disables Redis.
   */
  private getRedisUrl(): string {
    const redisUrl = env.REDIS_URL;
    const redisHost = env.REDIS_HOST;
    const redisPort = env.REDIS_PORT;

    if (redisUrl) {
      return redisUrl;
    }

    if (redisHost && redisPort && !Number.isNaN(Number(redisPort))) {
      return `redis://${redisHost}:${redisPort}`;
    }

    return "";
  }

  /**
   * Constructs the ioredis client, wires up event listeners, and performs
   * an initial PING to confirm reachability.
   *
   * Behavior: resolves the URL via {@link RedisManager.getRedisUrl}; if no
   * URL is configured, logs a warning and returns silently (Redis disabled).
   * Otherwise instantiates `Redis` with the retry/timeout configuration,
   * registers listeners that maintain `isConnected`
   * (`connect`/`ready` → true; `error`/`close`/`reconnecting` → false), and
   * awaits an initial PING.
   *
   * Error handling: a PING failure (or any thrown error) sets
   * `isConnected = false` and rethrows so {@link RedisManager.initialize}
   * propagates the error to its caller; the `connectionPromise` is always
   * cleared in the `finally` block so a subsequent retry is unblocked.
   */
  private async connect(): Promise<void> {
    try {
      const redisUrl = this.getRedisUrl();

      if (!redisUrl) {
        logger.warn("REDIS_MANAGER: No Redis URL provided, Redis functionality will be disabled");
        this.isConnected = false;
        return;
      }

      // Configuration optimized for BOTH regular operations AND pub/sub
      // HocuspocusRedis uses .duplicate() which inherits these settings
      this.redisClient = new Redis(redisUrl, {
        lazyConnect: false, // Connect immediately for reliability (duplicates inherit this)
        keepAlive: 30000,
        connectTimeout: 10000,
        maxRetriesPerRequest: 3,
        enableOfflineQueue: true, // Keep commands queued during reconnection
        retryStrategy: (times: number) => {
          // Exponential backoff with max 2 seconds
          const delay = Math.min(times * 50, 2000);
          logger.info(`REDIS_MANAGER: Reconnection attempt ${times}, delay: ${delay}ms`);
          return delay;
        },
      });

      // Set up event listeners
      this.redisClient.on("connect", () => {
        logger.info("REDIS_MANAGER: Redis client connected");
        this.isConnected = true;
      });

      this.redisClient.on("ready", () => {
        logger.info("REDIS_MANAGER: Redis client ready");
        this.isConnected = true;
      });

      this.redisClient.on("error", (error) => {
        logger.error("REDIS_MANAGER: Redis client error:", error);
        this.isConnected = false;
      });

      this.redisClient.on("close", () => {
        logger.warn("REDIS_MANAGER: Redis client connection closed");
        this.isConnected = false;
      });

      this.redisClient.on("reconnecting", () => {
        logger.info("REDIS_MANAGER: Redis client reconnecting...");
        this.isConnected = false;
      });

      await this.redisClient.ping();
      logger.info("REDIS_MANAGER: Redis connection test successful");
    } catch (error) {
      logger.error("REDIS_MANAGER: Failed to initialize Redis client:", error);
      this.isConnected = false;
      throw error;
    } finally {
      this.connectionPromise = null;
    }
  }

  /**
   * Returns the underlying ioredis client, or `null` when it is missing or
   * not connected. Consumers: `apps/live/src/extensions/redis.ts` (Hocuspocus
   * Redis extension — duplicates this client for the pub/sub channel) and
   * `apps/live/src/extensions/force-close-handler.ts` (Redis pub/sub admin
   * channel, via the Redis extension wrapper).
   */
  public getClient(): Redis | null {
    if (!this.redisClient || !this.isConnected) {
      logger.warn("REDIS_MANAGER: Redis client not available or not connected");
      return null;
    }
    return this.redisClient;
  }

  /**
   * Returns `true` only when the client exists AND the event-listener-tracked
   * `isConnected` flag is set. Use this for health/readiness probes that
   * should not emit a warning log on disconnect.
   */
  public isClientConnected(): boolean {
    return this.isConnected && this.redisClient !== null;
  }

  /**
   * Gracefully shuts down the Redis client.
   *
   * Attempts `client.quit()` (drains pending commands); falls back to
   * `client.disconnect()` (immediate close) when `quit()` throws. Always
   * clears the `redisClient` reference and resets `isConnected` to `false`.
   * Called from `server.ts.destroy()` during SIGTERM/SIGINT teardown.
   */
  public async disconnect(): Promise<void> {
    if (this.redisClient) {
      try {
        await this.redisClient.quit();
        logger.info("REDIS_MANAGER: Redis client disconnected gracefully");
      } catch (error) {
        logger.error("REDIS_MANAGER: Error disconnecting Redis client:", error);
        // Force disconnect if quit fails
        this.redisClient.disconnect();
      } finally {
        this.redisClient = null;
        this.isConnected = false;
      }
    }
  }

  // Convenience methods for common Redis operations
  /**
   * Writes a key/value pair to Redis, optionally with a TTL (seconds).
   *
   * Uses `SETEX` when `ttl` is provided, plain `SET` otherwise. Returns
   * `true` on success, `false` when the client is disconnected or the
   * command throws (error is logged via `@plane/logger`, never rethrown).
   */
  public async set(key: string, value: string, ttl?: number): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;

    try {
      if (ttl) {
        await client.setex(key, ttl, value);
      } else {
        await client.set(key, value);
      }
      return true;
    } catch (error) {
      logger.error(`REDIS_MANAGER: Error setting Redis key ${key}:`, error);
      return false;
    }
  }

  /**
   * Returns the string value stored at `key`, or `null` when the key does
   * not exist, the client is disconnected, or the command throws (error is
   * logged via `@plane/logger`, never rethrown).
   */
  public async get(key: string): Promise<string | null> {
    const client = this.getClient();
    if (!client) return null;

    try {
      return await client.get(key);
    } catch (error) {
      logger.error(`REDIS_MANAGER: Error getting Redis key ${key}:`, error);
      return null;
    }
  }

  /**
   * Deletes `key` from Redis. Returns `true` on success, `false` when the
   * client is disconnected or the command throws (error is logged via
   * `@plane/logger`, never rethrown).
   */
  public async del(key: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;

    try {
      await client.del(key);
      return true;
    } catch (error) {
      logger.error(`REDIS_MANAGER: Error deleting Redis key ${key}:`, error);
      return false;
    }
  }

  /**
   * Returns `true` when `key` exists, `false` otherwise — including when the
   * client is disconnected or the command throws (error is logged via
   * `@plane/logger`, never rethrown).
   */
  public async exists(key: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;

    try {
      const result = await client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error(`REDIS_MANAGER: Error checking Redis key ${key}:`, error);
      return false;
    }
  }

  /**
   * Sets a TTL (seconds) on an existing key. Returns `true` when the key
   * existed and the TTL was applied, `false` otherwise — including when the
   * client is disconnected or the command throws (error is logged via
   * `@plane/logger`, never rethrown).
   */
  public async expire(key: string, ttl: number): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;

    try {
      const result = await client.expire(key, ttl);
      return result === 1;
    } catch (error) {
      logger.error(`REDIS_MANAGER: Error setting expiry for Redis key ${key}:`, error);
      return false;
    }
  }
}

// Export a default instance for convenience
/**
 * Default singleton {@link RedisManager} instance — the process-wide entry
 * point for Redis access from apps/live. Most callers should import this
 * export directly rather than calling {@link RedisManager.getInstance}.
 */
export const redisManager = RedisManager.getInstance();
