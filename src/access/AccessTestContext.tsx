// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// React context that runs the access self-test. It auto-runs (silently) as soon
// as an account is signed in, and exposes a manual re-run plus an interactive
// "grant access" flow that prompts for consent on every required resource.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useMsal } from "@azure/msal-react";
import {
  InteractionRequiredAuthError,
  type AccountInfo,
  type IPublicClientApplication,
} from "@azure/msal-browser";
import {
  ACCESS_CHECKS,
  distinctResourceScopes,
  runAccessChecks,
  type AccessCheckResult,
} from "./accessChecks";

interface AccessTestValue {
  /** Results for every declared permission, or null before the first run. */
  results: AccessCheckResult[] | null;
  /** True while a run is in flight. */
  running: boolean;
  /** Timestamp (ms) of the last completed run, or null. */
  lastRunAt: number | null;
  /** Re-run the test silently (no consent prompts). */
  rerun(): void;
  /** Prompt for consent on every required resource, then re-run. */
  grantAccess(): Promise<void>;
}

const AccessTestContext = createContext<AccessTestValue | null>(null);

/** Builds a silent-only token acquirer; rejects when interaction is required. */
function silentAcquirer(
  instance: IPublicClientApplication,
  account: AccountInfo,
) {
  return (scopes: string[]) =>
    instance
      .acquireTokenSilent({ scopes, account })
      .then((r) => r.accessToken);
}

export function AccessTestProvider({ children }: { children: ReactNode }) {
  const { instance, accounts } = useMsal();
  const account = accounts[0] ?? null;
  const [results, setResults] = useState<AccessCheckResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);
  // Guards against overlapping runs and stale updates after sign-out.
  const runningRef = useRef(false);

  const run = useCallback(async () => {
    if (!account || runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    try {
      const acquire = silentAcquirer(instance, account);
      const next = await runAccessChecks(acquire, ACCESS_CHECKS);
      setResults(next);
      setLastRunAt(Date.now());
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [instance, account]);

  // Auto-run once whenever the signed-in account changes.
  const accountKey = account?.homeAccountId ?? null;
  useEffect(() => {
    if (accountKey) {
      void run();
    } else {
      setResults(null);
      setLastRunAt(null);
    }
    // run is stable per account; keyed on accountKey to fire on sign-in/out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey]);

  const grantAccess = useCallback(async () => {
    if (!account || runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    try {
      // One consent prompt per distinct resource (MSAL forbids mixing them).
      for (const scopes of distinctResourceScopes(ACCESS_CHECKS)) {
        try {
          await instance.acquireTokenPopup({ scopes, account });
        } catch (err) {
          // Skip resources the user declines; the re-run will report them.
          if (!(err instanceof InteractionRequiredAuthError)) {
            console.warn("Consent for", scopes, "was not granted:", err);
          }
        }
      }
      const acquire = silentAcquirer(instance, account);
      const next = await runAccessChecks(acquire, ACCESS_CHECKS);
      setResults(next);
      setLastRunAt(Date.now());
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [instance, account]);

  const rerun = useCallback(() => void run(), [run]);

  const value = useMemo<AccessTestValue>(
    () => ({ results, running, lastRunAt, rerun, grantAccess }),
    [results, running, lastRunAt, rerun, grantAccess],
  );

  return (
    <AccessTestContext.Provider value={value}>
      {children}
    </AccessTestContext.Provider>
  );
}

export function useAccessTest(): AccessTestValue {
  const ctx = useContext(AccessTestContext);
  if (!ctx) {
    throw new Error("useAccessTest must be used within an AccessTestProvider.");
  }
  return ctx;
}
