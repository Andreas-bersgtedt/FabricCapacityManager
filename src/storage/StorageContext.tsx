// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// App-wide state for the opt-in OneLake storage integration. Holds the enabled
// flag, the discovered Capacity Metrics dataset, an optional custom DAX query
// override and the resulting per-workspace storage usage. The enabled flag, the
// discovered dataset and any custom DAX are persisted to localStorage so the
// integration survives reloads; the storage values are fetched on demand.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useMsal } from "@azure/msal-react";
import { createTokenProvider } from "../hooks/useTokenProvider";
import {
  discoverMetricsDataset,
  fetchWorkspaceStorage,
  introspectSchema,
  type DaxRow,
  type MetricsDataset,
} from "./metricsApi";
import type { WorkspaceStorageUsage } from "../types";

const ENABLED_KEY = "fcm.storage.enabled";
const DATASET_KEY = "fcm.storage.dataset";
const DAX_KEY = "fcm.storage.dax";

interface StorageContextValue {
  /** Whether the OneLake storage integration is switched on. */
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  /** The discovered Capacity Metrics dataset, or null until discovered. */
  dataset: MetricsDataset | null;
  discovering: boolean;
  discoverError: string | null;
  /** Auto-discovers the installed Capacity Metrics dataset. */
  discover: () => Promise<void>;
  /** Optional DAX override used instead of the auto-generated query. */
  customDax: string;
  setCustomDax: (value: string) => void;
  /** Per-workspace storage usage from the last successful load. */
  byWorkspace: Map<string, WorkspaceStorageUsage>;
  loading: boolean;
  loadError: string | null;
  loadedAt: number | null;
  /** The DAX query executed by the last load (generated or custom). */
  lastDax: string | null;
  /** The raw result rows returned by the last load. */
  lastRows: DaxRow[];
  /** Loads per-workspace storage from the discovered dataset. */
  loadStorage: () => Promise<void>;
  /** Introspected model schema text (tables/columns/measures). */
  schema: string | null;
  introspecting: boolean;
  /** Dumps the model schema to help craft a custom DAX query. */
  introspect: () => Promise<void>;
}

const StorageContext = createContext<StorageContextValue | undefined>(undefined);

function readBool(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function readString(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function readDataset(): MetricsDataset | null {
  try {
    const raw = localStorage.getItem(DATASET_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MetricsDataset;
    if (parsed?.workspaceId && parsed?.datasetId) return parsed;
  } catch {
    // Ignore malformed/inaccessible storage.
  }
  return null;
}

function writeString(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Best-effort persistence.
  }
}

export function StorageProvider({ children }: { children: ReactNode }) {
  const { instance, accounts } = useMsal();

  const [enabled, setEnabledState] = useState<boolean>(() => readBool(ENABLED_KEY));
  const [dataset, setDataset] = useState<MetricsDataset | null>(readDataset);
  const [customDax, setCustomDaxState] = useState<string>(() => readString(DAX_KEY));
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [byWorkspace, setByWorkspace] = useState<
    Map<string, WorkspaceStorageUsage>
  >(new Map());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [lastDax, setLastDax] = useState<string | null>(null);
  const [lastRows, setLastRows] = useState<DaxRow[]>([]);
  const [schema, setSchema] = useState<string | null>(null);
  const [introspecting, setIntrospecting] = useState(false);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    writeString(ENABLED_KEY, value ? "true" : "");
    if (!value) {
      setByWorkspace(new Map());
      setLastRows([]);
      setLoadError(null);
      setLoadedAt(null);
    }
  }, []);

  const setCustomDax = useCallback((value: string) => {
    setCustomDaxState(value);
    writeString(DAX_KEY, value.trim());
  }, []);

  const getProvider = useCallback(() => {
    const account = accounts[0];
    if (!account) throw new Error("No signed-in account.");
    return createTokenProvider(instance, account);
  }, [instance, accounts]);

  const discover = useCallback(async () => {
    setDiscovering(true);
    setDiscoverError(null);
    try {
      const found = await discoverMetricsDataset(getProvider());
      if (!found) {
        setDataset(null);
        writeString(DATASET_KEY, "");
        setDiscoverError(
          "No Fabric Capacity Metrics dataset found. Install the Capacity " +
            "Metrics app and make sure it is shared with your account.",
        );
        return;
      }
      setDataset(found);
      writeString(DATASET_KEY, JSON.stringify(found));
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : String(err));
    } finally {
      setDiscovering(false);
    }
  }, [getProvider]);

  const loadStorage = useCallback(async () => {
    if (!dataset) {
      setLoadError("Discover the Capacity Metrics dataset first.");
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const { byWorkspace: map, dax, rows } = await fetchWorkspaceStorage(
        getProvider(),
        dataset,
        customDax,
      );
      setByWorkspace(map);
      setLastDax(dax);
      setLastRows(rows);
      setLoadedAt(Date.now());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [dataset, customDax, getProvider]);

  const introspect = useCallback(async () => {
    if (!dataset) {
      setLoadError("Discover the Capacity Metrics dataset first.");
      return;
    }
    setIntrospecting(true);
    try {
      const text = await introspectSchema(getProvider(), dataset);
      setSchema(text);
    } catch (err) {
      setSchema(
        `Schema introspection failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      setIntrospecting(false);
    }
  }, [dataset, getProvider]);

  const value = useMemo<StorageContextValue>(
    () => ({
      enabled,
      setEnabled,
      dataset,
      discovering,
      discoverError,
      discover,
      customDax,
      setCustomDax,
      byWorkspace,
      loading,
      loadError,
      loadedAt,
      lastDax,
      lastRows,
      loadStorage,
      schema,
      introspecting,
      introspect,
    }),
    [
      enabled,
      setEnabled,
      dataset,
      discovering,
      discoverError,
      discover,
      customDax,
      setCustomDax,
      byWorkspace,
      loading,
      loadError,
      loadedAt,
      lastDax,
      lastRows,
      loadStorage,
      schema,
      introspecting,
      introspect,
    ],
  );

  return (
    <StorageContext.Provider value={value}>{children}</StorageContext.Provider>
  );
}

/** Access the shared OneLake storage integration state. */
export function useStorage(): StorageContextValue {
  const ctx = useContext(StorageContext);
  if (!ctx) {
    throw new Error("useStorage must be used within a StorageProvider");
  }
  return ctx;
}
