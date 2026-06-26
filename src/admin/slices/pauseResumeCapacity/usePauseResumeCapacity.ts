// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A slice: pause/resume a capacity — React hook.

import { useMemo } from "react";
import type { TokenProvider } from "../../../api/fabricApi";
import { useAdminOperation } from "../../core/useAdminOperation";
import { createPauseResumeHandler } from "./pauseResumeCapacity.api";
import type {
  CapacityLifecycleAction,
  PauseResumeCapacityRequest,
} from "./pauseResumeCapacity.types";

export function usePauseResumeCapacity(
  getToken: TokenProvider,
  action: CapacityLifecycleAction,
) {
  const handler = useMemo(
    () => createPauseResumeHandler(getToken, action),
    [getToken, action],
  );
  return useAdminOperation<PauseResumeCapacityRequest>(handler);
}
