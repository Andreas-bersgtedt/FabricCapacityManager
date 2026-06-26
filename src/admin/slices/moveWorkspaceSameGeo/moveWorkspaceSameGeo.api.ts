// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A slice: move a workspace within the same geography — operation handler.

import type { TokenProvider } from "../../../api/fabricApi";
import {
  newCorrelationId,
  simulatePoll,
  simulateSubmit,
} from "../../core/adminClient";
import { adminLiveWrites } from "../../core/featureFlags";
import { pollLiveOperation, submitWorkspaceMove } from "../../core/liveClient";
import type { AdminOperationHandler } from "../../core/adminTypes";
import type { MoveWorkspaceSameGeoRequest } from "./moveWorkspaceSameGeo.types";

export function createMoveWorkspaceSameGeoHandler(
  getToken: TokenProvider,
): AdminOperationHandler<MoveWorkspaceSameGeoRequest> {
  return {
    type: "workspace.move.sameGeo",
    describeTargets: (req) => ({
      workspaceId: req.workspaceId,
      sourceCapacityId: req.sourceCapacityId,
      destinationCapacityId: req.destinationCapacityId,
    }),
    preflight: async (req) => {
      const correlationId = newCorrelationId();
      if (req.destinationCapacityId === req.sourceCapacityId) {
        return {
          operationType: "workspace.move.sameGeo",
          isAllowed: false,
          requiresConfirmation: false,
          impactSummary: [],
          correlationId,
          messages: [
            {
              code: "DESTINATION_UNAVAILABLE",
              severity: "error",
              message: "Destination capacity must differ from the source.",
            },
          ],
        };
      }
      // The destination list is already filtered to the source geography, so a
      // same-geography move is always allowed here. The real management-plane
      // call would additionally verify destination health and caller rights.
      // TODO(Branch A): verify destination capacity health and RBAC.
      return {
        operationType: "workspace.move.sameGeo",
        isAllowed: true,
        requiresConfirmation: true,
        confirmationText: `Move "${req.workspaceName}" to the selected capacity in the same geography?`,
        impactSummary: [
          "The workspace will be reassigned to the destination capacity.",
          "Running operations may be briefly interrupted during reassignment.",
        ],
        correlationId,
        messages: [],
      };
    },
    // Workspace reassignment uses the Fabric assignToCapacity REST API. When
    // live writes are disabled the operation runs against a simulation.
    submit: (req) =>
      adminLiveWrites
        ? submitWorkspaceMove(getToken, {
            workspaceId: req.workspaceId,
            destinationCapacityId: req.destinationCapacityId,
            crossRegion: false,
          })
        : simulateSubmit(getToken, "workspace.move.sameGeo"),
    poll: (operationId) =>
      adminLiveWrites
        ? pollLiveOperation(operationId)
        : simulatePoll(operationId),
  };
}
