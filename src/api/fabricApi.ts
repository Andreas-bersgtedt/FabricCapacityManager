import type { Capacity, FabricItem, StorageMode, Workspace } from "../types";

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
