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

/** Treats Fabric "Active/Running" and ARM "Paused/Suspended/Inactive" alike. */
function normalizeState(state: string): "Running" | "Paused" | "Other" {
  const s = state.toLowerCase();
  if (s === "active" || s === "running") return "Running";
  if (s === "paused" || s === "suspended" || s === "inactive") return "Paused";
  return "Other";
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
        });
      }
    }

    // Capacity state breakdown over distinct capacities.
    let running = 0;
    let paused = 0;
    let monthlyCost = 0;
    let costResolved = false;
    for (const cap of capacities.values()) {
      const state = normalizeState(cap.state);
      if (state === "Running") running++;
      else if (state === "Paused") paused++;
      if (pricing) {
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

    return {
      workspaceCount: workspaces.length,
      capacityCount: capacities.size,
      totalItems,
      regionCount: byRegion.size,
      skuCount: bySku.size,
      running,
      paused,
      monthlyCost: costResolved ? monthlyCost : undefined,
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
            label="Est. compute / mo"
            value={pricing.format(metrics.monthlyCost)}
            hint="Pay-as-you-go, all capacities"
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
