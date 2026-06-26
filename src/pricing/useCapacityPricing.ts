// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Hook that resolves the per-capacity-unit hourly price for every distinct
// region present in the loaded workspaces, then exposes helpers to compute the
// estimated monthly compute cost of a capacity from its SKU and region.

import { useEffect, useMemo, useState } from "react";
import type { EnrichedWorkspace } from "../types";
import {
  HOURS_PER_MONTH,
  fetchFabricCuHourlyPrice,
  skuCapacityUnits,
  toArmRegionName,
  type CurrencyCode,
} from "./azureRetailPrices";

export interface CapacityPricing {
  /** True while at least one region price is still being fetched. */
  loading: boolean;
  /** The currency the resolved prices are expressed in. */
  currency: CurrencyCode;
  /**
   * Estimated monthly (pay-as-you-go) compute cost for a capacity, or undefined
   * when the region price or SKU capacity-unit count is unavailable.
   */
  monthlyCost: (sku: string, region: string) => number | undefined;
  /** Formats a numeric amount using the active currency. */
  format: (amount: number) => string;
}

/**
 * Fetches per-CU hourly prices for the distinct workspace regions in the
 * selected currency and returns helpers to derive monthly capacity costs.
 */
export function useCapacityPricing(
  workspaces: EnrichedWorkspace[] | undefined,
  currency: CurrencyCode,
): CapacityPricing {
  // Distinct armRegionName values across all workspaces.
  const regions = useMemo(() => {
    const set = new Set<string>();
    for (const ws of workspaces ?? []) {
      const arm = toArmRegionName(ws.region);
      if (arm) set.add(arm);
    }
    return [...set];
  }, [workspaces]);

  const [prices, setPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const regionsKey = regions.join(",");
  useEffect(() => {
    let cancelled = false;
    if (regions.length === 0) {
      setPrices({});
      return;
    }
    setLoading(true);
    Promise.all(
      regions.map(async (region) => {
        const price = await fetchFabricCuHourlyPrice(region, currency);
        return [region, price] as const;
      }),
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, number> = {};
      for (const [region, price] of results) {
        if (price != null) next[region] = price;
      }
      setPrices(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // regionsKey captures the region list; currency triggers a refetch.
  }, [regionsKey, currency]);

  const formatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }),
    [currency],
  );

  return useMemo<CapacityPricing>(
    () => ({
      loading,
      currency,
      monthlyCost: (sku, region) => {
        const units = skuCapacityUnits(sku);
        const hourly = prices[toArmRegionName(region)];
        if (units == null || hourly == null) return undefined;
        return units * hourly * HOURS_PER_MONTH;
      },
      format: (amount) => formatter.format(amount),
    }),
    [loading, currency, prices, formatter],
  );
}
