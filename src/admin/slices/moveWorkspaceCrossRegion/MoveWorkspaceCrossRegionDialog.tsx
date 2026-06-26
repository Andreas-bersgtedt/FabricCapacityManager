// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A slice: move a workspace across regions — dialog scaffold. Surfaces
// per-item eligibility and keeps submit disabled while unsupported items exist.

import { useMemo, useState } from "react";
import type { TokenProvider } from "../../../api/fabricApi";
import type { FabricItem } from "../../../types";
import { ConfirmDialog } from "../../core/components/ConfirmDialog";
import { OperationStatusView } from "../../core/components/OperationStatusView";
import { PreflightPanel } from "../../core/components/PreflightPanel";
import { evaluateCrossRegionEligibility } from "./crossRegionEligibility";
import { useMoveWorkspaceCrossRegion } from "./useMoveWorkspaceCrossRegion";

interface CapacityOption {
  id: string;
  name: string;
}

interface MoveWorkspaceCrossRegionDialogProps {
  getToken: TokenProvider;
  workspaceId: string;
  workspaceName: string;
  sourceCapacityId: string;
  items: Pick<FabricItem, "id" | "type">[];
  /** Candidate destinations in a different region. */
  destinationOptions: CapacityOption[];
  onClose(): void;
}

export function MoveWorkspaceCrossRegionDialog({
  getToken,
  workspaceId,
  workspaceName,
  sourceCapacityId,
  items,
  destinationOptions,
  onClose,
}: MoveWorkspaceCrossRegionDialogProps) {
  const op = useMoveWorkspaceCrossRegion(getToken);
  const [destinationCapacityId, setDestinationCapacityId] = useState(
    destinationOptions[0]?.id ?? "",
  );

  const eligibility = useMemo(
    () => evaluateCrossRegionEligibility(items),
    [items],
  );

  const request = {
    workspaceId,
    workspaceName,
    sourceCapacityId,
    destinationCapacityId,
    items,
  };
  const awaitingConfirm = op.status === "awaitingConfirmation";
  const busy =
    op.status === "preflighting" ||
    op.status === "queued" ||
    op.status === "inProgress";
  const blocked = !eligibility.isEligible || !destinationCapacityId;

  return (
    <ConfirmDialog
      title={`Cross-region move: ${workspaceName}`}
      confirmLabel={awaitingConfirm ? "Move workspace" : "Validate"}
      busy={busy || blocked}
      onCancel={onClose}
      onConfirm={() =>
        awaitingConfirm ? op.confirm(request) : op.start(request)
      }
    >
      <label className="admin-field">
        Destination capacity (different region)
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

      {eligibility.unsupportedItems.length > 0 && (
        <div className="admin-message admin-message--error">
          <strong>Unsupported items block this move:</strong>
          <ul>
            {eligibility.unsupportedItems.map((it) => (
              <li key={it.itemId}>
                {it.itemType} — {it.reason}
              </li>
            ))}
          </ul>
        </div>
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
