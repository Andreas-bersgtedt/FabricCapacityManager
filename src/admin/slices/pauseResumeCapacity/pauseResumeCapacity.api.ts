// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A slice: pause/resume a capacity — operation handler.

import type { TokenProvider } from "../../../api/fabricApi";
import {
  newCorrelationId,
  simulatePoll,
  simulateSubmit,
} from "../../core/adminClient";
import { adminLiveWrites } from "../../core/featureFlags";
import { pollLiveOperation, submitPauseResume } from "../../core/liveClient";
import type {
  AdminOperationHandler,
  ValidationMessage,
} from "../../core/adminTypes";
import type {
  CapacityLifecycleAction,
  PauseResumeCapacityRequest,
} from "./pauseResumeCapacity.types";

export function createPauseResumeHandler(
  getToken: TokenProvider,
  action: CapacityLifecycleAction,
): AdminOperationHandler<PauseResumeCapacityRequest> {
  const type =
    action === "pause" ? "capacity.pause" : ("capacity.resume" as const);

  return {
    type,
    describeTargets: (req) => ({ capacityId: req.capacityId }),
    preflight: async (req) => {
      const correlationId = newCorrelationId();
      const state = (req.currentState ?? "").toLowerCase();
      // Fabric reports Inactive for a stopped capacity; ARM uses Paused/Suspended.
      const isPaused =
        state === "paused" || state === "suspended" || state === "inactive";
      const isRunning = state === "active" || state === "running";
      const messages: ValidationMessage[] = [];

      if (action === "pause" && isPaused) {
        messages.push({
          code: "CAPACITY_STATE_INVALID",
          severity: "error",
          message: "Capacity is already paused.",
        });
      }
      if (action === "resume" && isRunning) {
        messages.push({
          code: "CAPACITY_STATE_INVALID",
          severity: "error",
          message: "Capacity is already running.",
        });
      }

      const isAllowed = messages.length === 0;
      const impactSummary = isAllowed
        ? action === "pause"
          ? [
              "Pausing stops compute for all workloads on this capacity.",
              "Reports and jobs are unavailable until the capacity is resumed.",
            ]
          : [
              "Resuming restores compute for this capacity.",
              "Compute billing resumes once the capacity is active.",
            ]
        : [];
      if (isAllowed && action === "pause") {
        messages.push({
          code: "PAUSE_IMPACT_WARNING",
          severity: "warning",
          message: "Confirm no critical workloads are running before pausing.",
        });
      }

      return {
        operationType: type,
        isAllowed,
        requiresConfirmation: isAllowed,
        confirmationText: isAllowed
          ? `${action === "pause" ? "Pause" : "Resume"} ${req.capacityName}?`
          : undefined,
        impactSummary,
        messages,
        correlationId,
      };
    },
    // Capacity pause/resume are Azure Resource Manager suspend/resume actions.
    // When live writes are disabled the operation runs against a simulation.
    submit: (req) =>
      adminLiveWrites
        ? submitPauseResume(getToken, {
            capacityName: req.capacityName,
            action,
          })
        : simulateSubmit(getToken, type),
    poll: (operationId) =>
      adminLiveWrites
        ? pollLiveOperation(operationId)
        : simulatePoll(operationId),
  };
}
