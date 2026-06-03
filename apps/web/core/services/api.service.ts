/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AxiosInstance, AxiosRequestConfig } from "axios";
import axios from "axios";

export abstract class APIService {
  protected baseURL: string;
  private axiosInstance: AxiosInstance;
  /**
   * Cached in-flight or resolved CSRF-token fetch, shared across every request
   * issued by this service instance so the token is fetched at most once.
   */
  private csrfTokenPromise: Promise<string | undefined> | null = null;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
    this.axiosInstance = axios.create({
      baseURL,
      withCredentials: true,
    });

    this.setupInterceptors();
  }

  /**
   * Lazily fetch and cache Django's session CSRF token.
   *
   * The `csrftoken` cookie is HttpOnly (`CSRF_COOKIE_HTTPONLY=True`), so the token
   * cannot be read from `document.cookie`; it is instead read from the body of
   * `GET /auth/get-csrf-token/` and reused for the session. The fetch promise is
   * cached so concurrent mutations share a single network round-trip.
   * @returns {Promise<string | undefined>} The CSRF token, or `undefined` if it could not be obtained.
   */
  private getCSRFToken(): Promise<string | undefined> {
    if (!this.csrfTokenPromise) {
      this.csrfTokenPromise = this.axiosInstance
        .get("/auth/get-csrf-token/")
        .then((response) => (response?.data as { csrf_token?: string } | undefined)?.csrf_token)
        .catch(() => {
          // Drop the cache so a later request can retry the token fetch.
          this.csrfTokenPromise = null;
          return undefined;
        });
    }
    return this.csrfTokenPromise;
  }

  private setupInterceptors() {
    // Attach Django's CSRF token to unsafe methods so session-authenticated DRF
    // mutations satisfy the server's restored CSRF enforcement. Skipped when a
    // caller already set the header explicitly (e.g. the auth/sign-out flow).
    this.axiosInstance.interceptors.request.use(async (config) => {
      const method = config.method?.toLowerCase();
      if (method && ["post", "put", "patch", "delete"].includes(method) && !config.headers.has("X-CSRFTOKEN")) {
        const token = await this.getCSRFToken();
        if (token) config.headers.set("X-CSRFTOKEN", token);
      }
      return config;
    });

    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response && error.response.status === 401) {
          const currentPath = window.location.pathname;
          window.location.replace(`/${currentPath ? `?next_path=${currentPath}` : ``}`);
        }
        // A stale CSRF token (e.g. after a session change) yields 403; drop the
        // cached token so the next unsafe request fetches a fresh one.
        if (error.response && error.response.status === 403) {
          this.csrfTokenPromise = null;
        }
        return Promise.reject(error);
      }
    );
  }

  get(url: string, params = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.get(url, {
      ...params,
      ...config,
    });
  }

  post(url: string, data = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.post(url, data, config);
  }

  put(url: string, data = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.put(url, data, config);
  }

  patch(url: string, data = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.patch(url, data, config);
  }

  delete(url: string, data?: any, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.delete(url, { data, ...config });
  }

  request(config = {}) {
    return this.axiosInstance(config);
  }
}
