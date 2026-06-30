// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Computes actual billed compute cost per capacity over a trailing window from
// Azure Cost Management. The synchronous Query API
// (`Microsoft.CostManagement/query`) returns aggregated cost grouped by
// ResourceId, which we map back to each Fabric capacity. This complements the
// retail-price estimate with what was actually invoiced.
//
// Requires an Azure Resource Manager token and the caller to have a Cost
// Management reader role on the subscription, so this is best-effort and only
// run when ARM access is expected (live writes enabled). It degrades to an
// empty map when Cost Management is unavailable, access is denied (401/403), or
// the API is throttled (429).

import type { Capacity } from "../types";
import type { TokenProvider } from "./fabricApi";
import { azureArmScopes } from "../authConfig";

const ARM_BASE = "https://management.azure.com";
const SUBSCRIPTIONS_API_VERSION = "2020-01-01";
const COST_MANAGEMENT_API_VERSION = "2025-03-01";

/** The trailing window over which billed cost is measured. */
export const BILLING_WINDOW_DAYS = 28;

/** Actual billed cost for a single capacity over the trailing window. */
export interface CapacityBilling {
  capacityId: string;
  /** Pre-tax cost billed during the window, in `currency`. */
  cost: number;
  /** ISO currency code reported by Cost Management (for example "USD"). */
  currency: string;
}

interface PagedArm<T> {
  value?: T[];
  nextLink?: string;
}

interface QueryColumn {
  name: string;
  type: string;
}

interface QueryResult {
  properties?: {
    columns?: QueryColumn[];
    rows?: unknown[][];
    nextLink?: string | null;
  };
}

async function armGet<T>(url: string, token: string): Promise<T | null> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function armPost<T>(
  url: string,
  token: string,
  body: unknown,
): Promise<T | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  // 204 = no usage in the window; 401/403 = no Cost Management access;
  // 429 = throttled. All are non-fatal: skip this subscription.
  if (!res.ok || res.status === 204) return null;
  return (await res.json()) as T;
}

/** Lists the caller's subscription ids. */
async function listSubscriptionIds(token: string): Promise<string[]> {
  const body = await armGet<PagedArm<{ subscriptionId: string }>>(
    `${ARM_BASE}/subscriptions?api-version=${SUBSCRIPTIONS_API_VERSION}`,
    token,
  );
  return (body?.value ?? []).map((s) => s.subscriptionId);
}

/** Extracts the last path segment (the resource name) from an ARM id. */
function resourceNameOf(armId: string): string | null {
  const trimmed = armId.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : null;
}

/** Builds the Cost Management query body for one subscription window. */
function buildQueryBody(startIso: string, endIso: string): unknown {
  return {
    type: "ActualCost",
    timeframe: "Custom",
    timePeriod: { from: startIso, to: endIso },
    dataset: {
      granularity: "None",
      aggregation: { totalCost: { name: "PreTaxCost", function: "Sum" } },
      grouping: [{ type: "Dimension", name: "ResourceId" }],
      filter: {
        dimensions: {
          name: "ResourceType",
          operator: "In",
          values: ["microsoft.fabric/capacities"],
        },
      },
    },
  };
}

/** Locates the cost/resourceId/currency column indexes in a query result. */
function columnIndexes(columns: QueryColumn[]): {
  cost: number;
  resourceId: number;
  currency: number;
} {
  let cost = -1;
  let resourceId = -1;
  let currency = -1;
  columns.forEach((col, i) => {
    if (col.name === "ResourceId") resourceId = i;
    else if (col.name === "Currency") currency = i;
    else if (cost < 0 && col.type === "Number") cost = i;
  });
  return { cost, resourceId, currency };
}

/**
 * Queries actual billed cost for Fabric capacities in one subscription and
 * accumulates it into `byResource` keyed by lower-cased capacity name.
 */
async function accumulateSubscription(
  token: string,
  subscriptionId: string,
  startIso: string,
  endIso: string,
  byResource: Map<string, { cost: number; currency: string }>,
): Promise<void> {
  const body = buildQueryBody(startIso, endIso);
  let url = `${ARM_BASE}/subscriptions/${subscriptionId}/providers/Microsoft.CostManagement/query?api-version=${COST_MANAGEMENT_API_VERSION}`;

  // Follow paging defensively; capacity counts are small so this rarely loops.
  for (let guard = 0; url && guard < 10; guard++) {
    const data = await armPost<QueryResult>(url, token, body);
    const props = data?.properties;
    if (!props?.columns || !props.rows) return;

    const { cost, resourceId, currency } = columnIndexes(props.columns);
    if (cost < 0 || resourceId < 0) return;

    for (const row of props.rows) {
      const armId = String(row[resourceId] ?? "");
      const name = resourceNameOf(armId);
      if (!name) continue;
      const amount = Number(row[cost]);
      if (!Number.isFinite(amount)) continue;
      const code = currency >= 0 ? String(row[currency] ?? "") : "";

      const key = name.toLowerCase();
      const existing = byResource.get(key);
      if (existing) {
        existing.cost += amount;
        if (!existing.currency && code) existing.currency = code;
      } else {
        byResource.set(key, { cost: amount, currency: code });
      }
    }

    url = props.nextLink ?? "";
  }
}

/**
 * Returns a map of Fabric capacity id -> billed cost over the trailing window.
 * Best-effort: resolves to an empty map when ARM or Cost Management access is
 * unavailable.
 */
export async function getCapacityBilling(
  getToken: TokenProvider,
  capacities: Capacity[],
): Promise<Map<string, CapacityBilling>> {
  const result = new Map<string, CapacityBilling>();
  if (capacities.length === 0) return result;

  try {
    const token = await getToken(azureArmScopes);
    const subscriptionIds = await listSubscriptionIds(token);
    if (subscriptionIds.length === 0) return result;

    const now = Date.now();
    const endIso = new Date(now).toISOString();
    const startIso = new Date(
      now - BILLING_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    // Cost Management is throttled aggressively, so query subscriptions
    // sequentially rather than fanning out.
    const byResource = new Map<string, { cost: number; currency: string }>();
    for (const sub of subscriptionIds) {
      await accumulateSubscription(token, sub, startIso, endIso, byResource);
    }

    for (const cap of capacities) {
      const billed = byResource.get(cap.displayName.toLowerCase());
      if (!billed) continue;
      result.set(cap.id, {
        capacityId: cap.id,
        cost: billed.cost,
        currency: billed.currency,
      });
    }
  } catch {
    // Best-effort: no ARM/Cost Management access -> no billing data.
    return result;
  }

  return result;
}
