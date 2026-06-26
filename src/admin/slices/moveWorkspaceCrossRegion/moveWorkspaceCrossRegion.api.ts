// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A slice: move a workspace across regions — operation handler. Blocks
// submit unless every item passes the cross-region support check.

import type { TokenProvider } from "../../../api/fabricApi";
import {
  newCorrelationId,
  simulatePoll,
  simulateSubmit,
} from "../../core/adminClient";
import { adminLiveWrites } from "../../core/featureFlags";
import { pollLiveOperation, submitWorkspaceMove } from "../../core/liveClient";
import type { AdminOperationHandler } from "../../core/adminTypes";
import { evaluateCrossRegionEligibility } from "./crossRegionEligibility";
import type { MoveWorkspaceCrossRegionRequest } from "./moveWorkspaceCrossRegion.types";

export function createMoveWorkspaceCrossRegionHandler(
  getToken: TokenProvider,
): AdminOperationHandler<MoveWorkspaceCrossRegionRequest> {
  return {
    type: "workspace.move.crossRegion",
    describeTargets: (req) => ({
      workspaceId: req.workspaceId,
      sourceCapacityId: req.sourceCapacityId,
      destinationCapacityId: req.destinationCapacityId,
    }),
    preflight: async (req) => {
      const correlationId = newCorrelationId();
      const eligibility = evaluateCrossRegionEligibility(req.items);
      if (!eligibility.isEligible) {
        return {
          operationType: "workspace.move.crossRegion",
          isAllowed: false,
          requiresConfirmation: false,
          impactSummary: [],
          correlationId,
          messages: eligibility.unsupportedItems.map((it) => ({
            code: "CROSS_REGION_ITEM_UNSUPPORTED",
            severity: "error" as const,
            message: `${it.itemType} cannot move cross-region: ${it.reason}`,
            target: it.itemId,
          })),
        };
      }
      // Every item supports cross-region movement. The real management-plane
      // call would additionally check downtime windows and destination capacity.
      // TODO(Branch A): server-side cross-region preflight (downtime, capacity).
      return {
        operationType: "workspace.move.crossRegion",
        isAllowed: true,
        requiresConfirmation: true,
        confirmationText: `Move "${req.workspaceName}" to a capacity in a different geography?`,
        impactSummary: [
          "All items will be relocated to the destination region.",
          "Cross-region moves can incur extended downtime and data transfer.",
        ],
        correlationId,
        messages: [],
      };
    },
    // Cross-region reassignment uses the same Fabric assignToCapacity API; the
    // service performs the cross-region relocation when items support it. When
    // live writes are disabled the operation runs against a simulation.
    submit: (req) =>
      adminLiveWrites
        ? submitWorkspaceMove(getToken, {
            workspaceId: req.workspaceId,
            destinationCapacityId: req.destinationCapacityId,
            crossRegion: true,
          })
        : simulateSubmit(getToken, "workspace.move.crossRegion"),
    poll: (operationId) =>
      adminLiveWrites
        ? pollLiveOperation(operationId)
        : simulatePoll(operationId),
  };
}
