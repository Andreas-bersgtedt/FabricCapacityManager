// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A slice: move a workspace within the same geography — React hook.

import { useMemo } from "react";
import type { TokenProvider } from "../../../api/fabricApi";
import { useAdminOperation } from "../../core/useAdminOperation";
import { createMoveWorkspaceSameGeoHandler } from "./moveWorkspaceSameGeo.api";
import type { MoveWorkspaceSameGeoRequest } from "./moveWorkspaceSameGeo.types";

export function useMoveWorkspaceSameGeo(getToken: TokenProvider) {
  const handler = useMemo(
    () => createMoveWorkspaceSameGeoHandler(getToken),
    [getToken],
  );
  return useAdminOperation<MoveWorkspaceSameGeoRequest>(handler);
}
