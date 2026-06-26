// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A slice: move a workspace across regions — request shape.

import type { FabricItem } from "../../../types";

export interface MoveWorkspaceCrossRegionRequest {
  workspaceId: string;
  workspaceName: string;
  sourceCapacityId: string;
  destinationCapacityId: string;
  /** All items in the workspace; used to evaluate cross-region eligibility. */
  items: Pick<FabricItem, "id" | "type">[];
}
