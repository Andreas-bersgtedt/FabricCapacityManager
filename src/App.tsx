// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Root application component. Owns the authentication state (sign in / out),
// the active menu tab (Detail / Configuration), the display currency and the
// client-side filter state, and composes the filters panel, the grouped
// workspace tree, the Excel export action and the configuration panel.

import { useMemo, useState } from "react";
import {
  AuthenticatedTemplate,
  UnauthenticatedTemplate,
  useMsal,
} from "@azure/msal-react";
import { isAuthConfigured, loginRequest } from "./authConfig";
import { useFabricData } from "./hooks/useFabricData";
import { useTokenProvider } from "./hooks/useTokenProvider";
import { FiltersPanel } from "./components/FiltersPanel";
import { WorkspaceTree } from "./components/WorkspaceTree";
import { DashboardTab } from "./components/DashboardTab";
import { exportWorkspacesToExcel } from "./export/exportExcel";
import { AdminModeProvider, adminLiveWrites, useAdminMode } from "./admin";
import {
  AccessTestProvider,
  AccessTestPanel,
  AccessTestSummary,
} from "./access";
import { ConfigProvider, useConfig } from "./config/ConfigContext";
import { StorageProvider, useStorage } from "./storage/StorageContext";
import type { DaxRow } from "./storage/metricsApi";
import { useCapacityPricing } from "./pricing/useCapacityPricing";
import { SUPPORTED_CURRENCIES } from "./pricing/azureRetailPrices";
import type { EnrichedWorkspace, Filters, WorkspaceStorageUsage } from "./types";

/** Default filter state: nothing selected means "show everything". */
const emptyFilters: Filters = {
  storageModes: new Set(),
  requiredItemTypes: new Set(),
  searchText: "",
};

type Tab = "dashboard" | "detail" | "configuration";

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
  if (!isAuthConfigured) {
    return (
      <div className="app">
        <div className="setup-message">
          <h1>Fabric Capacity Manager</h1>
          <p>
            Authentication is not configured. Copy <code>.env.example</code> to{" "}
            <code>.env</code>, set <code>VITE_AAD_CLIENT_ID</code> and{" "}
            <code>VITE_AAD_TENANT_ID</code>, then restart the dev server.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ConfigProvider>
      <StorageProvider>
        <AccessTestProvider>
          <AppShell />
        </AccessTestProvider>
      </StorageProvider>
    </ConfigProvider>
  );
}

function AppShell() {
  const { accounts } = useMsal();
  const { data, loading, error, progress, load, refreshCapacity } =
    useFabricData();
  const getToken = useTokenProvider();
  const { currency } = useConfig();
  const storage = useStorage();
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [tab, setTab] = useState<Tab>("detail");

  const pricing = useCapacityPricing(data?.workspaces, currency);

  // Recompute the visible workspaces only when the data or filters change.
  const filtered = useMemo(
    () => (data ? applyFilters(data.workspaces, filters) : []),
    [data, filters],
  );

  // Admin actions are gated on a real role check: the user must be an Admin of
  // at least one loaded workspace (resolved from its role assignments).
  const canManage = useMemo(
    () => Boolean(data?.workspaces.some((w) => w.userRole === "Admin")),
    [data],
  );

  return (
    <AdminModeProvider canManage={canManage}>
      <div className="app">
        <header className="app-header">
          <div>
            <h1>Fabric Capacity Manager</h1>
            <p className="muted">
              Workspaces grouped by Region › Capacity SKU › Capacity Name
            </p>
          </div>
          <AuthenticatedTemplate>
            <div className="header-account">
              <AccessTestSummary onView={() => setTab("configuration")} />
              <span className="muted">{accounts[0]?.username}</span>
            </div>
          </AuthenticatedTemplate>
        </header>

        <nav className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "dashboard"}
            className={`tab${tab === "dashboard" ? " active" : ""}`}
            onClick={() => setTab("dashboard")}
          >
            Dashboard
          </button>
          <button
            role="tab"
            aria-selected={tab === "detail"}
            className={`tab${tab === "detail" ? " active" : ""}`}
            onClick={() => setTab("detail")}
          >
            Detail
          </button>
          <button
            role="tab"
            aria-selected={tab === "configuration"}
            className={`tab${tab === "configuration" ? " active" : ""}`}
            onClick={() => setTab("configuration")}
          >
            Configuration
          </button>
        </nav>

        {tab === "dashboard" ? (
          <DashboardTabView
            data={data}
            loading={loading}
            pricing={pricing}
            storage={storage.enabled ? storage.byWorkspace : undefined}
            onLoad={load}
            onGoToConfiguration={() => setTab("configuration")}
          />
        ) : tab === "detail" ? (
          <DetailTab
            data={data}
            loading={loading}
            error={error}
            progress={progress}
            filtered={filtered}
            filters={filters}
            onFiltersChange={setFilters}
            onLoad={load}
            getToken={getToken}
            onCapacityChanged={refreshCapacity}
            pricing={pricing}
            storage={storage.enabled ? storage.byWorkspace : undefined}
            onGoToConfiguration={() => setTab("configuration")}
          />
        ) : (
          <ConfigurationTab />
        )}
      </div>
    </AdminModeProvider>
  );
}

interface DetailTabProps {
  data: ReturnType<typeof useFabricData>["data"];
  loading: boolean;
  error: string | null;
  progress: ReturnType<typeof useFabricData>["progress"];
  filtered: EnrichedWorkspace[];
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  onLoad: () => void;
  getToken: ReturnType<typeof useTokenProvider>;
  onCapacityChanged: (capacityId: string) => void;
  pricing: ReturnType<typeof useCapacityPricing>;
  storage?: Map<string, WorkspaceStorageUsage>;
  onGoToConfiguration: () => void;
}

function DetailTab({
  data,
  loading,
  error,
  progress,
  filtered,
  filters,
  onFiltersChange,
  onLoad,
  getToken,
  onCapacityChanged,
  pricing,
  storage,
  onGoToConfiguration,
}: DetailTabProps) {
  return (
    <>
      <UnauthenticatedTemplate>
        <div className="setup-message">
          <p>
            You are not signed in. Open the{" "}
            <button className="link inline" onClick={onGoToConfiguration}>
              Configuration
            </button>{" "}
            tab to sign in with your Microsoft Fabric account.
          </p>
        </div>
      </UnauthenticatedTemplate>

      <AuthenticatedTemplate>
        <div className="toolbar">
          <button onClick={onLoad} disabled={loading}>
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
          <AdminControls />
        </div>

        <AdminBanner />
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
              onChange={onFiltersChange}
              resultCount={filtered.length}
              totalCount={data.workspaces.length}
            />
            <main className="results">
              <WorkspaceTree
                workspaces={filtered}
                getToken={getToken}
                capacities={data.capacities}
                onCapacityChanged={onCapacityChanged}
                pricing={pricing}
                storage={storage}
              />
            </main>
          </div>
        )}
      </AuthenticatedTemplate>
    </>
  );
}

interface DashboardTabViewProps {
  data: ReturnType<typeof useFabricData>["data"];
  loading: boolean;
  pricing: ReturnType<typeof useCapacityPricing>;
  storage?: Map<string, WorkspaceStorageUsage>;
  onLoad: () => void;
  onGoToConfiguration: () => void;
}

/** Dashboard tab: gates the aggregated view on auth and loaded data. */
function DashboardTabView({
  data,
  loading,
  pricing,
  storage,
  onLoad,
  onGoToConfiguration,
}: DashboardTabViewProps) {
  return (
    <>
      <UnauthenticatedTemplate>
        <div className="setup-message">
          <p>
            You are not signed in. Open the{" "}
            <button className="link inline" onClick={onGoToConfiguration}>
              Configuration
            </button>{" "}
            tab to sign in with your Microsoft Fabric account.
          </p>
        </div>
      </UnauthenticatedTemplate>

      <AuthenticatedTemplate>
        <div className="toolbar">
          <button onClick={onLoad} disabled={loading}>
            {loading ? "Loading…" : data ? "Refresh" : "Load workspaces"}
          </button>
        </div>

        {!data && !loading && (
          <div className="setup-message">
            <p>Click “Load workspaces” to fetch data from your tenant.</p>
          </div>
        )}

        {data && (
          <DashboardTab
            workspaces={data.workspaces}
            pricing={pricing}
            storage={storage}
          />
        )}
      </AuthenticatedTemplate>
    </>
  );
}

/** Configuration tab: account (sign in/out) and display preferences. */
function ConfigurationTab() {
  const { instance, accounts } = useMsal();
  const { currency, setCurrency } = useConfig();

  const signIn = () => {
    instance.loginPopup(loginRequest).catch((e) => console.error(e));
  };
  const signOut = () => {
    instance.logoutPopup().catch((e) => console.error(e));
  };

  return (
    <div className="config-panel">
      <section className="config-section">
        <h2>Account</h2>
        <AuthenticatedTemplate>
          <p className="muted">
            Signed in as <strong>{accounts[0]?.username}</strong>
          </p>
          <button className="secondary" onClick={signOut}>
            Sign out
          </button>
        </AuthenticatedTemplate>
        <UnauthenticatedTemplate>
          <p className="muted">
            Sign in with your Microsoft Fabric account to list the workspaces
            you have access to.
          </p>
          <button onClick={signIn}>Sign in</button>
        </UnauthenticatedTemplate>
      </section>

      <AuthenticatedTemplate>
        <AccessTestPanel />
      </AuthenticatedTemplate>

      <section className="config-section">
        <h2>Cost estimates</h2>
        <label className="config-field">
          <span>Currency</span>
          <select
            value={currency}
            onChange={(e) =>
              setCurrency(
                e.target.value as (typeof SUPPORTED_CURRENCIES)[number],
              )
            }
          >
            {SUPPORTED_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          Monthly compute costs are estimated from the public Azure Retail
          Prices API (pay-as-you-go price per capacity unit, by region) and
          assume a continuously running capacity (~730 hours/month). Actual
          billing depends on usage, pauses and reservations.
        </p>
      </section>

      <AuthenticatedTemplate>
        <StorageSection />
      </AuthenticatedTemplate>
    </div>
  );
}

/**
 * OneLake storage integration (opt-in). Auto-discovers the installed Fabric
 * Capacity Metrics semantic model and queries it (via the Power BI
 * executeQueries REST API) for per-workspace OneLake storage and cache usage.
 */
function StorageSection() {
  const {
    enabled,
    setEnabled,
    dataset,
    discovering,
    discoverError,
    discover,
    customDax,
    setCustomDax,
    loading,
    loadError,
    loadedAt,
    byWorkspace,
    loadStorage,
    schema,
    introspecting,
    introspect,
    lastDax,
    lastRows,
  } = useStorage();

  return (
    <section className="config-section">
      <h2>OneLake storage (preview)</h2>
      <label className="config-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span>
          Show per-workspace OneLake storage &amp; cache in the Detail tab
        </span>
      </label>
      <p className="muted">
        Reads current/billable OneLake storage (and cache, when the model
        exposes it) from the <strong>Fabric Capacity Metrics</strong> app
        semantic model via the Power BI executeQueries API. The app must be
        installed (by a capacity admin) and shared with your account, and the
        tenant setting <em>“Dataset Execute Queries REST API”</em> must be
        enabled. The model schema is undocumented and may change between app
        versions.
      </p>

      {enabled && (
        <>
          <div className="storage-actions">
            <button
              className="secondary"
              onClick={discover}
              disabled={discovering}
            >
              {discovering
                ? "Discovering…"
                : dataset
                  ? "Re-discover dataset"
                  : "Discover Metrics app"}
            </button>
            <button onClick={loadStorage} disabled={!dataset || loading}>
              {loading ? "Loading…" : "Load storage"}
            </button>
            <button
              className="link inline"
              onClick={introspect}
              disabled={!dataset || introspecting}
            >
              {introspecting ? "Reading schema…" : "Show model schema"}
            </button>
          </div>

          {dataset && (
            <p className="muted">
              Using <strong>{dataset.datasetName}</strong> in workspace{" "}
              <strong>{dataset.workspaceName}</strong>.
            </p>
          )}
          {discoverError && <div className="error">{discoverError}</div>}
          {loadError && <div className="error">{loadError}</div>}
          {loadedAt && !loadError && (
            <p className="muted">
              Loaded storage for {byWorkspace.size} workspace
              {byWorkspace.size === 1 ? "" : "s"} at{" "}
              {new Date(loadedAt).toLocaleTimeString()}.
            </p>
          )}

          {lastDax && (
            <details className="storage-schema">
              <summary>Executed DAX query</summary>
              <pre>{lastDax}</pre>
            </details>
          )}

          {lastRows.length > 0 && (
            <details className="storage-schema" open>
              <summary>Query results ({lastRows.length} rows)</summary>
              <DaxResultsTable rows={lastRows} />
            </details>
          )}

          {schema && (
            <details className="storage-schema">
              <summary>Model schema</summary>
              <pre>{schema}</pre>
            </details>
          )}

          <label className="config-field stacked">
            <span>Custom DAX query (optional)</span>
            <textarea
              className="dax-input"
              rows={4}
              spellCheck={false}
              placeholder={
                "Leave blank to auto-generate. A custom query must return a " +
                "workspace-id column plus CurrentGB / BillableGB / CacheGB columns."
              }
              value={customDax}
              onChange={(e) => setCustomDax(e.target.value)}
            />
          </label>
          <p className="muted">
            If auto-discovery cannot match the model, use “Show model schema”
            and provide a custom <code>EVALUATE</code> query here.
          </p>
        </>
      )}
    </section>
  );
}

/** Strips the "Table[Column]" prefix from an executeQueries result key. */
function shortColumnName(key: string): string {
  const open = key.indexOf("[");
  const close = key.lastIndexOf("]");
  return open >= 0 && close > open ? key.slice(open + 1, close) : key;
}

/** Renders the raw DAX query result rows as a table. */
function DaxResultsTable({ rows }: { rows: DaxRow[] }) {
  const columns = Object.keys(rows[0] ?? {});
  return (
    <div className="dax-results">
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col}>{shortColumnName(col)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => {
                const value = row[col];
                return (
                  <td key={col}>
                    {value == null
                      ? ""
                      : typeof value === "number"
                        ? value.toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })
                        : String(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Gated admin-mode toggle. Hidden unless the user is permitted to manage. */
function AdminControls() {
  const { isAdminMode, canManage, toggleAdminMode } = useAdminMode();
  if (!canManage) return null;
  return (
    <button
      className={`secondary admin-toggle${isAdminMode ? " active" : ""}`}
      onClick={toggleAdminMode}
    >
      {isAdminMode ? "Admin mode: on" : "Admin mode: off"}
    </button>
  );
}

/** Preview banner shown while admin mode is enabled. */
function AdminBanner() {
  const { isAdminMode } = useAdminMode();
  if (!isAdminMode) return null;
  return (
    <div className="admin-banner">
      {adminLiveWrites ? (
        <>
          Admin mode (live). Capacity and workspace operations run against{" "}
          <strong>Azure Resource Manager and the Fabric REST API</strong> — they
          make real changes to your tenant.
        </>
      ) : (
        <>
          Admin mode (preview). Capacity and workspace operations run real
          validation but execute against a <strong>simulation</strong> — no
          changes are made to live capacities yet.
        </>
      )}
    </div>
  );
}
