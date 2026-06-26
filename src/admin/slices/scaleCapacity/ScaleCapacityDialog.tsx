// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A slice: scale a capacity up or down — dialog scaffold.

import { useEffect, useRef, useState } from "react";
import type { TokenProvider } from "../../../api/fabricApi";
import { ConfirmDialog } from "../../core/components/ConfirmDialog";
import { OperationStatusView } from "../../core/components/OperationStatusView";
import { PreflightPanel } from "../../core/components/PreflightPanel";
import { useScaleCapacity } from "./useScaleCapacity";

interface ScaleCapacityDialogProps {
  getToken: TokenProvider;
  capacityId: string;
  capacityName: string;
  currentSku: string;
  skuOptions: string[];
  onClose(): void;
  /** Fired once when the scale operation completes successfully. */
  onCompleted?(): void;
}

export function ScaleCapacityDialog({
  getToken,
  capacityId,
  capacityName,
  currentSku,
  skuOptions,
  onClose,
  onCompleted,
}: ScaleCapacityDialogProps) {
  const op = useScaleCapacity(getToken);
  const [toSku, setToSku] = useState(currentSku);
  const completedRef = useRef(false);

  useEffect(() => {
    if (op.status === "succeeded" && !completedRef.current) {
      completedRef.current = true;
      onCompleted?.();
    }
  }, [op.status, onCompleted]);

  const request = { capacityId, capacityName, fromSku: currentSku, toSku };
  const awaitingConfirm = op.status === "awaitingConfirmation";
  const busy =
    op.status === "preflighting" ||
    op.status === "queued" ||
    op.status === "inProgress";

  return (
    <ConfirmDialog
      title={`Scale capacity: ${capacityName}`}
      confirmLabel={awaitingConfirm ? "Apply scale" : "Validate"}
      busy={busy}
      onCancel={onClose}
      onConfirm={() =>
        awaitingConfirm ? op.confirm(request) : op.start(request)
      }
    >
      <p className="muted">Current SKU: {currentSku}</p>
      <label className="admin-field">
        Target SKU
        <select value={toSku} onChange={(e) => setToSku(e.target.value)}>
          {skuOptions.map((sku) => (
            <option key={sku} value={sku}>
              {sku}
            </option>
          ))}
        </select>
      </label>
      <PreflightPanel preflight={op.preflight} />
      <OperationStatusView
        status={op.status}
        progress={op.progress}
        error={op.error}
      />
    </ConfirmDialog>
  );
}
