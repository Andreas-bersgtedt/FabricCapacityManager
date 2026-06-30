// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Dashboard tab: a high-level, tenant-wide aggregated view of the loaded
// workspaces — KPI cards (workspaces, capacities, items, regions, estimated
// monthly compute cost, OneLake storage) plus distribution breakdowns by
// region, SKU, capacity state, storage mode and item type.

import { useMemo } from "react";
import type { EnrichedWorkspace, WorkspaceStorageUsage } from "../types";
import type { CapacityPricing } from "../pricing/useCapacityPricing";
import { normalizeCapacityState } from "../capacityState";

interface Props {
  workspaces: EnrichedWorkspace[];
  pricing?: CapacityPricing;
  /** Per-workspace OneLake storage usage (GB), keyed by lower-case id. */
  storage?: Map<string, WorkspaceStorageUsage>;
}

/** One distinct capacity, collapsed from its member workspaces. */
interface CapacitySummary {
  id: string;
  name: string;
  sku: string;
  region: string;
  state: string;
  /** Actual pre-tax cost billed over the trailing 28-day window, if known. */
  billedCost?: number;
  /** ISO currency code for `billedCost`. */
  billedCurrency?: string;
}

interface Breakdown {
  label: string;
  count: number;
}

/** Formats a GB amount compactly (e.g. 0.4 GB, 12 GB, 2.3 TB). */
function formatGb(gb: number): string {
  if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`;
  if (gb >= 100) return `${Math.round(gb)} GB`;
  if (gb >= 10) return `${gb.toFixed(0)} GB`;
  return `${gb.toFixed(1)} GB`;
}

/**
 * Formats a billed amount in its reported currency, falling back to a plain
 * number when the currency code is missing or not recognized.
 */
function formatMoney(amount: number, currency: string | undefined): string {
  if (currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      // Unknown currency code: fall through to a plain number.
    }
  }
  return amount.toFixed(2);
}

/** Sorts breakdown rows by descending count, then label. */
function byCountDesc(a: Breakdown, b: Breakdown): number {
  return b.count - a.count || a.label.localeCompare(b.label);
}

/** Increments the counter for `key` in `map`. */
function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Turns a string→count map into a descending-sorted breakdown list. */
function toBreakdown(map: Map<string, number>): Breakdown[] {
  return [...map]
    .map(([label, count]) => ({ label, count }))
    .sort(byCountDesc);
}

export function DashboardTab({ workspaces, pricing, storage }: Props) {
  const metrics = useMemo(() => {
    // Collapse workspaces into distinct capacities (keyed by id, falling back
    // to name for workspaces without an assigned capacity id).
    const capacities = new Map<string, CapacitySummary>();
    const byRegion = new Map<string, number>();
    const bySku = new Map<string, number>();
    const byStorageMode = new Map<string, number>();
    const byItemType = new Map<string, number>();
    let totalItems = 0;

    for (const ws of workspaces) {
      totalItems += ws.itemCount;
      bump(byRegion, ws.region || "(Unknown region)");
      bump(bySku, ws.sku || "(No SKU)");
      bump(byStorageMode, ws.storageMode);
      for (const type of ws.itemTypes) bump(byItemType, type);

      const key = ws.capacityId ?? `name:${ws.capacityName}`;
      if (!capacities.has(key)) {
        capacities.set(key, {
          id: key,
          name: ws.capacityName,
          sku: ws.sku,
          region: ws.region,
          state: ws.capacityState ?? "",
          billedCost: ws.capacityBilledCost,
          billedCurrency: ws.capacityBilledCurrency,
        });
      }
    }

    // Capacity state breakdown over distinct capacities. Only running
    // capacities accrue compute cost, so the monthly figure is the *current*
    // cost rate (paused/suspended capacities are excluded).
    let running = 0;
    let paused = 0;
    let monthlyCost = 0;
    let costResolved = false;
    for (const cap of capacities.values()) {
      const state = normalizeCapacityState(cap.state);
      if (state === "Running") running++;
      else if (state === "Paused") paused++;
      if (pricing && state === "Running") {
        const cost = pricing.monthlyCost(cap.sku, cap.region);
        if (cost != null) {
          monthlyCost += cost;
          costResolved = true;
        }
      }
    }

    // OneLake storage totals across all workspaces.
    let currentGb = 0;
    let billableGb = 0;
    let storageResolved = false;
    if (storage) {
      for (const ws of workspaces) {
        const usage = storage.get(ws.id.toLowerCase());
        if (usage?.currentGb != null) {
          currentGb += usage.currentGb;
          storageResolved = true;
        }
        if (usage?.billableGb != null) billableGb += usage.billableGb;
      }
    }

    // Actual billed compute cost (last 28 days) summed across distinct
    // capacities, grouped by currency in case a tenant spans billing regions.
    const billedByCurrency = new Map<string, number>();
    for (const cap of capacities.values()) {
      if (cap.billedCost == null) continue;
      const code = cap.billedCurrency ?? "";
      billedByCurrency.set(code, (billedByCurrency.get(code) ?? 0) + cap.billedCost);
    }
    const billedEntries = [...billedByCurrency].sort((a, b) => b[1] - a[1]);
    const billed =
      billedEntries.length > 0
        ? {
            text: billedEntries
              .map(([code, total]) => formatMoney(total, code || undefined))
              .join(" + "),
            mixed: billedEntries.length > 1,
          }
        : undefined;

    return {
      workspaceCount: workspaces.length,
      capacityCount: capacities.size,
      totalItems,
      regionCount: byRegion.size,
      skuCount: bySku.size,
      running,
      paused,
      monthlyCost: costResolved ? monthlyCost : undefined,
      billed,
      currentGb: storageResolved ? currentGb : undefined,
      billableGb: storageResolved ? billableGb : undefined,
      regions: toBreakdown(byRegion),
      skus: toBreakdown(bySku),
      storageModes: toBreakdown(byStorageMode),
      itemTypes: toBreakdown(byItemType).slice(0, 12),
    };
  }, [workspaces, pricing, storage]);

  return (
    <div className="dashboard">
      <div className="kpi-grid">
        <KpiCard icon="📁" label="Workspaces" value={metrics.workspaceCount} />
        <KpiCard
          icon="⚡"
          label="Capacities"
          value={metrics.capacityCount}
          hint={`${metrics.running} running · ${metrics.paused} paused`}
        />
        <KpiCard icon="🧱" label="Items" value={metrics.totalItems} />
        <KpiCard icon="🌍" label="Regions" value={metrics.regionCount} />
        <KpiCard icon="🏷️" label="SKUs" value={metrics.skuCount} />
        {metrics.monthlyCost != null && pricing && (
          <KpiCard
            icon="💰"
            label="Monthly cost rate"
            value={pricing.format(metrics.monthlyCost)}
            hint={`Running capacities only (${metrics.running} of ${metrics.capacityCount})`}
          />
        )}
        {metrics.billed && (
          <KpiCard
            icon="💵"
            label="Actual cost (28d)"
            value={metrics.billed.text}
            hint={
              metrics.billed.mixed
                ? "Pre-tax billed, multiple currencies"
                : "Pre-tax billed (Cost Management)"
            }
          />
        )}
        {metrics.currentGb != null && (
          <KpiCard
            icon="💾"
            label="OneLake storage"
            value={formatGb(metrics.currentGb)}
            hint={
              metrics.billableGb != null
                ? `${formatGb(metrics.billableGb)} billable`
                : undefined
            }
          />
        )}
      </div>

      <div className="dashboard-grid">
        <BarList
          title="Workspaces by region"
          rows={metrics.regions}
          total={metrics.workspaceCount}
        />
        <BarList
          title="Workspaces by SKU"
          rows={metrics.skus}
          total={metrics.workspaceCount}
        />
        <BarList
          title="Storage mode"
          rows={metrics.storageModes}
          total={metrics.workspaceCount}
        />
        <BarList
          title="Top item types"
          rows={metrics.itemTypes}
          total={metrics.workspaceCount}
          unit="workspaces"
        />
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: string;
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="kpi-card">
      <span className="kpi-icon" aria-hidden>
        {icon}
      </span>
      <div className="kpi-body">
        <span className="kpi-value">{value}</span>
        <span className="kpi-label">{label}</span>
        {hint && <span className="kpi-hint">{hint}</span>}
      </div>
    </div>
  );
}

function BarList({
  title,
  rows,
  total,
  unit,
}: {
  title: string;
  rows: Breakdown[];
  total: number;
  unit?: string;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  return (
    <section className="bar-list">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted">No data.</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.label}>
              <span className="bar-label" title={row.label}>
                {row.label}
              </span>
              <span className="bar-track">
                <span
                  className="bar-fill"
                  style={{ width: `${(row.count / max) * 100}%` }}
                />
              </span>
              <span className="bar-count">
                {row.count}
                {unit ? "" : ` (${Math.round((row.count / total) * 100)}%)`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
