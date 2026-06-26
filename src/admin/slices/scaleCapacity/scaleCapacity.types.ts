// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A slice: scale a capacity up or down — request shape.

export interface ScaleCapacityRequest {
  capacityId: string;
  capacityName: string;
  fromSku: string;
  toSku: string;
}
