// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A slice: move a workspace across regions — React hook.

import { useMemo } from "react";
import type { TokenProvider } from "../../../api/fabricApi";
import { useAdminOperation } from "../../core/useAdminOperation";
import { createMoveWorkspaceCrossRegionHandler } from "./moveWorkspaceCrossRegion.api";
import type { MoveWorkspaceCrossRegionRequest } from "./moveWorkspaceCrossRegion.types";

export function useMoveWorkspaceCrossRegion(getToken: TokenProvider) {
  const handler = useMemo(
    () => createMoveWorkspaceCrossRegionHandler(getToken),
    [getToken],
  );
  return useAdminOperation<MoveWorkspaceCrossRegionRequest>(handler);
}
