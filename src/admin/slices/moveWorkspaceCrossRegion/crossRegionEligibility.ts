// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A slice: cross-region move eligibility. A workspace may only move
// across regions when EVERY item it contains supports cross-region movement.

import type { FabricItem } from "../../../types";

export interface ItemMoveSupport {
  itemType: string;
  supportsCrossRegion: boolean;
  notes?: string;
}

export interface CrossRegionEligibility {
  isEligible: boolean;
  supportedItems: { itemId: string; itemType: string }[];
  unsupportedItems: { itemId: string; itemType: string; reason: string }[];
}

/**
 * Default support matrix.
 * TODO(Branch A): replace these placeholder values with the maintained,
 * authoritative item-type cross-region mobility matrix.
 */
export const defaultItemMoveSupport: Record<string, ItemMoveSupport> = {
  Lakehouse: {
    itemType: "Lakehouse",
    supportsCrossRegion: false,
    notes: "Pending confirmation.",
  },
  Warehouse: {
    itemType: "Warehouse",
    supportsCrossRegion: false,
    notes: "Pending confirmation.",
  },
  Notebook: { itemType: "Notebook", supportsCrossRegion: true },
};

/**
 * Evaluates whether a workspace can move cross-region by checking each item
 * against the support matrix. A workspace with zero items is not eligible.
 */
export function evaluateCrossRegionEligibility(
  items: Pick<FabricItem, "id" | "type">[],
  matrix: Record<string, ItemMoveSupport> = defaultItemMoveSupport,
): CrossRegionEligibility {
  const supportedItems: CrossRegionEligibility["supportedItems"] = [];
  const unsupportedItems: CrossRegionEligibility["unsupportedItems"] = [];

  for (const item of items) {
    const support = matrix[item.type];
    if (support?.supportsCrossRegion) {
      supportedItems.push({ itemId: item.id, itemType: item.type });
    } else {
      unsupportedItems.push({
        itemId: item.id,
        itemType: item.type,
        reason: support?.notes ?? "Item type not supported for cross-region move.",
      });
    }
  }

  return {
    isEligible: items.length > 0 && unsupportedItems.length === 0,
    supportedItems,
    unsupportedItems,
  };
}
