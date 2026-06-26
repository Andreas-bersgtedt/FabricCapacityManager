// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Client for the Fabric Capacity Metrics app semantic model. The Metrics app is
// the only self-service source for per-workspace OneLake storage (current and
// billable) and OneLake cache. We query it through the Power BI `executeQueries`
// REST API with DAX.
//
// IMPORTANT: the Metrics app semantic model schema is NOT publicly documented
// and is subject to change. We therefore discover the dataset by name and
// introspect the model schema at runtime (via the INFO.VIEW.* DAX functions)
// instead of hard-coding any table/column names, and we let the caller override
// the generated DAX query when the heuristics do not match a given model build.

import type { TokenProvider } from "../api/fabricApi";
import type { WorkspaceStorageUsage } from "../types";

const POWERBI_BASE = "https://api.powerbi.com/v1.0/myorg";

/** Power BI delegated scope required to read datasets and run executeQueries. */
const DATASET_READ_SCOPE =
  "https://analysis.windows.net/powerbi/api/Dataset.Read.All";
/** Power BI delegated scope required to enumerate workspaces (groups). */
const WORKSPACE_READ_SCOPE =
  "https://analysis.windows.net/powerbi/api/Workspace.Read.All";

/** Identifies a discovered Capacity Metrics semantic model. */
export interface MetricsDataset {
  workspaceId: string;
  workspaceName: string;
  datasetId: string;
  datasetName: string;
}

interface PowerBiGroup {
  id: string;
  name: string;
}

interface PowerBiDataset {
  id: string;
  name: string;
}

interface PagedValue<T> {
  value: T[];
}

async function pbiGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${POWERBI_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText} ${body}`);
  }
  return (await res.json()) as T;
}

/** Name patterns used to recognise the Metrics app workspace and dataset. */
const METRICS_NAME = /capacity\s*metrics|fabric\s*capacity\s*metrics/i;

/**
 * Locates the installed "Fabric Capacity Metrics" semantic model by scanning the
 * workspaces the user can access for a matching dataset. Returns null when no
 * matching dataset is found (the app is not installed or not shared with the
 * signed-in user).
 */
export async function discoverMetricsDataset(
  getToken: TokenProvider,
): Promise<MetricsDataset | null> {
  const token = await getToken([WORKSPACE_READ_SCOPE]);
  const groups = (await pbiGet<PagedValue<PowerBiGroup>>("/groups", token)).value ?? [];

  // Prefer workspaces whose name looks like the Metrics app, then fall back to
  // every accessible workspace (the app can be installed into a renamed one).
  const ordered = [
    ...groups.filter((g) => METRICS_NAME.test(g.name)),
    ...groups.filter((g) => !METRICS_NAME.test(g.name)),
  ];

  const datasetToken = await getToken([DATASET_READ_SCOPE]);
  for (const group of ordered) {
    let datasets: PowerBiDataset[];
    try {
      datasets = (
        await pbiGet<PagedValue<PowerBiDataset>>(
          `/groups/${group.id}/datasets`,
          datasetToken,
        )
      ).value ?? [];
    } catch {
      continue; // Skip workspaces we cannot read datasets for.
    }
    const match = datasets.find((d) => METRICS_NAME.test(d.name));
    if (match) {
      return {
        workspaceId: group.id,
        workspaceName: group.name,
        datasetId: match.id,
        datasetName: match.name,
      };
    }
  }
  return null;
}

type DaxValue = string | number | boolean | null;
type DaxRow = Record<string, DaxValue>;
export type { DaxValue, DaxRow };

interface ExecuteQueriesResponse {
  results?: Array<{ tables?: Array<{ rows?: DaxRow[] }> }>;
}

/**
 * Runs a single DAX query against the dataset via the Power BI executeQueries
 * REST API and returns the first result table's rows.
 */
export async function executeDax(
  getToken: TokenProvider,
  dataset: MetricsDataset,
  dax: string,
): Promise<DaxRow[]> {
  const token = await getToken([DATASET_READ_SCOPE]);
  const res = await fetch(
    `${POWERBI_BASE}/groups/${dataset.workspaceId}/datasets/${dataset.datasetId}/executeQueries`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        queries: [{ query: dax }],
        serializerSettings: { includeNulls: true },
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `executeQueries failed: ${res.status} ${res.statusText} ${body}`,
    );
  }
  const data = (await res.json()) as ExecuteQueriesResponse;
  return data.results?.[0]?.tables?.[0]?.rows ?? [];
}

/** A discovered model column: its owning table and its name. */
interface ModelColumn {
  table: string;
  name: string;
}

/** Reads the column part of an executeQueries key, e.g. "Storage[Foo]" -> "Foo". */
function columnPart(key: string): string {
  const open = key.indexOf("[");
  const close = key.lastIndexOf("]");
  return open >= 0 && close > open ? key.slice(open + 1, close) : key;
}

/** Runs INFO.VIEW.COLUMNS() to enumerate the model's tables and columns. */
async function introspectColumns(
  getToken: TokenProvider,
  dataset: MetricsDataset,
): Promise<ModelColumn[]> {
  const rows = await executeDax(getToken, dataset, "EVALUATE INFO.VIEW.COLUMNS()");
  const out: ModelColumn[] = [];
  for (const row of rows) {
    let table = "";
    let name = "";
    for (const [key, value] of Object.entries(row)) {
      const col = columnPart(key).toLowerCase();
      if (col === "table" && typeof value === "string") table = value;
      else if (col === "name" && typeof value === "string") name = value;
    }
    if (table && name) out.push({ table, name });
  }
  return out;
}

/** Runs INFO.VIEW.MEASURES() to enumerate the model's measures (best-effort). */
async function introspectMeasures(
  getToken: TokenProvider,
  dataset: MetricsDataset,
): Promise<ModelColumn[]> {
  try {
    const rows = await executeDax(
      getToken,
      dataset,
      "EVALUATE INFO.VIEW.MEASURES()",
    );
    const out: ModelColumn[] = [];
    for (const row of rows) {
      let table = "";
      let name = "";
      for (const [key, value] of Object.entries(row)) {
        const col = columnPart(key).toLowerCase();
        if (col === "table" && typeof value === "string") table = value;
        else if (col === "name" && typeof value === "string") name = value;
      }
      if (name) out.push({ table, name });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Returns a human-readable dump of the model's tables, columns and measures,
 * to help a user craft a custom DAX query when auto-discovery does not match.
 */
export async function introspectSchema(
  getToken: TokenProvider,
  dataset: MetricsDataset,
): Promise<string> {
  const [columns, measures] = await Promise.all([
    introspectColumns(getToken, dataset),
    introspectMeasures(getToken, dataset),
  ]);
  const byTable = new Map<string, string[]>();
  for (const c of columns) {
    const arr = byTable.get(c.table) ?? [];
    arr.push(c.name);
    byTable.set(c.table, arr);
  }
  const lines: string[] = [];
  for (const [table, cols] of [...byTable].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`'${table}'`);
    for (const col of cols.sort()) lines.push(`    [${col}]`);
  }
  if (measures.length > 0) {
    lines.push("");
    lines.push("Measures:");
    for (const m of measures.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`    [${m.name}]`);
    }
  }
  return lines.join("\n");
}

/** Picks the first column whose name matches any of the ordered patterns. */
function pickColumn(
  columns: ModelColumn[],
  patterns: RegExp[],
  table?: string,
): ModelColumn | undefined {
  const pool = table ? columns.filter((c) => c.table === table) : columns;
  for (const pattern of patterns) {
    const hit = pool.find((c) => pattern.test(c.name));
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Picks the first measure whose name matches any of the ordered patterns,
 * ignoring percentage/ratio measures (names containing "%").
 */
function pickMeasure(
  measures: ModelColumn[],
  patterns: RegExp[],
): ModelColumn | undefined {
  const pool = measures.filter((m) => !m.name.includes("%"));
  for (const pattern of patterns) {
    const hit = pool.find((m) => pattern.test(m.name));
    if (hit) return hit;
  }
  return undefined;
}

/** Escapes a single quote in a DAX table reference. */
function tableRef(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

/** Escapes a measure name for a DAX reference, e.g. [Current Storage in GB]. */
function measureRef(name: string): string {
  return `[${name.replace(/]/g, "]]")}]`;
}

/**
 * Builds a SUMMARIZECOLUMNS DAX query that returns per-workspace storage from
 * the discovered model. Prefers the model's storage measures (e.g. the Capacity
 * Metrics app's "Current Storage in GB" / "Billed (GB)"), grouped by a storage
 * table's WorkspaceId column. Falls back to aggregating raw storage columns.
 * Returns null when no workspace-id grouping column can be found.
 */
function buildStorageDax(
  columns: ModelColumn[],
  measures: ModelColumn[],
): string | null {
  // Grouping column: a WorkspaceId, preferring a per-workspace storage table.
  const wsIdColumns = columns.filter((c) => /^workspace\s*id$/i.test(c.name));
  const wsId =
    wsIdColumns.find((c) => /storagebyworkspaces/i.test(c.table)) ??
    wsIdColumns.find((c) => /storage/i.test(c.table)) ??
    wsIdColumns[0] ??
    pickColumn(columns, [/workspace\s*id/i, /\bws\s*id\b/i]);
  if (!wsId) return null;

  // Prefer measures (how the Metrics app actually surfaces storage).
  const currentMeasure = pickMeasure(measures, [
    /^current storage/i,
    /current.*storage/i,
  ]);
  const billableMeasure = pickMeasure(measures, [
    /^billed \(gb\)$/i,
    /billable.*storage/i,
    /\bbilled\b/i,
  ]);
  const cacheMeasure = pickMeasure(measures, [/cache/i]);

  const ref = tableRef(wsId.table);
  const parts: string[] = [`${ref}[${wsId.name}]`];

  if (currentMeasure || billableMeasure || cacheMeasure) {
    if (currentMeasure)
      parts.push(`"CurrentGB", ${measureRef(currentMeasure.name)}`);
    if (billableMeasure)
      parts.push(`"BillableGB", ${measureRef(billableMeasure.name)}`);
    if (cacheMeasure) parts.push(`"CacheGB", ${measureRef(cacheMeasure.name)}`);
    return `EVALUATE\nSUMMARIZECOLUMNS(\n  ${parts.join(",\n  ")}\n)`;
  }

  // Fallback: aggregate raw storage columns on the workspace-id table.
  const table = wsId.table;
  const current = pickColumn(
    columns,
    [/current.*storage/i, /static.*storage/i, /utilization/i],
    table,
  );
  const billable = pickColumn(
    columns,
    [/billable.*storage/i, /billed/i],
    table,
  );
  const cache = pickColumn(columns, [/cache/i], table);
  if (!current && !billable && !cache) return null;
  if (current) parts.push(`"CurrentGB", MAX(${ref}[${current.name}])`);
  if (billable) parts.push(`"BillableGB", MAX(${ref}[${billable.name}])`);
  if (cache) parts.push(`"CacheGB", MAX(${ref}[${cache.name}])`);
  return `EVALUATE\nSUMMARIZECOLUMNS(\n  ${parts.join(",\n  ")}\n)`;
}

function toNumber(value: DaxValue): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Maps executeQueries result rows to per-workspace storage usage. Recognises a
 * workspace-id column by name or GUID shape, and the named CurrentGB/BillableGB/
 * CacheGB columns produced by the generated query (or matched by name in a
 * custom query).
 */
function mapStorageRows(rows: DaxRow[]): Map<string, WorkspaceStorageUsage> {
  const byWorkspace = new Map<string, WorkspaceStorageUsage>();
  for (const row of rows) {
    let workspaceId: string | undefined;
    let currentGb: number | undefined;
    let billableGb: number | undefined;
    let cacheGb: number | undefined;
    for (const [key, value] of Object.entries(row)) {
      const col = columnPart(key).toLowerCase();
      if (!workspaceId && typeof value === "string" && GUID_RE.test(value.trim())) {
        if (/workspace/.test(col) || /\bid\b/.test(col)) workspaceId = value.trim();
      }
      if (/current/.test(col) && /storage|gb/.test(col)) currentGb ??= toNumber(value);
      else if (/billable/.test(col) && /storage|gb/.test(col))
        billableGb ??= toNumber(value);
      else if (/cache/.test(col)) cacheGb ??= toNumber(value);
    }
    // Second pass: accept a plain workspace-id column even if not GUID-typed.
    if (!workspaceId) {
      for (const [key, value] of Object.entries(row)) {
        const col = columnPart(key).toLowerCase();
        if (/workspace\s*id/.test(col) && typeof value === "string") {
          workspaceId = value.trim();
          break;
        }
      }
    }
    if (!workspaceId) continue;
    // Key by lower-case GUID so lookups against Fabric workspace ids (which are
    // lower-case) match regardless of the case the model returns.
    byWorkspace.set(workspaceId.toLowerCase(), {
      workspaceId,
      currentGb,
      billableGb,
      cacheGb,
    });
  }
  return byWorkspace;
}

/**
 * Fetches per-workspace OneLake storage usage from the Metrics app model.
 *
 * When `customDax` is provided it is executed as-is (it must return a workspace
 * id column plus CurrentGB / BillableGB / CacheGB columns). Otherwise the model
 * schema is introspected and a query is generated automatically.
 *
 * @returns the storage map and the DAX query that was executed (so the UI can
 * show / let the user tweak it).
 */
export async function fetchWorkspaceStorage(
  getToken: TokenProvider,
  dataset: MetricsDataset,
  customDax?: string,
): Promise<{
  byWorkspace: Map<string, WorkspaceStorageUsage>;
  dax: string;
  rows: DaxRow[];
}> {
  let dax = customDax?.trim();
  if (!dax) {
    const [columns, measures] = await Promise.all([
      introspectColumns(getToken, dataset),
      introspectMeasures(getToken, dataset),
    ]);
    const generated = buildStorageDax(columns, measures);
    if (!generated) {
      throw new Error(
        "Could not locate workspace storage in the Metrics model. " +
          "Use the schema below to provide a custom DAX query.",
      );
    }
    dax = generated;
  }
  const rows = await executeDax(getToken, dataset, dax);
  return { byWorkspace: mapStorageRows(rows), dax, rows };
}
