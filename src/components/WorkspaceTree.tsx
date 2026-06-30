// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Renders the workspaces as a collapsible three-level tree grouped by
// Region › Capacity SKU › Capacity Name, with a per-capacity table of
// workspaces, their storage mode and the item types they contain.

import { useMemo, useState } from "react";
import type { Capacity, EnrichedWorkspace } from "../types";
import type { WorkspaceStorageUsage } from "../types";
import type { TokenProvider } from "../api/fabricApi";
import type { CapacityPricing } from "../pricing/useCapacityPricing";
import { normalizeCapacityState } from "../capacityState";
import {
  MoveWorkspaceSameGeoDialog,
  PauseResumeCapacityDialog,
  ScaleCapacityDialog,
  fabricSkuLadder,
  sameGeography,
  useAdminMode,
  type CapacityLifecycleAction,
} from "../admin";

interface Props {
  /** The (already filtered) workspaces to display. */
  workspaces: EnrichedWorkspace[];
  /** Token provider for admin operations (only used in admin mode). */
  getToken?: TokenProvider | null;
  /** All capacities, used to offer same-geography move destinations. */
  capacities?: Capacity[];
  /** Incrementally refresh one capacity after a successful admin operation. */
  onCapacityChanged?: (capacityId: string) => void;
  /** Region/currency-aware estimated monthly compute costs. */
  pricing?: CapacityPricing;
  /** Per-workspace OneLake storage usage (GB), keyed by workspace id. */
  storage?: Map<string, WorkspaceStorageUsage>;
}

/** A node in the grouped tree. Leaf capacity nodes carry `workspaces`. */
interface GroupNode {
  key: string;
  label: string;
  count: number;
  children?: GroupNode[];
  workspaces?: EnrichedWorkspace[];
}

/** Groups workspaces by Region -> Capacity SKU -> Capacity Name. */
function buildGroups(workspaces: EnrichedWorkspace[]): GroupNode[] {
  const byRegion = new Map<string, EnrichedWorkspace[]>();
  for (const ws of workspaces) {
    const arr = byRegion.get(ws.region) ?? [];
    arr.push(ws);
    byRegion.set(ws.region, arr);
  }

  const regionNodes: GroupNode[] = [];
  for (const [region, regionWs] of [...byRegion].sort(sortByKey)) {
    const bySku = new Map<string, EnrichedWorkspace[]>();
    for (const ws of regionWs) {
      const arr = bySku.get(ws.sku) ?? [];
      arr.push(ws);
      bySku.set(ws.sku, arr);
    }

    const skuNodes: GroupNode[] = [];
    for (const [sku, skuWs] of [...bySku].sort(sortByKey)) {
      const byCapacity = new Map<string, EnrichedWorkspace[]>();
      for (const ws of skuWs) {
        const arr = byCapacity.get(ws.capacityName) ?? [];
        arr.push(ws);
        byCapacity.set(ws.capacityName, arr);
      }

      const capacityNodes: GroupNode[] = [...byCapacity]
        .sort(sortByKey)
        .map(([capacityName, capWs]) => ({
          key: `${region}|${sku}|${capacityName}`,
          label: capacityName,
          count: capWs.length,
          workspaces: capWs.sort((a, b) =>
            a.displayName.localeCompare(b.displayName),
          ),
        }));

      skuNodes.push({
        key: `${region}|${sku}`,
        label: sku,
        count: skuWs.length,
        children: capacityNodes,
      });
    }

    regionNodes.push({
      key: region,
      label: region,
      count: regionWs.length,
      children: skuNodes,
    });
  }
  return regionNodes;
}

function sortByKey(
  a: [string, unknown],
  b: [string, unknown],
): number {
  return a[0].localeCompare(b[0]);
}

function StorageBadge({ mode }: { mode: EnrichedWorkspace["storageMode"] }) {
  return <span className={`badge storage-${mode.toLowerCase()}`}>{mode}</span>;
}

/** Three storage cells (current / billable / cache) for a workspace row. */
function StorageCells({
  usage,
  metrics,
}: {
  usage?: WorkspaceStorageUsage;
  metrics: { current: boolean; billable: boolean; cache: boolean };
}) {
  const cell = (gb?: number) =>
    gb != null ? (
      <span className="storage-value">{formatGb(gb)}</span>
    ) : (
      <span className="muted">—</span>
    );
  return (
    <>
      {metrics.current && <td className="num">{cell(usage?.currentGb)}</td>}
      {metrics.billable && <td className="num">{cell(usage?.billableGb)}</td>}
      {metrics.cache && <td className="num">{cell(usage?.cacheGb)}</td>}
    </>
  );
}

/**
 * Sums the estimated monthly cost of every distinct capacity in a region.
 * Only running capacities accrue compute cost, so paused/suspended capacities
 * are excluded — the total reflects the current monthly cost rate.
 */
function regionMonthlyCost(
  region: GroupNode,
  pricing: CapacityPricing,
): number | undefined {
  let total = 0;
  let resolved = false;
  for (const sku of region.children ?? []) {
    for (const capacity of sku.children ?? []) {
      const ws = capacity.workspaces?.[0];
      if (!ws) continue;
      if (normalizeCapacityState(ws.capacityState) !== "Running") continue;
      const cost = pricing.monthlyCost(ws.sku, ws.region);
      if (cost != null) {
        total += cost;
        resolved = true;
      }
    }
  }
  return resolved ? total : undefined;
}

/** Formats a GB amount compactly (e.g. 0.4 GB, 12 GB, 2.3 TB). */
function formatGb(gb: number): string {
  if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`;
  if (gb >= 100) return `${Math.round(gb)} GB`;
  if (gb >= 10) return `${gb.toFixed(0)} GB`;
  return `${gb.toFixed(1)} GB`;
}

/** Formats an uptime percentage (0-100) with one decimal below 100%. */
function formatUptime(percent: number): string {
  const clamped = Math.min(Math.max(percent, 0), 100);
  return clamped >= 99.95 ? "100%" : `${clamped.toFixed(1)}%`;
}

/**
 * Formats a billed amount in its reported currency. Falls back to a plain
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

/** Sums current OneLake storage (GB) across the given workspaces. */
function sumCurrentGb(
  workspaces: EnrichedWorkspace[] | undefined,
  storage: Map<string, WorkspaceStorageUsage>,
): number | undefined {
  let total = 0;
  let resolved = false;
  for (const ws of workspaces ?? []) {
    const usage = storage.get(ws.id.toLowerCase());
    if (usage?.currentGb != null) {
      total += usage.currentGb;
      resolved = true;
    }
  }
  return resolved ? total : undefined;
}

/** Sums current OneLake storage (GB) across every workspace in a region. */
function regionCurrentGb(
  region: GroupNode,
  storage: Map<string, WorkspaceStorageUsage>,
): number | undefined {
  const workspaces: EnrichedWorkspace[] = [];
  for (const sku of region.children ?? []) {
    for (const capacity of sku.children ?? []) {
      for (const ws of capacity.workspaces ?? []) workspaces.push(ws);
    }
  }
  return sumCurrentGb(workspaces, storage);
}

export function WorkspaceTree({
  workspaces,
  getToken,
  capacities = [],
  onCapacityChanged,
  pricing,
  storage,
}: Props) {
  const groups = useMemo(() => buildGroups(workspaces), [workspaces]);
  const { isAdminMode } = useAdminMode();
  // Which storage metrics are actually populated, so we only render columns
  // that carry data (e.g. OneLake cache is absent in some Metrics app builds).
  const storageMetrics = useMemo(() => {
    const present = { current: false, billable: false, cache: false };
    if (storage) {
      for (const usage of storage.values()) {
        if (usage.currentGb != null) present.current = true;
        if (usage.billableGb != null) present.billable = true;
        if (usage.cacheGb != null) present.cache = true;
      }
    }
    return present;
  }, [storage]);
  const showStorage =
    Boolean(storage) &&
    (storageMetrics.current || storageMetrics.billable || storageMetrics.cache);
  const [scaleTarget, setScaleTarget] = useState<{
    capacityId: string;
    capacityName: string;
    currentSku: string;
  } | null>(null);
  const [lifecycleTarget, setLifecycleTarget] = useState<{
    capacityId: string;
    capacityName: string;
    action: CapacityLifecycleAction;
    currentState?: string;
  } | null>(null);
  const [moveTarget, setMoveTarget] = useState<{
    workspaceId: string;
    workspaceName: string;
    sourceCapacityId: string;
    region: string;
  } | null>(null);

  if (workspaces.length === 0) {
    return <p className="muted">No workspaces match the current filters.</p>;
  }

  return (
    <>
    <div className="tree">
      {groups.map((region) => {
        const regionCost = pricing ? regionMonthlyCost(region, pricing) : undefined;
        const regionGb = storage ? regionCurrentGb(region, storage) : undefined;
        return (
        <details key={region.key} className="region" open>
          <summary>
            <span className="group-icon">🌍</span>
            <span className="group-title">{region.label}</span>
            <span className="count">{region.count}</span>
            {pricing && regionCost != null && (
              <span className="capacity-cost" title="Estimated monthly compute cost (pay-as-you-go)">
                ≈ {pricing.format(regionCost)}/mo
              </span>
            )}
            {storage && regionGb != null && (
              <span
                className="storage-pill"
                title="Current OneLake storage (Capacity Metrics app)"
              >
                💾 {formatGb(regionGb)}
              </span>
            )}
          </summary>
          {region.children?.map((sku) => (
            <details key={sku.key} className="sku" open>
              <summary>
                <span className="group-icon">🏷️</span>
                <span className="group-title">SKU: {sku.label}</span>
                <span className="count">{sku.count}</span>
              </summary>
              {sku.children?.map((capacity) => {
                const firstWs = capacity.workspaces?.[0];
                const capacityId = firstWs?.capacityId;
                const currentSku = firstWs?.sku;
                const currentState = firstWs?.capacityState;
                const capacityTags = firstWs?.capacityTags;
                const runState = normalizeCapacityState(currentState);
                // Fabric's /v1/capacities reports state as Active / Inactive;
                // ARM uses Paused / Suspended. Treat any of these as stopped.
                const isPaused = runState === "Paused";
                const isRunning = runState === "Running";
                const canManageCapacity =
                  isAdminMode &&
                  Boolean(getToken) &&
                  Boolean(capacityId) &&
                  Boolean(currentSku) &&
                  currentSku !== "(No SKU)";
                // Only a running capacity accrues compute cost.
                const monthlyCost =
                  pricing && currentSku && firstWs && isRunning
                    ? pricing.monthlyCost(currentSku, firstWs.region)
                    : undefined;
                const capacityGb = storage
                  ? sumCurrentGb(capacity.workspaces, storage)
                  : undefined;
                return (
                <details key={capacity.key} className="capacity" open>
                  <summary>
                    <span className="group-icon">⚡</span>
                    <span className="group-title">{capacity.label}</span>
                    <span className="count">{capacity.count}</span>
                    {currentState && (
                      <span
                        className={`badge state-${runState.toLowerCase()}`}
                        title={`Capacity state: ${currentState}`}
                      >
                        {isRunning ? "Running" : isPaused ? "Paused" : currentState}
                      </span>
                    )}
                    {pricing && monthlyCost != null && (
                      <span
                        className="capacity-cost"
                        title="Estimated monthly compute cost (pay-as-you-go, ~730h)"
                      >
                        ≈ {pricing.format(monthlyCost)}/mo
                      </span>
                    )}
                    {pricing && isPaused && (
                      <span
                        className="capacity-cost muted"
                        title="Paused capacities do not accrue compute cost"
                      >
                        no compute cost
                      </span>
                    )}
                    {firstWs?.capacityUptimePercent != null && (
                      <span
                        className="uptime-pill"
                        title="Percentage of the last 28 days the capacity was running (Azure Activity Log suspend/resume history)"
                      >
                        ⏱ {formatUptime(firstWs.capacityUptimePercent)} uptime (28d)
                      </span>
                    )}
                    {firstWs?.capacityBilledCost != null && (
                      <span
                        className="billing-pill"
                        title="Actual pre-tax compute cost billed over the last 28 days (Azure Cost Management)"
                      >
                        💵 {formatMoney(firstWs.capacityBilledCost, firstWs.capacityBilledCurrency)} actual (28d)
                      </span>
                    )}
                    {storage && capacityGb != null && (
                      <span
                        className="storage-pill"
                        title="Current OneLake storage (Capacity Metrics app)"
                      >
                        💾 {formatGb(capacityGb)}
                      </span>
                    )}
                    {capacityTags &&
                      Object.entries(capacityTags).map(([k, v]) => (
                        <span key={k} className="badge capacity-tag">
                          {k}: {v}
                        </span>
                      ))}
                    {canManageCapacity && capacityId && currentSku && (
                      <span className="admin-capacity-actions">
                        <button
                          className="link"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setScaleTarget({
                              capacityId,
                              capacityName: capacity.label,
                              currentSku,
                            });
                          }}
                        >
                          Scale
                        </button>
                        {isRunning && (
                          <button
                            className="link"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setLifecycleTarget({
                                capacityId,
                                capacityName: capacity.label,
                                action: "pause",
                                currentState,
                              });
                            }}
                          >
                            Pause
                          </button>
                        )}
                        {isPaused && (
                          <button
                            className="link"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setLifecycleTarget({
                                capacityId,
                                capacityName: capacity.label,
                                action: "resume",
                                currentState,
                              });
                            }}
                          >
                            Resume
                          </button>
                        )}
                      </span>
                    )}
                  </summary>
                  <table className="ws-table">
                    <thead>
                      <tr>
                        <th>Workspace</th>
                        <th>My role</th>
                        <th>Domain</th>
                        <th>Storage</th>
                        <th>Default format</th>
                        <th>Assignment</th>
                        <th>Items</th>
                        {showStorage && storageMetrics.current && (
                          <th title="Current OneLake storage">Current</th>
                        )}
                        {showStorage && storageMetrics.billable && (
                          <th title="Billable OneLake storage">Billable</th>
                        )}
                        {showStorage && storageMetrics.cache && (
                          <th title="OneLake cache storage">Cache</th>
                        )}
                        <th>Item types</th>
                      </tr>
                    </thead>
                    <tbody>
                      {capacity.workspaces?.map((ws) => (
                        <tr key={ws.id}>
                          <td>
                            <a
                              href={`https://app.fabric.microsoft.com/groups/${ws.id}/list`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {ws.displayName}
                            </a>
                            {isAdminMode &&
                              getToken &&
                              ws.capacityId &&
                              ws.userRole === "Admin" && (
                                <button
                                  className="link admin-row-action"
                                  onClick={() =>
                                    setMoveTarget({
                                      workspaceId: ws.id,
                                      workspaceName: ws.displayName,
                                      sourceCapacityId: ws.capacityId!,
                                      region: ws.region,
                                    })
                                  }
                                >
                                  Change to another capacity
                                </button>
                              )}
                          </td>
                          <td>
                            {ws.userRole ? (
                              <span className="chip">{ws.userRole}</span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td>
                            {ws.domainName ?? ws.domainId ? (
                              <span
                                className="chip"
                                title={ws.domainId ?? undefined}
                              >
                                {ws.domainName ?? "Assigned"}
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td>
                            <StorageBadge mode={ws.storageMode} />
                          </td>
                          <td>{ws.defaultStorageFormat ?? <span className="muted">—</span>}</td>
                          <td>
                            {ws.capacityAssignmentProgress ? (
                              <span
                                className={`badge assignment-${ws.capacityAssignmentProgress.toLowerCase()}`}
                                title={
                                  ws.capacityRegion
                                    ? `Capacity region: ${ws.capacityRegion}`
                                    : undefined
                                }
                              >
                                {ws.capacityAssignmentProgress}
                              </span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td>{ws.itemCount}</td>
                          {showStorage && (
                            <StorageCells
                              usage={storage?.get(ws.id.toLowerCase())}
                              metrics={storageMetrics}
                            />
                          )}
                          <td className="item-types">
                            {ws.itemTypes.length === 0 ? (
                              <span className="muted">—</span>
                            ) : (
                              ws.itemTypes.map((t) => (
                                <span key={t} className="chip">
                                  {t}
                                </span>
                              ))
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
                );
              })}
            </details>
          ))}
        </details>
        );
      })}
    </div>
    {scaleTarget && getToken && (
      <ScaleCapacityDialog
        getToken={getToken}
        capacityId={scaleTarget.capacityId}
        capacityName={scaleTarget.capacityName}
        currentSku={scaleTarget.currentSku}
        skuOptions={[...fabricSkuLadder]}
        onCompleted={() => onCapacityChanged?.(scaleTarget.capacityId)}
        onClose={() => setScaleTarget(null)}
      />
    )}
    {lifecycleTarget && getToken && (
      <PauseResumeCapacityDialog
        getToken={getToken}
        capacityId={lifecycleTarget.capacityId}
        capacityName={lifecycleTarget.capacityName}
        action={lifecycleTarget.action}
        currentState={lifecycleTarget.currentState}
        onCompleted={() => onCapacityChanged?.(lifecycleTarget.capacityId)}
        onClose={() => setLifecycleTarget(null)}
      />
    )}
    {moveTarget && getToken && (
      <MoveWorkspaceSameGeoDialog
        getToken={getToken}
        workspaceId={moveTarget.workspaceId}
        workspaceName={moveTarget.workspaceName}
        sourceCapacityId={moveTarget.sourceCapacityId}
        destinationOptions={capacities
          .filter(
            (c) =>
              c.id !== moveTarget.sourceCapacityId &&
              sameGeography(c.region, moveTarget.region),
          )
          .map((c) => ({ id: c.id, name: c.displayName }))}
        onClose={() => setMoveTarget(null)}
      />
    )}
    </>
  );
}
