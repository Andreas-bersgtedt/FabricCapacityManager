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

/** A workspace enriched with capacity, item-type and storage-mode data. */
export interface EnrichedWorkspace {
  id: string;
  displayName: string;
  type: string;
  capacityId?: string;
  capacityName: string;
  sku: string;
  region: string;
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

export interface Filters {
  storageModes: Set<StorageMode>;
  /** Item types that must be present in a workspace for it to match. */
  requiredItemTypes: Set<string>;
  searchText: string;
}
