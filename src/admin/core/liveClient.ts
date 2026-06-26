// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A - Admin Mode: live execution client. Implements the real submit/poll
// half of the operation lifecycle against two control planes:
//
//   * Capacity scale / pause / resume -> Azure Resource Manager
//     (`Microsoft.Fabric/capacities`), as long-running operations.
//   * Workspace move (assignToCapacity) -> Fabric REST data plane.
//
// The real preflight (validation) lives in each slice and is plane-agnostic.
// Operations are tracked in a module-level registry so `pollLiveOperation` can
// resume an in-flight operation by its id.

import type { TokenProvider } from "../../api/fabricApi";
import { azureArmScopes, fabricWriteScopes } from "../../authConfig";
import { newCorrelationId } from "./adminClient";
import type {
  AdminOperationProgress,
  AdminOperationType,
  AdminSubmitResult,
  OperationStatus,
} from "./adminTypes";

const ARM_BASE = "https://management.azure.com";
const ARM_API_VERSION = "2023-11-01";
const SUBSCRIPTIONS_API_VERSION = "2020-01-01";
const FABRIC_BASE = "https://api.fabric.microsoft.com/v1";

/** A poll closure that resolves the current status of one submitted operation. */
type LivePoll = () => Promise<AdminOperationProgress>;

const liveOps = new Map<string, { type: AdminOperationType; poll: LivePoll }>();

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}

function progress(
  operationId: string,
  type: AdminOperationType,
  status: OperationStatus,
  startedAtUtc: string,
  extra?: Partial<AdminOperationProgress>,
): AdminOperationProgress {
  const terminal =
    status === "succeeded" || status === "failed" || status === "cancelled";
  return {
    operationId,
    operationType: type,
    status: status as AdminOperationProgress["status"],
    startedAtUtc,
    completedAtUtc: terminal ? new Date().toISOString() : undefined,
    messages: [],
    correlationId: operationId,
    ...extra,
  };
}

/**
 * Resolves the full ARM resource id of a Fabric capacity by its name. The
 * Fabric `/v1/capacities` API does not return ARM ids, so we enumerate the
 * caller's subscriptions and match by capacity name.
 */
export async function findCapacityArmId(
  armToken: string,
  capacityName: string,
): Promise<string | null> {
  const subsRes = await fetch(
    `${ARM_BASE}/subscriptions?api-version=${SUBSCRIPTIONS_API_VERSION}`,
    { headers: { Authorization: `Bearer ${armToken}` } },
  );
  if (!subsRes.ok) {
    throw new Error(
      `Listing Azure subscriptions failed (${subsRes.status}). ${await safeText(subsRes)}`,
    );
  }
  const subs = ((await subsRes.json()).value ?? []) as {
    subscriptionId: string;
  }[];

  const target = capacityName.toLowerCase();
  for (const sub of subs) {
    const res = await fetch(
      `${ARM_BASE}/subscriptions/${sub.subscriptionId}/providers/Microsoft.Fabric/capacities?api-version=${ARM_API_VERSION}`,
      { headers: { Authorization: `Bearer ${armToken}` } },
    );
    if (!res.ok) continue;
    const items = ((await res.json()).value ?? []) as {
      id: string;
      name: string;
    }[];
    const match = items.find((c) => c.name.toLowerCase() === target);
    if (match) return match.id;
  }
  return null;
}

/**
 * Builds a map of capacity name (lower-cased) -> Azure resource tags by
 * enumerating the caller's subscriptions and Microsoft.Fabric/capacities. Tags
 * live on the ARM resource (not the Fabric `/v1/capacities` list), so this needs
 * an ARM token. Best-effort: returns an empty map when ARM is unavailable.
 */
export async function getCapacityTags(
  getToken: TokenProvider,
): Promise<Map<string, Record<string, string>>> {
  const tagsByName = new Map<string, Record<string, string>>();
  try {
    const armToken = await getToken(azureArmScopes);
    const subsRes = await fetch(
      `${ARM_BASE}/subscriptions?api-version=${SUBSCRIPTIONS_API_VERSION}`,
      { headers: { Authorization: `Bearer ${armToken}` } },
    );
    if (!subsRes.ok) return tagsByName;
    const subs = ((await subsRes.json()).value ?? []) as {
      subscriptionId: string;
    }[];
    for (const sub of subs) {
      const res = await fetch(
        `${ARM_BASE}/subscriptions/${sub.subscriptionId}/providers/Microsoft.Fabric/capacities?api-version=${ARM_API_VERSION}`,
        { headers: { Authorization: `Bearer ${armToken}` } },
      );
      if (!res.ok) continue;
      const items = ((await res.json()).value ?? []) as {
        name: string;
        tags?: Record<string, string>;
      }[];
      for (const c of items) {
        if (c.tags && Object.keys(c.tags).length > 0) {
          tagsByName.set(c.name.toLowerCase(), c.tags);
        }
      }
    }
  } catch {
    // No ARM access — surface no tags.
  }
  return tagsByName;
}

function registerArmOperation(
  getToken: TokenProvider,
  type: AdminOperationType,
  asyncUrl: string | null,
  httpStatus: number,
): AdminSubmitResult {
  const operationId = newCorrelationId();
  const startedAtUtc = new Date().toISOString();

  liveOps.set(operationId, {
    type,
    poll: async () => {
      // No async-operation header means the management plane completed the
      // request synchronously.
      if (!asyncUrl) {
        return progress(operationId, type, "succeeded", startedAtUtc);
      }
      const token = await getToken(azureArmScopes);
      const res = await fetch(asyncUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        return progress(operationId, type, "failed", startedAtUtc, {
          messages: [
            {
              code: "ARM_POLL_FAILED",
              severity: "error",
              message: `Polling the operation failed (${res.status}). ${await safeText(res)}`,
            },
          ],
        });
      }
      const body = (await res.json()) as {
        status?: string;
        error?: { code?: string; message?: string };
      };
      const s = (body.status ?? "").toLowerCase();
      const status: OperationStatus =
        s === "succeeded"
          ? "succeeded"
          : s === "failed" || s === "canceled" || s === "cancelled"
            ? "failed"
            : "inProgress";
      return progress(operationId, type, status, startedAtUtc, {
        messages: body.error
          ? [
              {
                code: body.error.code ?? "ARM_OPERATION_ERROR",
                severity: "error",
                message: body.error.message ?? "Operation failed.",
              },
            ]
          : [],
      });
    },
  });

  return {
    operationId,
    operationType: type,
    status: httpStatus === 202 ? "inProgress" : "queued",
    correlationId: newCorrelationId(),
  };
}

/** Scales a capacity by updating its ARM SKU (PATCH). */
export async function submitScaleCapacity(
  getToken: TokenProvider,
  req: { capacityName: string; toSku: string },
): Promise<AdminSubmitResult> {
  const token = await getToken(azureArmScopes);
  const armId = await findCapacityArmId(token, req.capacityName);
  if (!armId) {
    throw new Error(
      `Could not resolve the Azure resource id for capacity "${req.capacityName}".`,
    );
  }
  const res = await fetch(`${ARM_BASE}${armId}?api-version=${ARM_API_VERSION}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sku: { name: req.toSku, tier: "Fabric" } }),
  });
  if (!res.ok && res.status !== 202) {
    throw new Error(`Scale request failed (${res.status}). ${await safeText(res)}`);
  }
  const asyncUrl =
    res.headers.get("Azure-AsyncOperation") ?? res.headers.get("Location");
  return registerArmOperation(getToken, "capacity.scale", asyncUrl, res.status);
}

/** Pauses (suspend) or resumes a capacity via an ARM action (POST). */
export async function submitPauseResume(
  getToken: TokenProvider,
  req: { capacityName: string; action: "pause" | "resume" },
): Promise<AdminSubmitResult> {
  const token = await getToken(azureArmScopes);
  const armId = await findCapacityArmId(token, req.capacityName);
  if (!armId) {
    throw new Error(
      `Could not resolve the Azure resource id for capacity "${req.capacityName}".`,
    );
  }
  const verb = req.action === "pause" ? "suspend" : "resume";
  const res = await fetch(
    `${ARM_BASE}${armId}/${verb}?api-version=${ARM_API_VERSION}`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok && res.status !== 202) {
    throw new Error(
      `${verb} request failed (${res.status}). ${await safeText(res)}`,
    );
  }
  const asyncUrl =
    res.headers.get("Azure-AsyncOperation") ?? res.headers.get("Location");
  const type: AdminOperationType =
    req.action === "pause" ? "capacity.pause" : "capacity.resume";
  return registerArmOperation(getToken, type, asyncUrl, res.status);
}

/** Reassigns a workspace to a different capacity via the Fabric REST API. */
export async function submitWorkspaceMove(
  getToken: TokenProvider,
  req: { workspaceId: string; destinationCapacityId: string; crossRegion: boolean },
): Promise<AdminSubmitResult> {
  const token = await getToken(fabricWriteScopes);
  const res = await fetch(
    `${FABRIC_BASE}/workspaces/${req.workspaceId}/assignToCapacity`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ capacityId: req.destinationCapacityId }),
    },
  );
  if (!res.ok && res.status !== 202) {
    throw new Error(
      `Assign to capacity failed (${res.status}). ${await safeText(res)}`,
    );
  }
  const type: AdminOperationType = req.crossRegion
    ? "workspace.move.crossRegion"
    : "workspace.move.sameGeo";
  const location = res.headers.get("Location");
  const operationId = newCorrelationId();
  const startedAtUtc = new Date().toISOString();

  liveOps.set(operationId, {
    type,
    poll: async () => {
      // Fabric returns the result inline (no Location) when the assignment
      // completes synchronously.
      if (!location) {
        return progress(operationId, type, "succeeded", startedAtUtc);
      }
      const pollToken = await getToken(fabricWriteScopes);
      const pollRes = await fetch(location, {
        headers: { Authorization: `Bearer ${pollToken}` },
      });
      if (pollRes.status === 202) {
        return progress(operationId, type, "inProgress", startedAtUtc);
      }
      if (!pollRes.ok) {
        return progress(operationId, type, "failed", startedAtUtc, {
          messages: [
            {
              code: "FABRIC_POLL_FAILED",
              severity: "error",
              message: `Polling the move failed (${pollRes.status}). ${await safeText(pollRes)}`,
            },
          ],
        });
      }
      // 200 OK: completed. Inspect the optional status payload for failures
      // (cross-region moves can finish with per-item errors).
      let status: OperationStatus = "succeeded";
      try {
        const body = (await pollRes.json()) as { status?: string };
        const s = (body.status ?? "").toLowerCase();
        if (s === "failed") status = "failed";
        else if (s && s !== "succeeded" && s !== "completed")
          status = "inProgress";
      } catch {
        // Empty body means the operation is complete.
      }
      return progress(operationId, type, status, startedAtUtc);
    },
  });

  return {
    operationId,
    operationType: type,
    status: location ? "inProgress" : "queued",
    correlationId: newCorrelationId(),
  };
}

/** Polls a previously submitted live operation by id. */
export async function pollLiveOperation(
  operationId: string,
): Promise<AdminOperationProgress> {
  const op = liveOps.get(operationId);
  if (!op) {
    return {
      operationId,
      operationType: "capacity.scale",
      status: "failed",
      messages: [
        {
          code: "UNKNOWN_OPERATION",
          severity: "error",
          message: "No live operation is registered for this id.",
        },
      ],
      correlationId: operationId,
    };
  }
  return op.poll();
}
