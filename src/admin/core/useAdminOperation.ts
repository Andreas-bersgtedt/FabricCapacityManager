// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A - Admin Mode: generic operation lifecycle hook. Drives any slice's
// AdminOperationHandler through preflight -> confirm -> submit -> poll, tracks
// UI state, and emits audit events at each decision point.

import { useCallback, useRef, useState } from "react";
import type {
  AdminOperationHandler,
  AdminOperationProgress,
  AdminPreflightResult,
  AuditEvent,
  AuditSink,
  OperationStatus,
} from "./adminTypes";
import { localStorageAuditSink } from "./auditStore";

interface UseAdminOperationOptions {
  /** Sink to persist audit events. Defaults to console logging. */
  auditSink?: AuditSink;
  /** Polling interval in milliseconds while an operation runs. */
  pollIntervalMs?: number;
  /** Object id of the signed-in actor, recorded on audit events. */
  actorObjectId?: string;
}

export interface AdminOperationController<TRequest> {
  status: OperationStatus;
  preflight: AdminPreflightResult | null;
  progress: AdminOperationProgress | null;
  error: string | null;
  /** Runs preflight; moves to `awaitingConfirmation` when the request is allowed. */
  start(request: TRequest): Promise<void>;
  /** Submits a previously preflighted request and polls to completion. */
  confirm(request: TRequest): Promise<void>;
  /** Resets the controller back to idle and stops any polling. */
  reset(): void;
}

const defaultAuditSink: AuditSink = (event) => {
  // Persist to the durable local store so the record survives a reload, and
  // mirror to the console for live debugging.
  console.info("[admin-audit]", event);
  localStorageAuditSink(event);
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useAdminOperation<TRequest>(
  handler: AdminOperationHandler<TRequest>,
  options: UseAdminOperationOptions = {},
): AdminOperationController<TRequest> {
  const {
    auditSink = defaultAuditSink,
    pollIntervalMs = 2000,
    actorObjectId,
  } = options;

  const [status, setStatus] = useState<OperationStatus>("idle");
  const [preflight, setPreflight] = useState<AdminPreflightResult | null>(null);
  const [progress, setProgress] = useState<AdminOperationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const audit = useCallback(
    (event: Omit<AuditEvent, "timestampUtc">) => {
      auditSink({ ...event, timestampUtc: new Date().toISOString() });
    },
    [auditSink],
  );

  const reset = useCallback(() => {
    cancelled.current = true;
    setStatus("idle");
    setPreflight(null);
    setProgress(null);
    setError(null);
  }, []);

  const start = useCallback(
    async (request: TRequest) => {
      cancelled.current = false;
      setError(null);
      setProgress(null);
      setStatus("preflighting");
      try {
        const result = await handler.preflight(request);
        setPreflight(result);
        if (!result.isAllowed) {
          setStatus("failed");
          audit({
            operationType: handler.type,
            actorObjectId,
            targetIds: handler.describeTargets(request),
            outcome: "blocked",
            correlationId: result.correlationId,
          });
          return;
        }
        setStatus("awaitingConfirmation");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("failed");
      }
    },
    [handler, audit, actorObjectId],
  );

  const confirm = useCallback(
    async (request: TRequest) => {
      const fallbackCorrelationId = preflight?.correlationId ?? "unknown";
      setStatus("queued");
      setError(null);
      try {
        const submitted = await handler.submit(request);
        audit({
          operationId: submitted.operationId,
          operationType: handler.type,
          actorObjectId,
          targetIds: handler.describeTargets(request),
          outcome: "attempted",
          correlationId: submitted.correlationId,
        });

        let current = await handler.poll(submitted.operationId);
        setProgress(current);
        setStatus(current.status === "queued" ? "queued" : "inProgress");

        while (
          !cancelled.current &&
          (current.status === "queued" || current.status === "inProgress")
        ) {
          await delay(pollIntervalMs);
          current = await handler.poll(submitted.operationId);
          setProgress(current);
          setStatus(current.status === "queued" ? "queued" : "inProgress");
        }

        if (cancelled.current) return;

        setStatus(current.status);
        audit({
          operationId: submitted.operationId,
          operationType: handler.type,
          actorObjectId,
          targetIds: handler.describeTargets(request),
          outcome:
            current.status === "succeeded"
              ? "succeeded"
              : current.status === "cancelled"
                ? "cancelled"
                : "failed",
          correlationId: submitted.correlationId,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("failed");
        audit({
          operationType: handler.type,
          actorObjectId,
          targetIds: handler.describeTargets(request),
          outcome: "failed",
          correlationId: fallbackCorrelationId,
        });
      }
    },
    [handler, preflight, audit, actorObjectId, pollIntervalMs],
  );

  return { status, preflight, progress, error, start, confirm, reset };
}
