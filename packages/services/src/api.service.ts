/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { AxiosInstance, AxiosRequestConfig } from "axios";
import axios from "axios";

/**
 * Abstract base class for making HTTP requests using axios
 * @abstract
 */
export abstract class APIService {
  protected baseURL: string;
  private axiosInstance: AxiosInstance;
  /**
   * Cached in-flight or resolved CSRF-token fetch, shared across every request
   * issued by this service instance so the token is fetched at most once.
   */
  private csrfTokenPromise: Promise<string | undefined> | null = null;

  /**
   * Creates an instance of APIService
   * @param {string} baseURL - The base URL for all HTTP requests
   */
  constructor(baseURL: string) {
    this.baseURL = baseURL;
    this.axiosInstance = axios.create({
      baseURL,
      withCredentials: true,
    });

    // Attach Django's CSRF token to unsafe methods so session-authenticated DRF
    // mutations satisfy the server's CSRF enforcement. Skipped when a caller has
    // already set the header explicitly (e.g. the auth/sign-out flow).
    this.axiosInstance.interceptors.request.use(async (config) => {
      const method = config.method?.toLowerCase();
      if (method && ["post", "put", "patch", "delete"].includes(method) && !config.headers.has("X-CSRFTOKEN")) {
        const token = await this.getCSRFToken();
        if (token) config.headers.set("X-CSRFTOKEN", token);
      }
      return config;
    });
  }

  /**
   * Lazily fetch and cache Django's session CSRF token.
   *
   * The `csrftoken` cookie is HttpOnly (`CSRF_COOKIE_HTTPONLY=True`), so the token
   * cannot be read from `document.cookie`; it is read from the body of
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

  /**
   * Makes a GET request to the specified URL
   * @param {string} url - The endpoint URL
   * @param {object} [params={}] - URL parameters
   * @param {AxiosRequestConfig} [config={}] - Additional axios configuration
   * @returns {Promise} Axios response promise
   */
  get(url: string, params = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.get(url, {
      ...params,
      ...config,
    });
  }

  /**
   * Makes a POST request to the specified URL
   * @param {string} url - The endpoint URL
   * @param {object} [data={}] - Request body data
   * @param {AxiosRequestConfig} [config={}] - Additional axios configuration
   * @returns {Promise} Axios response promise
   */
  post(url: string, data = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.post(url, data, config);
  }

  /**
   * Makes a PUT request to the specified URL
   * @param {string} url - The endpoint URL
   * @param {object} [data={}] - Request body data
   * @param {AxiosRequestConfig} [config={}] - Additional axios configuration
   * @returns {Promise} Axios response promise
   */
  put(url: string, data = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.put(url, data, config);
  }

  /**
   * Makes a PATCH request to the specified URL
   * @param {string} url - The endpoint URL
   * @param {object} [data={}] - Request body data
   * @param {AxiosRequestConfig} [config={}] - Additional axios configuration
   * @returns {Promise} Axios response promise
   */
  patch(url: string, data = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.patch(url, data, config);
  }

  /**
   * Makes a DELETE request to the specified URL
   * @param {string} url - The endpoint URL
   * @param {any} [data] - Request body data
   * @param {AxiosRequestConfig} [config={}] - Additional axios configuration
   * @returns {Promise} Axios response promise
   */
  delete(url: string, data?: any, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.delete(url, { data, ...config });
  }

  /**
   * Makes a custom request with the provided configuration
   * @param {object} [config={}] - Axios request configuration
   * @returns {Promise} Axios response promise
   */
  request(config = {}) {
    return this.axiosInstance(config);
  }
}
