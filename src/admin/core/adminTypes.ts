// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A - Admin Mode: shared domain types for the admin operation lifecycle.
// Every vertical slice (scale, pause/resume, move) speaks these contracts so the
// preflight -> confirm -> submit -> poll -> audit flow is identical everywhere.

/** The set of admin (write) operations supported by Branch A. */
export type AdminOperationType =
  | "capacity.scale"
  | "capacity.pause"
  | "capacity.resume"
  | "workspace.move.sameGeo"
  | "workspace.move.crossRegion";

export type ValidationSeverity = "info" | "warning" | "error";

/** A single validation/diagnostic message returned by preflight or polling. */
export interface ValidationMessage {
  code: string;
  severity: ValidationSeverity;
  message: string;
  /** Optional id of the resource/item the message refers to. */
  target?: string;
}

/** UI-facing lifecycle state for a single operation controller. */
export type OperationStatus =
  | "idle"
  | "preflighting"
  | "awaitingConfirmation"
  | "queued"
  | "inProgress"
  | "succeeded"
  | "failed"
  | "cancelled";

/** Result of validating an operation before it is allowed to run. */
export interface AdminPreflightResult {
  operationType: AdminOperationType;
  isAllowed: boolean;
  messages: ValidationMessage[];
  impactSummary: string[];
  requiresConfirmation: boolean;
  confirmationText?: string;
  correlationId: string;
}

/** Result of submitting an operation for execution. */
export interface AdminSubmitResult {
  operationId: string;
  operationType: AdminOperationType;
  status: "queued" | "inProgress";
  correlationId: string;
}

/** A point-in-time status of a running/finished operation. */
export interface AdminOperationProgress {
  operationId: string;
  operationType: AdminOperationType;
  status: "queued" | "inProgress" | "succeeded" | "failed" | "cancelled";
  startedAtUtc?: string;
  completedAtUtc?: string;
  messages: ValidationMessage[];
  correlationId: string;
}

export type AuditOutcome =
  | "attempted"
  | "blocked"
  | "succeeded"
  | "failed"
  | "cancelled";

/** An auditable record emitted for every admin operation attempt. */
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

/** Sink that receives audit events for each admin operation attempt. */
export type AuditSink = (event: AuditEvent) => void;

/**
 * Contract every Branch A slice implements. Keeping the lifecycle behind one
 * interface lets the generic {@link useAdminOperation} hook drive any operation.
 */
export interface AdminOperationHandler<TRequest> {
  readonly type: AdminOperationType;
  /** Validates the request; returns whether it is allowed plus impact/messages. */
  preflight(request: TRequest): Promise<AdminPreflightResult>;
  /** Submits an allowed request for execution. */
  submit(request: TRequest): Promise<AdminSubmitResult>;
  /** Polls the status of a submitted operation. */
  poll(operationId: string): Promise<AdminOperationProgress>;
  /** Maps a request to the audit target id map (source/destination/etc.). */
  describeTargets(request: TRequest): Record<string, string>;
}
