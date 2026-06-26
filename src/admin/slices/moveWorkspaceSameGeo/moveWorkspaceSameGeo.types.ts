// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A slice: move a workspace to another capacity in the same geography —
// request shape.

export interface MoveWorkspaceSameGeoRequest {
  workspaceId: string;
  workspaceName: string;
  sourceCapacityId: string;
  destinationCapacityId: string;
}
