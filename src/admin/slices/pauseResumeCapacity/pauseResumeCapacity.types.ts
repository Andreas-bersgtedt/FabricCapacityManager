// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A slice: pause/resume a capacity — request shape.

export type CapacityLifecycleAction = "pause" | "resume";

export interface PauseResumeCapacityRequest {
  capacityId: string;
  capacityName: string;
  action: CapacityLifecycleAction;
  /** Current capacity state, used to validate eligibility (Active/Paused/...). */
  currentState?: string;
}
