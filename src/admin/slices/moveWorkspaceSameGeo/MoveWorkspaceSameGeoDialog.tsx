// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A slice: move a workspace within the same geography — dialog scaffold.

import { useState } from "react";
import type { TokenProvider } from "../../../api/fabricApi";
import { ConfirmDialog } from "../../core/components/ConfirmDialog";
import { OperationStatusView } from "../../core/components/OperationStatusView";
import { PreflightPanel } from "../../core/components/PreflightPanel";
import { useMoveWorkspaceSameGeo } from "./useMoveWorkspaceSameGeo";

interface CapacityOption {
  id: string;
  name: string;
}

interface MoveWorkspaceSameGeoDialogProps {
  getToken: TokenProvider;
  workspaceId: string;
  workspaceName: string;
  sourceCapacityId: string;
  /** Candidate destinations, already filtered to the same geography. */
  destinationOptions: CapacityOption[];
  onClose(): void;
}

export function MoveWorkspaceSameGeoDialog({
  getToken,
  workspaceId,
  workspaceName,
  sourceCapacityId,
  destinationOptions,
  onClose,
}: MoveWorkspaceSameGeoDialogProps) {
  const op = useMoveWorkspaceSameGeo(getToken);
  const [destinationCapacityId, setDestinationCapacityId] = useState(
    destinationOptions[0]?.id ?? "",
  );

  const request = {
    workspaceId,
    workspaceName,
    sourceCapacityId,
    destinationCapacityId,
  };
  const awaitingConfirm = op.status === "awaitingConfirmation";
  const busy =
    op.status === "preflighting" ||
    op.status === "queued" ||
    op.status === "inProgress";

  return (
    <ConfirmDialog
      title={`Move workspace: ${workspaceName}`}
      confirmLabel={awaitingConfirm ? "Move workspace" : "Validate"}
      busy={busy || !destinationCapacityId}
      onCancel={onClose}
      onConfirm={() =>
        awaitingConfirm ? op.confirm(request) : op.start(request)
      }
    >
      <label className="admin-field">
        Destination capacity (same geography)
        <select
          value={destinationCapacityId}
          onChange={(e) => setDestinationCapacityId(e.target.value)}
        >
          {destinationOptions.length === 0 && (
            <option value="">No eligible destinations</option>
          )}
          {destinationOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
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
