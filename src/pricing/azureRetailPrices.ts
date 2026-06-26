// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Client for the public Azure Retail Prices API. Used to estimate the monthly
// compute cost of a Fabric capacity from its SKU (capacity-unit count) and the
// pay-as-you-go price per capacity-unit hour in the capacity's region.
//
// The API is anonymous (no auth) and supports a `currencyCode` query parameter.
// Docs: https://learn.microsoft.com/rest/api/cost-management/retail-prices/azure-retail-prices

/** Approximate number of billed hours in a month (Azure convention: 730). */
export const HOURS_PER_MONTH = 730;

/** Currencies supported by the Azure Retail Prices API `currencyCode` param. */
export const SUPPORTED_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "AUD",
  "BRL",
  "CAD",
  "CHF",
  "CNY",
  "DKK",
  "INR",
  "JPY",
  "KRW",
  "NOK",
  "NZD",
  "RUB",
  "SEK",
  "TWD",
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

// The Azure Retail Prices API does not return CORS headers, so it cannot be
// called directly from the browser. Requests go through the Vite dev/preview
// proxy (`/api/retail-prices` -> https://prices.azure.com/api/retail/prices).
// Override with VITE_RETAIL_PRICES_ENDPOINT when hosting behind another proxy.
const ENDPOINT =
  import.meta.env.VITE_RETAIL_PRICES_ENDPOINT || "/api/retail-prices";

interface RetailPriceItem {
  retailPrice: number;
  unitOfMeasure: string;
  armRegionName: string;
  armSkuName: string;
  type: string;
}

interface RetailPriceResponse {
  Items: RetailPriceItem[];
}

/**
 * Normalizes a Fabric/Azure region label to its `armRegionName` form, e.g.
 * "West Europe" -> "westeurope", "East US 2" -> "eastus2".
 */
export function toArmRegionName(region: string): string {
  return region.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Returns the number of capacity units (CU) represented by a Fabric F-SKU,
 * e.g. "F2" -> 2, "F64" -> 64. Returns undefined for non-F SKUs.
 */
export function skuCapacityUnits(sku: string): number | undefined {
  const match = /^F(\d+)$/i.exec(sku.trim());
  return match ? Number(match[1]) : undefined;
}

// In-memory cache keyed by `${currency}|${region}` to avoid refetching the
// per-CU price for every capacity that shares a region/currency.
const priceCache = new Map<string, Promise<number | null>>();

/**
 * Fetches the pay-as-you-go price for one Fabric capacity-unit hour in the
 * given region and currency. Returns null when the price cannot be resolved
 * (unknown region, network error, or no matching meter).
 */
export function fetchFabricCuHourlyPrice(
  region: string,
  currency: CurrencyCode,
): Promise<number | null> {
  const armRegion = toArmRegionName(region);
  const cacheKey = `${currency}|${armRegion}`;
  const cached = priceCache.get(cacheKey);
  if (cached) return cached;

  const promise = requestCuHourlyPrice(armRegion, currency).catch(() => null);
  priceCache.set(cacheKey, promise);
  // Drop failed lookups from the cache so they can be retried later.
  promise.then((value) => {
    if (value === null) priceCache.delete(cacheKey);
  });
  return promise;
}

async function requestCuHourlyPrice(
  armRegion: string,
  currency: CurrencyCode,
): Promise<number | null> {
  if (!armRegion) return null;

  // The base Fabric capacity meter is billed per CU/hour and shares the
  // `Fabric_Capacity_CU_Hour` armSkuName across the consumption workloads.
  const filter =
    `serviceName eq 'Microsoft Fabric'` +
    ` and armRegionName eq '${armRegion}'` +
    ` and armSkuName eq 'Fabric_Capacity_CU_Hour'` +
    ` and type eq 'Consumption'`;

  const url =
    `${ENDPOINT}?currencyCode='${currency}'&$filter=${encodeURIComponent(filter)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Retail Prices API returned ${res.status}`);
  }
  const body = (await res.json()) as RetailPriceResponse;
  const hourly = body.Items.find((i) => /hour/i.test(i.unitOfMeasure));
  return hourly ? hourly.retailPrice : null;
}
