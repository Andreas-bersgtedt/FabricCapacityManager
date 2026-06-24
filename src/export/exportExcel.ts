// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Client-side Excel export. Flattens enriched workspaces into a single sheet
// and triggers a browser download using SheetJS — no server round-trip.

import * as XLSX from "xlsx";
import type { EnrichedWorkspace } from "../types";

/** Builds and downloads an .xlsx file of the provided workspaces. */
export function exportWorkspacesToExcel(
  workspaces: EnrichedWorkspace[],
  fileName = "fabric-workspaces.xlsx",
): void {
  const rows = [...workspaces]
    .sort(
      (a, b) =>
        a.region.localeCompare(b.region) ||
        a.sku.localeCompare(b.sku) ||
        a.capacityName.localeCompare(b.capacityName) ||
        a.displayName.localeCompare(b.displayName),
    )
    .map((ws) => ({
      Region: ws.region,
      "Capacity SKU": ws.sku,
      "Capacity Name": ws.capacityName,
      Workspace: ws.displayName,
      "Workspace Type": ws.type,
      "Storage Mode": ws.storageMode,
      "Item Count": ws.itemCount,
      "Item Types": ws.itemTypes.join(", "),
      "Workspace Id": ws.id,
      "Capacity Id": ws.capacityId ?? "",
      "Workspace URL": `https://app.fabric.microsoft.com/groups/${ws.id}/list`,
    }));

  const worksheet = XLSX.utils.json_to_sheet(rows);

  // Auto-size columns based on the widest cell in each column.
  const headers = Object.keys(rows[0] ?? { Region: "" });
  worksheet["!cols"] = headers.map((header) => {
    const maxLen = rows.reduce((max, row) => {
      const value = String((row as Record<string, unknown>)[header] ?? "");
      return Math.max(max, value.length);
    }, header.length);
    return { wch: Math.min(maxLen + 2, 80) };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Workspaces");
  XLSX.writeFile(workbook, fileName);
}
