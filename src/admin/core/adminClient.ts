// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A - Admin Mode: low-level client scaffolding for admin write
// operations. The HTTP calls are intentionally left unimplemented so each slice
// has a single, obvious place to wire the real Fabric / back-end endpoints.

import type { TokenProvider } from "../../api/fabricApi";
import type {
  AdminOperationProgress,
  AdminOperationType,
  AdminPreflightResult,
  AdminSubmitResult,
} from "./adminTypes";

/** Thrown by scaffolded operations that have not been implemented yet. */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet (Branch A scaffold).`);
    this.name = "NotImplementedError";
  }
}

/** Generates a correlation id used to trace an operation end-to-end. */
export function newCorrelationId(): string {
  return crypto.randomUUID();
}

/**
 * Delegated scopes required for admin write operations.
 * TODO(Branch A): add the real read/write scopes to the app registration and
 * list them here, e.g. Capacity.ReadWrite.All / Workspace.ReadWrite.All.
 */
export const adminFabricScopes: string[] = [];

/**
 * Validates an operation server-side before it runs.
 * TODO(Branch A): replace with the real preflight request.
 */
export async function preflightOperation(
  _getToken: TokenProvider,
  _body: unknown,
): Promise<AdminPreflightResult> {
  throw new NotImplementedError("preflightOperation");
}

/**
 * Submits an allowed operation for execution.
 * TODO(Branch A): replace with the real submit request.
 */
export async function submitOperation(
  _getToken: TokenProvider,
  _body: unknown,
): Promise<AdminSubmitResult> {
  throw new NotImplementedError("submitOperation");
}

/**
 * Polls the status of a submitted operation.
 * TODO(Branch A): replace with the real status request.
 */
export async function pollOperation(
  _getToken: TokenProvider,
  _operationId: string,
): Promise<AdminOperationProgress> {
  throw new NotImplementedError("pollOperation");
}

// --- Simulation helpers (scaffold/demo only) ------------------------------
// TODO(Branch A): remove these once the real admin endpoints are wired. They
// let the UI exercise the full preflight -> submit -> poll lifecycle locally.

const simulatedOps = new Map<
  string,
  { type: AdminOperationType; createdAtMs: number }
>();

/** Simulated submit that completes shortly after, for demoing the UI flow. */
export async function simulateSubmit(
  _getToken: TokenProvider,
  type: AdminOperationType,
): Promise<AdminSubmitResult> {
  const operationId = newCorrelationId();
  simulatedOps.set(operationId, { type, createdAtMs: Date.now() });
  return {
    operationId,
    operationType: type,
    status: "queued",
    correlationId: newCorrelationId(),
  };
}

/** Simulated poll that reports success ~1.5s after submit. */
export async function simulatePoll(
  operationId: string,
): Promise<AdminOperationProgress> {
  const op = simulatedOps.get(operationId);
  const type: AdminOperationType = op?.type ?? "capacity.scale";
  const elapsed = op ? Date.now() - op.createdAtMs : Number.MAX_SAFE_INTEGER;
  const done = elapsed > 1500;
  return {
    operationId,
    operationType: type,
    status: done ? "succeeded" : "inProgress",
    startedAtUtc: op ? new Date(op.createdAtMs).toISOString() : undefined,
    completedAtUtc: done ? new Date().toISOString() : undefined,
    messages: [],
    correlationId: operationId,
  };
}
