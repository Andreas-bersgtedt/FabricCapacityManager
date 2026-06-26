// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A slice: pause/resume a capacity — dialog scaffold.

import { useEffect, useRef } from "react";
import type { TokenProvider } from "../../../api/fabricApi";
import { ConfirmDialog } from "../../core/components/ConfirmDialog";
import { OperationStatusView } from "../../core/components/OperationStatusView";
import { PreflightPanel } from "../../core/components/PreflightPanel";
import { usePauseResumeCapacity } from "./usePauseResumeCapacity";
import type { CapacityLifecycleAction } from "./pauseResumeCapacity.types";

interface PauseResumeCapacityDialogProps {
  getToken: TokenProvider;
  capacityId: string;
  capacityName: string;
  action: CapacityLifecycleAction;
  currentState?: string;
  onClose(): void;
  /** Fired once when the pause/resume operation completes successfully. */
  onCompleted?(): void;
}

export function PauseResumeCapacityDialog({
  getToken,
  capacityId,
  capacityName,
  action,
  currentState,
  onClose,
  onCompleted,
}: PauseResumeCapacityDialogProps) {
  const op = usePauseResumeCapacity(getToken, action);
  const completedRef = useRef(false);

  useEffect(() => {
    if (op.status === "succeeded" && !completedRef.current) {
      completedRef.current = true;
      onCompleted?.();
    }
  }, [op.status, onCompleted]);

  const request = { capacityId, capacityName, action, currentState };
  const awaitingConfirm = op.status === "awaitingConfirmation";
  const busy =
    op.status === "preflighting" ||
    op.status === "queued" ||
    op.status === "inProgress";
  const verb = action === "pause" ? "Pause" : "Resume";

  return (
    <ConfirmDialog
      title={`${verb} capacity: ${capacityName}`}
      confirmLabel={awaitingConfirm ? verb : "Validate"}
      busy={busy}
      onCancel={onClose}
      onConfirm={() =>
        awaitingConfirm ? op.confirm(request) : op.start(request)
      }
    >
      {action === "pause" ? (
        <p className="admin-message admin-message--warning">
          Pausing stops compute for all workloads on this capacity.
        </p>
      ) : (
        <p className="muted">Resuming restores compute for this capacity.</p>
      )}
      <PreflightPanel preflight={op.preflight} />
      <OperationStatusView
        status={op.status}
        progress={op.progress}
        error={op.error}
      />
    </ConfirmDialog>
  );
}
