// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Access self-test: declares every delegated permission (scope) the app relies
// on — for both standard (read) and admin (write) mode — and probes each one to
// verify the signed-in user actually has the right, not just consent.
//
// The runner is intentionally pure: it takes a token acquirer (silent or
// interactive) and runs each check, so it can be unit-tested without MSAL.

const FABRIC_BASE = "https://api.fabric.microsoft.com/v1";
const POWERBI_BASE = "https://api.powerbi.com/v1.0/myorg";
const ARM_BASE = "https://management.azure.com";

/** Which mode a permission belongs to. */
export type AccessMode = "standard" | "admin";

/** Outcome of a single access check. */
export type AccessStatus =
  | "checking" // in flight
  | "granted" // consent present and (where probed) the API returned data
  | "warning" // consent present but the user lacks the underlying right, or an optional capability is unavailable
  | "denied"; // consent/interaction required — the permission has not been granted

/** Result of probing one permission against a live API. */
interface ProbeResult {
  ok: boolean;
  status?: number;
  detail?: string;
}

/** A function that returns a bearer token for the given scopes (or throws). */
export type AcquireToken = (scopes: string[]) => Promise<string>;

/** A declared permission the app requires, plus how to verify it. */
export interface AccessCheck {
  /** Stable identifier. */
  id: string;
  /** Short human label shown in the UI. */
  label: string;
  /** What the permission is used for. */
  description: string;
  /** Standard (read) or admin (write) mode. */
  mode: AccessMode;
  /** The delegated scope(s) requested for this capability. */
  scopes: string[];
  /**
   * Optional live probe. Receives a valid token and performs a lightweight,
   * read-only request to confirm the user truly has the right. When omitted the
   * check is "consent only" — acquiring the token is the only signal available
   * (used for write scopes that cannot be exercised non-destructively).
   */
  probe?: (token: string) => Promise<ProbeResult>;
  /**
   * When true, a failure is non-blocking: the capability is optional and the app
   * degrades gracefully without it (reported as a warning, never denied).
   */
  optional?: boolean;
}

/** A completed check with its resolved status and a user-facing message. */
export interface AccessCheckResult {
  check: AccessCheck;
  status: AccessStatus;
  message: string;
}

async function probeGet(url: string, token: string): Promise<ProbeResult> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (res.ok) return { ok: true, status: res.status };
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    return { ok: false, status: res.status, detail };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The full catalogue of permissions the app uses. Standard-mode permissions are
 * required to read and display the tenant; admin-mode permissions are only used
 * when performing live write operations (scale / pause / resume / move).
 */
export const ACCESS_CHECKS: AccessCheck[] = [
  // ---- Standard (read) mode --------------------------------------------------
  {
    id: "fabric.capacities.read",
    label: "List Fabric capacities",
    description: "Read capacities (SKU, region, state) from the Fabric REST API.",
    mode: "standard",
    scopes: ["https://api.fabric.microsoft.com/Capacity.Read.All"],
    probe: (token) => probeGet(`${FABRIC_BASE}/capacities`, token),
  },
  {
    id: "fabric.workspaces.read",
    label: "List Fabric workspaces",
    description:
      "Read workspaces, role assignments and workspace details from the Fabric REST API.",
    mode: "standard",
    scopes: ["https://api.fabric.microsoft.com/Workspace.Read.All"],
    probe: (token) => probeGet(`${FABRIC_BASE}/workspaces`, token),
  },
  {
    id: "fabric.items.read",
    label: "Read workspace items",
    description:
      "Enumerate the items inside each workspace to derive item-type filters.",
    mode: "standard",
    // No tenant-level probe exists for items (they are scoped to a workspace),
    // so this is verified by consent only.
    scopes: ["https://api.fabric.microsoft.com/Item.Read.All"],
  },
  {
    id: "powerbi.datasets.read",
    label: "Read semantic models (storage mode)",
    description:
      "Read semantic-model storage mode via the Power BI API (not exposed by Fabric).",
    mode: "standard",
    scopes: ["https://analysis.windows.net/powerbi/api/Dataset.Read.All"],
    probe: (token) => probeGet(`${POWERBI_BASE}/datasets`, token),
  },
  {
    id: "powerbi.admin.read",
    label: "Read workspace storage formats (tenant admin)",
    description:
      "Bulk-read default semantic-model storage formats via the Power BI admin API. Requires a Fabric/Power BI admin role.",
    mode: "standard",
    optional: true,
    scopes: ["https://analysis.windows.net/powerbi/api/Tenant.Read.All"],
    probe: (token) => probeGet(`${POWERBI_BASE}/admin/groups?%24top=1`, token),
  },

  // ---- Admin (write) mode ----------------------------------------------------
  {
    id: "arm.capacities.manage",
    label: "Manage capacities (Azure Resource Manager)",
    description:
      "Scale, pause and resume Microsoft.Fabric/capacities via Azure Resource Manager, and resolve their Azure resource ids.",
    mode: "admin",
    scopes: ["https://management.azure.com/.default"],
    // Listing subscriptions confirms ARM consent and reachability. The user must
    // additionally hold the Contributor/Owner RBAC on the target capacity for the
    // write itself to succeed.
    probe: (token) =>
      probeGet(`${ARM_BASE}/subscriptions?api-version=2020-01-01`, token),
  },
  {
    id: "fabric.capacity.write",
    label: "Reassign / manage capacities (Fabric)",
    description:
      "Capacity write scope used by admin capacity operations on the Fabric data plane.",
    mode: "admin",
    // Cannot be exercised without making a real change, so consent only.
    scopes: ["https://api.fabric.microsoft.com/Capacity.ReadWrite.All"],
  },
  {
    id: "fabric.workspace.write",
    label: "Move workspaces between capacities (Fabric)",
    description:
      "Reassign a workspace to a different capacity (assignToCapacity) via the Fabric REST API.",
    mode: "admin",
    // Cannot be exercised without making a real change, so consent only.
    scopes: ["https://api.fabric.microsoft.com/Workspace.ReadWrite.All"],
  },
];

function deniedMessage(check: AccessCheck): string {
  return check.optional
    ? "Not granted (optional). Sign in / consent to enable this capability."
    : "Not granted. Consent is required — use “Grant access” to request it.";
}

function statusFromProbe(check: AccessCheck, probe: ProbeResult): AccessCheckResult {
  if (probe.ok) {
    return { check, status: "granted", message: "Granted and verified." };
  }
  if (probe.status === 401 || probe.status === 403) {
    return {
      check,
      status: "warning",
      message: check.optional
        ? "Consented, but you do not have this (optional) right."
        : `Consented, but the API returned ${probe.status} — you may lack the required role/RBAC.`,
    };
  }
  return {
    check,
    status: "warning",
    message: probe.status
      ? `Consented, but the probe failed (${probe.status}).`
      : `Consented, but the probe could not complete.${probe.detail ? ` ${probe.detail}` : ""}`,
  };
}

/** Runs a single access check: acquire a token, then (optionally) probe it. */
export async function runAccessCheck(
  acquire: AcquireToken,
  check: AccessCheck,
): Promise<AccessCheckResult> {
  let token: string;
  try {
    token = await acquire(check.scopes);
  } catch {
    return {
      check,
      status: check.optional ? "warning" : "denied",
      message: deniedMessage(check),
    };
  }

  if (!check.probe) {
    return {
      check,
      status: "granted",
      message: "Consent verified (not exercised).",
    };
  }

  const probe = await check.probe(token);
  return statusFromProbe(check, probe);
}

/** Runs every (or the given) access check concurrently. */
export async function runAccessChecks(
  acquire: AcquireToken,
  checks: AccessCheck[] = ACCESS_CHECKS,
): Promise<AccessCheckResult[]> {
  return Promise.all(checks.map((c) => runAccessCheck(acquire, c)));
}

/** Distinct resources (one MSAL consent prompt each) across the given checks. */
export function distinctResourceScopes(
  checks: AccessCheck[] = ACCESS_CHECKS,
): string[][] {
  const byResource = new Map<string, Set<string>>();
  for (const check of checks) {
    for (const scope of check.scopes) {
      // Group by resource: the scope path up to the last "/" (or ".default").
      const resource = scope.replace(/\/[^/]+$/, "");
      const set = byResource.get(resource) ?? new Set<string>();
      set.add(scope);
      byResource.set(resource, set);
    }
  }
  return Array.from(byResource.values(), (s) => Array.from(s));
}
