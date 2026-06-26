// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A slice: scale a capacity up or down — operation handler.

import type { TokenProvider } from "../../../api/fabricApi";
import {
  newCorrelationId,
  simulatePoll,
  simulateSubmit,
} from "../../core/adminClient";
import { adminLiveWrites } from "../../core/featureFlags";
import { pollLiveOperation, submitScaleCapacity } from "../../core/liveClient";
import type {
  AdminOperationHandler,
  ValidationMessage,
} from "../../core/adminTypes";
import type { ScaleCapacityRequest } from "./scaleCapacity.types";

/** Standard Microsoft Fabric F-SKU ladder, smallest to largest. */
export const fabricSkuLadder = [
  "F2",
  "F4",
  "F8",
  "F16",
  "F32",
  "F64",
  "F128",
  "F256",
  "F512",
  "F1024",
  "F2048",
] as const;

function skuRank(sku: string): number {
  return (fabricSkuLadder as readonly string[]).indexOf(sku);
}

export function createScaleCapacityHandler(
  getToken: TokenProvider,
): AdminOperationHandler<ScaleCapacityRequest> {
  return {
    type: "capacity.scale",
    describeTargets: (req) => ({
      capacityId: req.capacityId,
      fromSku: req.fromSku,
      toSku: req.toSku,
    }),
    preflight: async (req) => {
      const correlationId = newCorrelationId();
      const fromRank = skuRank(req.fromSku);
      const toRank = skuRank(req.toSku);
      const messages: ValidationMessage[] = [];

      if (toRank < 0) {
        messages.push({
          code: "SKU_TRANSITION_INVALID",
          severity: "error",
          message: `Unknown target SKU "${req.toSku}".`,
        });
      }
      if (req.toSku === req.fromSku) {
        messages.push({
          code: "SKU_TRANSITION_INVALID",
          severity: "error",
          message: "Target SKU must differ from the current SKU.",
        });
      }

      const isAllowed = messages.length === 0;
      const direction = toRank > fromRank ? "up" : "down";
      const impactSummary = isAllowed
        ? [
            `Scale ${direction} from ${req.fromSku} to ${req.toSku}.`,
            direction === "down"
              ? "Scaling down reduces compute and may throttle active workloads."
              : "Scaling up increases compute capacity and cost.",
          ]
        : [];
      if (isAllowed && direction === "down") {
        messages.push({
          code: "SCALE_DOWN_WARNING",
          severity: "warning",
          message: "Verify current utilization before scaling down.",
        });
      }

      return {
        operationType: "capacity.scale",
        isAllowed,
        requiresConfirmation: isAllowed,
        confirmationText: isAllowed
          ? `Apply ${req.fromSku} \u2192 ${req.toSku}?`
          : undefined,
        impactSummary,
        messages,
        correlationId,
      };
    },
    // Capacity scale is an Azure Resource Manager SKU update. When live writes
    // are disabled the operation runs against a local simulation instead.
    submit: (req) =>
      adminLiveWrites
        ? submitScaleCapacity(getToken, {
            capacityName: req.capacityName,
            toSku: req.toSku,
          })
        : simulateSubmit(getToken, "capacity.scale"),
    poll: (operationId) =>
      adminLiveWrites
        ? pollLiveOperation(operationId)
        : simulatePoll(operationId),
  };
}
