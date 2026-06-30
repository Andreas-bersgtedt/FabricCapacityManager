// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Audit collector: the wire contract for an admin audit event. This mirrors the
// client-side `AuditEvent` in src/admin/core/adminTypes.ts. Keep the two in sync
// — the collector is the durable, server-side record of what the client emitted.

export type AdminOperationType =
  | "capacity.scale"
  | "capacity.pause"
  | "capacity.resume"
  | "workspace.move.sameGeo"
  | "workspace.move.crossRegion";

export type AuditOutcome =
  | "attempted"
  | "blocked"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface AuditEvent {
  operationId?: string;
  operationType: AdminOperationType;
  actorObjectId?: string;
  targetIds: Record<string, string>;
  outcome: AuditOutcome;
  timestampUtc: string;
  correlationId: string;
  details?: Record<string, string>;
}

const OPERATION_TYPES: ReadonlySet<string> = new Set<AdminOperationType>([
  "capacity.scale",
  "capacity.pause",
  "capacity.resume",
  "workspace.move.sameGeo",
  "workspace.move.crossRegion",
]);

const OUTCOMES: ReadonlySet<string> = new Set<AuditOutcome>([
  "attempted",
  "blocked",
  "succeeded",
  "failed",
  "cancelled",
]);

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every((v) => typeof v === "string");
}

/** Narrows untrusted request input to a well-formed {@link AuditEvent}. */
export function parseAuditEvent(input: unknown): AuditEvent | null {
  if (typeof input !== "object" || input === null) return null;
  const candidate = input as Record<string, unknown>;

  if (!OPERATION_TYPES.has(candidate.operationType as string)) return null;
  if (!OUTCOMES.has(candidate.outcome as string)) return null;
  if (typeof candidate.timestampUtc !== "string") return null;
  if (typeof candidate.correlationId !== "string") return null;
  if (!isStringRecord(candidate.targetIds)) return null;

  if (
    candidate.operationId !== undefined &&
    typeof candidate.operationId !== "string"
  ) {
    return null;
  }
  if (
    candidate.actorObjectId !== undefined &&
    typeof candidate.actorObjectId !== "string"
  ) {
    return null;
  }
  if (candidate.details !== undefined && !isStringRecord(candidate.details)) {
    return null;
  }

  return {
    operationId: candidate.operationId as string | undefined,
    operationType: candidate.operationType as AdminOperationType,
    actorObjectId: candidate.actorObjectId as string | undefined,
    targetIds: candidate.targetIds as Record<string, string>,
    outcome: candidate.outcome as AuditOutcome,
    timestampUtc: candidate.timestampUtc,
    correlationId: candidate.correlationId,
    details: candidate.details as Record<string, string> | undefined,
  };
}
