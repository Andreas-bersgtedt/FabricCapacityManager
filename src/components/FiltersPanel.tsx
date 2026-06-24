// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Sidebar filter controls: workspace name search, storage-mode checkboxes and
// item-type checkboxes. The component is fully controlled — it renders the
// current `filters` and reports every change through `onChange`.

import type { Filters, StorageMode } from "../types";

/** The storage-mode options shown as checkboxes, with their display labels. */
const STORAGE_MODES: { value: StorageMode; label: string }[] = [
  { value: "Large", label: "Large dataset" },
  { value: "Small", label: "Small dataset" },
  { value: "None", label: "No semantic model" },
];

interface Props {
  /** The current filter state. */
  filters: Filters;
  /** All item types discovered across the loaded workspaces. */
  allItemTypes: string[];
  /** Called with the next filter state whenever a control changes. */
  onChange: (next: Filters) => void;
  /** Number of workspaces matching the current filters. */
  resultCount: number;
  /** Total number of loaded workspaces. */
  totalCount: number;
}

/** Returns a new Set with `value` toggled in or out of `set` (immutable). */
function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** Renders the filter sidebar. */
export function FiltersPanel({
  filters,
  allItemTypes,
  onChange,
  resultCount,
  totalCount,
}: Props) {
  return (
    <aside className="filters">
      <h2>Filters</h2>
      <p className="muted">
        Showing {resultCount} of {totalCount} workspaces
      </p>

      <div className="filter-group">
        <label className="filter-label" htmlFor="search">
          Search workspace
        </label>
        <input
          id="search"
          type="search"
          placeholder="Name contains…"
          value={filters.searchText}
          onChange={(e) =>
            onChange({ ...filters, searchText: e.target.value })
          }
        />
      </div>

      <div className="filter-group">
        <span className="filter-label">Storage mode</span>
        {STORAGE_MODES.map((m) => (
          <label key={m.value} className="checkbox">
            <input
              type="checkbox"
              checked={filters.storageModes.has(m.value)}
              onChange={() =>
                onChange({
                  ...filters,
                  storageModes: toggle(filters.storageModes, m.value),
                })
              }
            />
            {m.label}
          </label>
        ))}
      </div>

      <div className="filter-group">
        <span className="filter-label">
          Contains item types
          {filters.requiredItemTypes.size > 0 && (
            <button
              className="link"
              onClick={() =>
                onChange({ ...filters, requiredItemTypes: new Set() })
              }
            >
              clear
            </button>
          )}
        </span>
        <div className="item-type-list">
          {allItemTypes.length === 0 && (
            <span className="muted">No items loaded</span>
          )}
          {allItemTypes.map((t) => (
            <label key={t} className="checkbox">
              <input
                type="checkbox"
                checked={filters.requiredItemTypes.has(t)}
                onChange={() =>
                  onChange({
                    ...filters,
                    requiredItemTypes: toggle(filters.requiredItemTypes, t),
                  })
                }
              />
              {t}
            </label>
          ))}
        </div>
      </div>
    </aside>
  );
}
