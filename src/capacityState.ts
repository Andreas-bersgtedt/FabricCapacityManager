// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Shared capacity run-state helpers. Fabric's /v1/capacities reports state as
// Active / Inactive, while Azure Resource Manager uses Running / Paused /
// Suspended. These helpers normalise both and decide whether a capacity is
// currently accruing compute cost (only a running capacity is billable).

export type CapacityRunState = "Running" | "Paused" | "Other";

/** Maps the raw Fabric/ARM capacity state to a normalised run state. */
export function normalizeCapacityState(
  state: string | undefined,
): CapacityRunState {
  const s = (state ?? "").toLowerCase();
  if (s === "active" || s === "running") return "Running";
  if (s === "paused" || s === "suspended" || s === "inactive") return "Paused";
  return "Other";
}

/**
 * A capacity only accrues compute cost while it is running. Paused/suspended
 * capacities (and any non-running state) are excluded from the cost rate.
 */
export function isCapacityBillable(state: string | undefined): boolean {
  return normalizeCapacityState(state) === "Running";
}
