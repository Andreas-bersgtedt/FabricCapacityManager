// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// React hook that orchestrates loading all Fabric data: it acquires tokens via
// MSAL, fetches capacities and workspaces, then enriches every workspace with
// its item types and storage mode, exposing loading/error/progress state.

import { useCallback, useState } from "react";
import { useMsal } from "@azure/msal-react";
import {
  InteractionRequiredAuthError,
  type AccountInfo,
  type IPublicClientApplication,
} from "@azure/msal-browser";
import {
  getWorkspaceStorageMode,
  listCapacities,
  listItems,
  listWorkspaces,
  mapWithConcurrency,
  type TokenProvider,
} from "../api/fabricApi";
import type {
  Capacity,
  EnrichedWorkspace,
  FabricData,
  StorageMode,
} from "../types";

/**
 * Builds a {@link TokenProvider} backed by MSAL. Tokens are acquired silently
 * from the cache when possible, falling back to an interactive popup when the
 * user must consent or re-authenticate (e.g. a different resource/scope).
 */
function createTokenProvider(
  instance: IPublicClientApplication,
  account: AccountInfo,
): TokenProvider {
  return async (scopes: string[]) => {
    try {
      const result = await instance.acquireTokenSilent({ scopes, account });
      return result.accessToken;
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        const result = await instance.acquireTokenPopup({ scopes, account });
        return result.accessToken;
      }
      throw err;
    }
  };
}

/** Progress reported while enriching workspaces. */
interface LoadProgress {
  total: number;
  done: number;
  phase: string;
}

/**
 * Loads and enriches Fabric workspace data on demand.
 *
 * @returns An object with the loaded {@link FabricData} (or `null`), loading and
 * error flags, the current {@link LoadProgress}, and a `load()` action that
 * (re)fetches everything for the signed-in account.
 */
export function useFabricData() {
  const { instance, accounts } = useMsal();
  const [data, setData] = useState<FabricData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<LoadProgress | null>(null);

  const load = useCallback(async () => {
    const account = accounts[0];
    if (!account) {
      setError("No signed-in account.");
      return;
    }
    const getToken = createTokenProvider(instance, account);
    setLoading(true);
    setError(null);
    setData(null);
    setProgress({ total: 0, done: 0, phase: "Loading capacities & workspaces" });

    try {
      const [capacities, workspaces] = await Promise.all([
        listCapacities(getToken),
        listWorkspaces(getToken),
      ]);

      const capacityById = new Map<string, Capacity>(
        capacities.map((c) => [c.id, c]),
      );

      let done = 0;
      setProgress({
        total: workspaces.length,
        done,
        phase: "Loading items & storage mode",
      });

      const enriched = await mapWithConcurrency<typeof workspaces[number], EnrichedWorkspace>(
        workspaces,
        8,
        async (ws) => {
          const [items, storageMode] = await Promise.all([
            listItems(getToken, ws.id).catch(() => []),
            getWorkspaceStorageMode(getToken, ws.id),
          ]);
          const itemTypes = Array.from(
            new Set(items.map((i) => i.type)),
          ).sort();
          const cap = ws.capacityId
            ? capacityById.get(ws.capacityId)
            : undefined;

          done += 1;
          setProgress({
            total: workspaces.length,
            done,
            phase: "Loading items & storage mode",
          });

          return {
            id: ws.id,
            displayName: ws.displayName,
            type: ws.type,
            capacityId: ws.capacityId,
            capacityName: cap?.displayName ?? "(No capacity)",
            sku: cap?.sku ?? "(No SKU)",
            region: cap?.region ?? "(No region)",
            itemTypes,
            itemCount: items.length,
            storageMode: storageMode as StorageMode,
          };
        },
      );

      const allItemTypes = Array.from(
        new Set(enriched.flatMap((w) => w.itemTypes)),
      ).sort();

      setData({ capacities, workspaces: enriched, allItemTypes });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, [accounts, instance]);

  return { data, loading, error, progress, load };
}
