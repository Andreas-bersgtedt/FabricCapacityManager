// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A - Admin Mode: compact status line for an in-flight/finished
// operation, including the final timestamp and any error.

import type { AdminOperationProgress, OperationStatus } from "../adminTypes";

interface OperationStatusViewProps {
  status: OperationStatus;
  progress: AdminOperationProgress | null;
  error: string | null;
}

export function OperationStatusView({
  status,
  progress,
  error,
}: OperationStatusViewProps) {
  if (status === "idle") return null;

  return (
    <div className={`admin-status admin-status--${status}`}>
      <span className="admin-status__label">{status}</span>
      {progress?.completedAtUtc && (
        <span className="muted"> · {progress.completedAtUtc}</span>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
