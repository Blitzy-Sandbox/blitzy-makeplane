/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Payment and subscription tier contracts for the `@plane/types` package.
 *
 * Models the Plane Cloud billing surface — products, prices, billing frequency, and
 * subscription tier identifiers. Consumed by workspace settings → billing-and-plans
 * in `apps/web` and corresponding admin views.
 */

/**
 * Subscription tier enum identifying the Plane plan a workspace is on.
 *
 * Values:
 * - `FREE`: open-source/free tier with usage caps
 * - `ONE`: entry paid tier
 * - `PRO`: standard paid tier
 * - `BUSINESS`: organization-grade paid tier
 * - `ENTERPRISE`: contracted enterprise tier (custom terms)
 */
export enum EProductSubscriptionEnum {
  FREE = "FREE",
  ONE = "ONE",
  PRO = "PRO",
  BUSINESS = "BUSINESS",
  ENTERPRISE = "ENTERPRISE",
}

/**
 * Billing cycle for recurring subscription prices.
 *
 * Values:
 * - `month`: monthly billing
 * - `year`: annual billing (typically discounted)
 */
export type TBillingFrequency = "month" | "year";

/**
 * Single price tier for a Plane subscription product.
 *
 * Fields:
 * - `currency`: ISO-4217 currency code (e.g. "USD")
 * - `unit_amount`: per-seat amount in smallest currency unit (cents)
 * - `workspace_amount`: total workspace amount (some plans bundle workspace seats)
 * - `recurring`: billing frequency for this price
 */
export type IPaymentProductPrice = {
  currency: string;
  id: string;
  product: string;
  recurring: TBillingFrequency;
  unit_amount: number;
  workspace_amount: number;
};

/**
 * String-literal alias of subscription tier names (matches `EProductSubscriptionEnum` keys).
 *
 * Used where a string-typed tier identifier is required (e.g. URL params, API payloads).
 */
export type TProductSubscriptionType = "FREE" | "ONE" | "PRO" | "BUSINESS" | "ENTERPRISE";

/**
 * Plane subscription product with all available prices.
 *
 * Fields:
 * - `type`: tier identifier excluding `FREE` (the free tier has no Stripe product)
 * - `payment_quantity`: minimum or default seats included in the product
 * - `prices`: array of `IPaymentProductPrice` covering the available billing frequencies/currencies
 * - `is_active`: false when the product is offered for renewal but no longer sold to new buyers
 */
export type IPaymentProduct = {
  description: string;
  id: string;
  name: string;
  type: Omit<TProductSubscriptionType, "FREE">;
  payment_quantity: number;
  prices: IPaymentProductPrice[];
  is_active: boolean;
};

/**
 * UI-side price descriptor used by the billing-and-plans page.
 *
 * Fields:
 * - `key`: stable React key (often `${tier}-${frequency}`)
 * - `id`: optional underlying price id (undefined for synthetic/placeholder rows)
 * - `price`: amount in the currency's major unit
 */
export type TSubscriptionPrice = {
  key: string;
  id: string | undefined;
  currency: string;
  price: number;
  recurring: TBillingFrequency;
};

/**
 * Per-tier mapping of the currently selected billing frequency in the billing UI.
 *
 * Entries may be `undefined` when no selection has been made yet for that tier.
 */
export type TProductBillingFrequency = {
  [key in EProductSubscriptionEnum]: TBillingFrequency | undefined;
};
