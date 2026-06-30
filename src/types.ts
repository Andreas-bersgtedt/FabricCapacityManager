// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Shared domain types used across the API client, hooks and UI components.

/** Raw capacity as returned by the Fabric REST API (GET /v1/capacities). */
export interface Capacity {
  id: string;
  displayName: string;
  sku: string;
  region: string;
  state: string;
}

/** Raw workspace as returned by the Fabric REST API (GET /v1/workspaces). */
export interface Workspace {
  id: string;
  displayName: string;
  type: string;
  capacityId?: string;
  description?: string;
  /** Id of the governance domain the workspace is assigned to, if any. */
  domainId?: string;
}

/** Raw item as returned by GET /v1/workspaces/{id}/items. */
export interface FabricItem {
  id: string;
  displayName: string;
  type: string;
  workspaceId: string;
}

/** Storage mode derived from Power BI semantic-model targetStorageMode. */
export type StorageMode = "Large" | "Small" | "None";

/** Fabric workspace role for a principal (GET /v1/workspaces/{id}/roleAssignments). */
export type WorkspaceRole = "Admin" | "Member" | "Contributor" | "Viewer";

/** A workspace enriched with capacity, item-type and storage-mode data. */
export interface EnrichedWorkspace {
  id: string;
  displayName: string;
  type: string;
  capacityId?: string;
  capacityName: string;
  sku: string;
  region: string;
  /** Lifecycle state of the owning capacity (e.g. Active, Paused). */
  capacityState?: string;
  /** The signed-in user's role on this workspace, if resolvable. */
  userRole?: WorkspaceRole;
  /** Region of the assigned capacity (GET /v1/workspaces/{id}). */
  capacityRegion?: string;
  /** Capacity (re)assignment progress: Completed / InProgress / Failed. */
  capacityAssignmentProgress?: string;
  /** Workspace default semantic-model storage format (admin API). */
  defaultStorageFormat?: string;
  /** Governance domain the workspace is assigned to, if any. */
  domainId?: string;
  /** Resolved display name of the assigned domain, if available. */
  domainName?: string;
  /** Azure resource tags on the owning capacity (key/value). */
  capacityTags?: Record<string, string>;
  /**
   * Percentage of the trailing 28-day window the owning capacity was Running,
   * reconstructed from Azure Activity Log suspend/resume events. Undefined when
   * ARM access is unavailable or the capacity could not be resolved.
   */
  capacityUptimePercent?: number;
  /**
   * Actual pre-tax compute cost billed for the owning capacity over the
   * trailing 28-day window, from Azure Cost Management. Undefined when ARM or
   * Cost Management access is unavailable.
   */
  capacityBilledCost?: number;
  /** ISO currency code for `capacityBilledCost` (for example "USD"). */
  capacityBilledCurrency?: string;
  /** Distinct item types present in the workspace (e.g. Lakehouse, Warehouse). */
  itemTypes: string[];
  itemCount: number;
  storageMode: StorageMode;
}

export interface FabricData {
  capacities: Capacity[];
  workspaces: EnrichedWorkspace[];
  /** All distinct item types found across every workspace. */
  allItemTypes: string[];
}

/**
 * Per-workspace OneLake storage usage (in GB) sourced from the Fabric Capacity
 * Metrics app semantic model. Any field may be undefined when the underlying
 * model does not expose that measure.
 */
export interface WorkspaceStorageUsage {
  workspaceId: string;
  /** Current OneLake storage in GB. */
  currentGb?: number;
  /** Billable OneLake storage in GB (includes soft-deleted data). */
  billableGb?: number;
  /** OneLake cache storage in GB. */
  cacheGb?: number;
}

export interface Filters {
  storageModes: Set<StorageMode>;
  /** Item types that must be present in a workspace for it to match. */
  requiredItemTypes: Set<string>;
  searchText: string;
}
