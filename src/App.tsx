// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Root application component. Handles the authentication state (sign in / out),
// triggers data loading, owns the client-side filter state and composes the
// filters panel, the grouped workspace tree and the Excel export action.

import { useMemo, useState } from "react";
import {
  AuthenticatedTemplate,
  UnauthenticatedTemplate,
  useMsal,
} from "@azure/msal-react";
import { isAuthConfigured, loginRequest } from "./authConfig";
import { useFabricData } from "./hooks/useFabricData";
import { FiltersPanel } from "./components/FiltersPanel";
import { WorkspaceTree } from "./components/WorkspaceTree";
import { exportWorkspacesToExcel } from "./export/exportExcel";
import type { EnrichedWorkspace, Filters } from "./types";

/** Default filter state: nothing selected means "show everything". */
const emptyFilters: Filters = {
  storageModes: new Set(),
  requiredItemTypes: new Set(),
  searchText: "",
};

/**
 * Returns the subset of `workspaces` that satisfy every active filter:
 * a case-insensitive name search, the selected storage modes (OR), and the
 * required item types (AND — a workspace must contain all selected types).
 */
function applyFilters(
  workspaces: EnrichedWorkspace[],
  filters: Filters,
): EnrichedWorkspace[] {
  const search = filters.searchText.trim().toLowerCase();
  return workspaces.filter((ws) => {
    if (search && !ws.displayName.toLowerCase().includes(search)) {
      return false;
    }
    if (
      filters.storageModes.size > 0 &&
      !filters.storageModes.has(ws.storageMode)
    ) {
      return false;
    }
    if (filters.requiredItemTypes.size > 0) {
      for (const required of filters.requiredItemTypes) {
        if (!ws.itemTypes.includes(required)) return false;
      }
    }
    return true;
  });
}

export default function App() {
  const { instance, accounts } = useMsal();
  const { data, loading, error, progress, load } = useFabricData();
  const [filters, setFilters] = useState<Filters>(emptyFilters);

  // Recompute the visible workspaces only when the data or filters change.
  const filtered = useMemo(
    () => (data ? applyFilters(data.workspaces, filters) : []),
    [data, filters],
  );

  /** Starts the interactive OAuth sign-in (MSAL popup / web dialog). */
  const signIn = () => {
    instance.loginPopup(loginRequest).catch((e) => console.error(e));
  };
  /** Signs the current user out via a popup. */
  const signOut = () => {
    instance.logoutPopup().catch((e) => console.error(e));
  };

  if (!isAuthConfigured) {
    return (
      <div className="setup-message">
        <h1>Fabric Capacity Manager</h1>
        <p>
          Authentication is not configured. Copy <code>.env.example</code> to{" "}
          <code>.env</code>, set <code>VITE_AAD_CLIENT_ID</code> and{" "}
          <code>VITE_AAD_TENANT_ID</code>, then restart the dev server.
        </p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Fabric Capacity Manager</h1>
          <p className="muted">
            Workspaces grouped by Region › Capacity SKU › Capacity Name
          </p>
        </div>
        <div className="header-actions">
          <AuthenticatedTemplate>
            <span className="muted">{accounts[0]?.username}</span>
            <button onClick={load} disabled={loading}>
              {loading ? "Loading…" : data ? "Refresh" : "Load workspaces"}
            </button>
            {data && (
              <button
                className="secondary"
                onClick={() => exportWorkspacesToExcel(data.workspaces)}
              >
                Export to Excel
              </button>
            )}
            <button className="secondary" onClick={signOut}>
              Sign out
            </button>
          </AuthenticatedTemplate>
          <UnauthenticatedTemplate>
            <button onClick={signIn}>Sign in</button>
          </UnauthenticatedTemplate>
        </div>
      </header>

      <UnauthenticatedTemplate>
        <div className="setup-message">
          <p>
            Sign in with your Microsoft Fabric account to list the workspaces
            you have access to.
          </p>
        </div>
      </UnauthenticatedTemplate>

      <AuthenticatedTemplate>
        {error && <div className="error">{error}</div>}

        {loading && progress && (
          <div className="progress">
            {progress.phase}… {progress.done}/{progress.total}
          </div>
        )}

        {!data && !loading && (
          <div className="setup-message">
            <p>Click “Load workspaces” to fetch data from your tenant.</p>
          </div>
        )}

        {data && (
          <div className="content">
            <FiltersPanel
              filters={filters}
              allItemTypes={data.allItemTypes}
              onChange={setFilters}
              resultCount={filtered.length}
              totalCount={data.workspaces.length}
            />
            <main className="results">
              <WorkspaceTree workspaces={filtered} />
            </main>
          </div>
        )}
      </AuthenticatedTemplate>
    </div>
  );
}
