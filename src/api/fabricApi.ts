// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Thin REST client for the Microsoft Fabric and Power BI APIs. Provides helpers
// to list capacities, workspaces and items, derive a workspace storage mode
// from its semantic models, and run requests with bounded concurrency.

import type {
  Capacity,
  FabricItem,
  StorageMode,
  Workspace,
  WorkspaceRole,
} from "../types";

const FABRIC_BASE = "https://api.fabric.microsoft.com/v1";
const POWERBI_BASE = "https://api.powerbi.com/v1.0/myorg";

/** A function that returns a bearer token for the given scopes. */
export type TokenProvider = (scopes: string[]) => Promise<string>;

interface PagedResponse<T> {
  value: T[];
  continuationToken?: string;
  continuationUri?: string;
  "@odata.nextLink"?: string;
}

async function httpGet<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${url} failed: ${res.status} ${res.statusText} ${body}`);
  }
  return (await res.json()) as T;
}

/** Follows Fabric continuationToken paging. */
async function fabricGetAll<T>(
  path: string,
  token: string,
): Promise<T[]> {
  const results: T[] = [];
  let url: string | undefined = `${FABRIC_BASE}${path}`;
  while (url) {
    const page: PagedResponse<T> = await httpGet<PagedResponse<T>>(url, token);
    results.push(...(page.value ?? []));
    if (page.continuationUri) {
      url = page.continuationUri;
    } else if (page.continuationToken) {
      const sep = path.includes("?") ? "&" : "?";
      url = `${FABRIC_BASE}${path}${sep}continuationToken=${encodeURIComponent(
        page.continuationToken,
      )}`;
    } else {
      url = undefined;
    }
  }
  return results;
}

export async function listCapacities(getToken: TokenProvider): Promise<Capacity[]> {
  const token = await getToken([
    "https://api.fabric.microsoft.com/Capacity.Read.All",
  ]);
  return fabricGetAll<Capacity>("/capacities", token);
}

export async function listWorkspaces(getToken: TokenProvider): Promise<Workspace[]> {
  const token = await getToken([
    "https://api.fabric.microsoft.com/Workspace.Read.All",
  ]);
  return fabricGetAll<Workspace>("/workspaces", token);
}

export async function listItems(
  getToken: TokenProvider,
  workspaceId: string,
): Promise<FabricItem[]> {
  const token = await getToken([
    "https://api.fabric.microsoft.com/Item.Read.All",
  ]);
  const items = await fabricGetAll<FabricItem>(
    `/workspaces/${workspaceId}/items`,
    token,
  );
  return items.map((i) => ({ ...i, workspaceId }));
}

interface PowerBiDataset {
  id: string;
  name: string;
  targetStorageMode?: string;
}

/**
 * Derives the workspace storage mode from its semantic models.
 * targetStorageMode "PremiumFiles" => Large dataset storage format.
 * Returns "None" when the workspace has no semantic models, and falls back to
 * "None" when datasets can't be read (e.g. missing Power BI permission).
 */
export async function getWorkspaceStorageMode(
  getToken: TokenProvider,
  workspaceId: string,
): Promise<StorageMode> {
  try {
    const token = await getToken([
      "https://analysis.windows.net/powerbi/api/Dataset.Read.All",
    ]);
    const data = await httpGet<PagedResponse<PowerBiDataset>>(
      `${POWERBI_BASE}/groups/${workspaceId}/datasets`,
      token,
    );
    const datasets = data.value ?? [];
    if (datasets.length === 0) return "None";
    const hasLarge = datasets.some(
      (d) => d.targetStorageMode === "PremiumFiles",
    );
    return hasLarge ? "Large" : "Small";
  } catch {
    return "None";
  }
}

interface RoleAssignment {
  id: string;
  principal?: { id?: string; type?: string };
  role?: WorkspaceRole;
}

/**
 * Resolves the signed-in user's role on a workspace from its role assignments.
 * Listing assignments requires workspace-admin permission, so a non-admin (or a
 * missing permission) yields `undefined` — which the admin gate treats as "no
 * manage rights".
 */
export async function getWorkspaceRole(
  getToken: TokenProvider,
  workspaceId: string,
  userObjectId: string,
): Promise<WorkspaceRole | undefined> {
  try {
    const token = await getToken([
      "https://api.fabric.microsoft.com/Workspace.Read.All",
    ]);
    const assignments = await fabricGetAll<RoleAssignment>(
      `/workspaces/${workspaceId}/roleAssignments`,
      token,
    );
    const target = userObjectId.toLowerCase();
    const mine = assignments.find(
      (a) => a.principal?.id?.toLowerCase() === target,
    );
    return mine?.role;
  } catch {
    return undefined;
  }
}

interface WorkspaceDetailsResponse {
  id: string;
  capacityRegion?: string;
  capacityAssignmentProgress?: string;
}

/** Per-workspace capacity region and (re)assignment progress (single GET). */
export interface WorkspaceDetails {
  capacityRegion?: string;
  capacityAssignmentProgress?: string;
}

/**
 * Reads capacity region and assignment progress from GET /v1/workspaces/{id}
 * (not returned by the list endpoint). Degrades gracefully to an empty object.
 */
export async function getWorkspaceDetails(
  getToken: TokenProvider,
  workspaceId: string,
): Promise<WorkspaceDetails> {
  try {
    const token = await getToken([
      "https://api.fabric.microsoft.com/Workspace.Read.All",
    ]);
    const ws = await httpGet<WorkspaceDetailsResponse>(
      `${FABRIC_BASE}/workspaces/${workspaceId}`,
      token,
    );
    return {
      capacityRegion: ws.capacityRegion,
      capacityAssignmentProgress: ws.capacityAssignmentProgress,
    };
  } catch {
    return {};
  }
}

interface AdminGroup {
  id: string;
  defaultDatasetStorageFormat?: string;
}

/**
 * Bulk-reads each workspace's default semantic-model storage format via the
 * Power BI admin API (GetGroupsAsAdmin). Requires the Fabric/Power BI admin role
 * (Tenant.Read.All); returns an empty map when unavailable so callers degrade.
 */
export async function getAdminWorkspaceStorageFormats(
  getToken: TokenProvider,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const token = await getToken([
      "https://analysis.windows.net/powerbi/api/Tenant.Read.All",
    ]);
    const data = await httpGet<PagedResponse<AdminGroup>>(
      `${POWERBI_BASE}/admin/groups?%24top=5000`,
      token,
    );
    for (const g of data.value ?? []) {
      if (g.defaultDatasetStorageFormat) {
        map.set(g.id, g.defaultDatasetStorageFormat);
      }
    }
  } catch {
    // No admin permission / consent declined — surface nothing.
  }
  return map;
}

interface FabricDomain {
  id: string;
  displayName: string;
}

/**
 * Resolves display names for the given (unique) governance domain ids via the
 * core Get Domain endpoint. Unknown/unauthorized ids are skipped, so the result
 * only contains ids that resolved. Reuses the existing Fabric read token.
 */
export async function getDomainNames(
  getToken: TokenProvider,
  domainIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = Array.from(new Set(domainIds.filter(Boolean)));
  if (unique.length === 0) return names;
  let token: string;
  try {
    token = await getToken([
      "https://api.fabric.microsoft.com/Workspace.Read.All",
    ]);
  } catch {
    return names;
  }
  await Promise.all(
    unique.map(async (id) => {
      try {
        const domain = await httpGet<FabricDomain>(
          `${FABRIC_BASE}/domains/${id}`,
          token,
        );
        if (domain.displayName) names.set(id, domain.displayName);
      } catch {
        // Skip ids the caller can't read.
      }
    }),
  );
  return names;
}

/** Runs async tasks with a bounded concurrency. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const current = cursor++;
      results[current] = await worker(items[current], current);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, run);
  await Promise.all(runners);
  return results;
}
