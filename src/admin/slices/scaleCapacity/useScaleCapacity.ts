// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A slice: scale a capacity up or down — React hook.

import { useMemo } from "react";
import type { TokenProvider } from "../../../api/fabricApi";
import { useAdminOperation } from "../../core/useAdminOperation";
import { createScaleCapacityHandler } from "./scaleCapacity.api";
import type { ScaleCapacityRequest } from "./scaleCapacity.types";

export function useScaleCapacity(getToken: TokenProvider) {
  const handler = useMemo(
    () => createScaleCapacityHandler(getToken),
    [getToken],
  );
  return useAdminOperation<ScaleCapacityRequest>(handler);
}
