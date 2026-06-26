// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// App configuration shared across tabs. Currently holds the display currency
// used for capacity cost estimates, persisted to localStorage so the choice
// survives reloads.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  SUPPORTED_CURRENCIES,
  type CurrencyCode,
} from "../pricing/azureRetailPrices";

const STORAGE_KEY = "fcm.currency";
const DEFAULT_CURRENCY: CurrencyCode = "USD";

interface ConfigContextValue {
  currency: CurrencyCode;
  setCurrency: (currency: CurrencyCode) => void;
}

const ConfigContext = createContext<ConfigContextValue | undefined>(undefined);

function readStoredCurrency(): CurrencyCode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (SUPPORTED_CURRENCIES as readonly string[]).includes(stored)) {
      return stored as CurrencyCode;
    }
  } catch {
    // Ignore storage access errors (e.g. privacy mode) and use the default.
  }
  return DEFAULT_CURRENCY;
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<CurrencyCode>(readStoredCurrency);

  const setCurrency = useCallback((next: CurrencyCode) => {
    setCurrencyState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort.
    }
  }, []);

  const value = useMemo(() => ({ currency, setCurrency }), [currency, setCurrency]);
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

/** Access the shared app configuration (currency). */
export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx) {
    throw new Error("useConfig must be used within a ConfigProvider");
  }
  return ctx;
}
