// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// React hook that orchestrates loading all Fabric data: it acquires tokens via
// MSAL, fetches capacities and workspaces, then enriches every workspace with
// its item types and storage mode, exposing loading/error/progress state.

import { useCallback, useState } from "react";
import { useMsal } from "@azure/msal-react";
import {
  getAdminWorkspaceStorageFormats,
  getDomainNames,
  getWorkspaceDetails,
  getWorkspaceRole,
  getWorkspaceStorageMode,
  listCapacities,
  listItems,
  listWorkspaces,
  mapWithConcurrency,
} from "../api/fabricApi";
import { adminLiveWrites, getCapacityTags } from "../admin";
import { createTokenProvider } from "./useTokenProvider";
import type {
  Capacity,
  EnrichedWorkspace,
  FabricData,
  StorageMode,
} from "../types";

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
    const userObjectId = account.localAccountId;
    setLoading(true);
    setError(null);
    setData(null);
    setProgress({ total: 0, done: 0, phase: "Loading capacities & workspaces" });

    try {
      const [capacities, workspaces, storageFormats] = await Promise.all([
        listCapacities(getToken),
        listWorkspaces(getToken),
        getAdminWorkspaceStorageFormats(getToken),
      ]);

      const capacityById = new Map<string, Capacity>(
        capacities.map((c) => [c.id, c]),
      );

      // Governance domain names (best-effort) and capacity Azure tags (ARM,
      // only when live writes / ARM access is expected). Both degrade to empty.
      const [domainNames, capacityTags] = await Promise.all([
        getDomainNames(
          getToken,
          workspaces.map((w) => w.domainId ?? ""),
        ),
        adminLiveWrites
          ? getCapacityTags(getToken)
          : Promise.resolve(new Map<string, Record<string, string>>()),
      ]);

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
          const [items, storageMode, userRole, details] = await Promise.all([
            listItems(getToken, ws.id).catch(() => []),
            getWorkspaceStorageMode(getToken, ws.id),
            getWorkspaceRole(getToken, ws.id, userObjectId),
            getWorkspaceDetails(getToken, ws.id),
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
            capacityState: cap?.state,
            userRole,
            capacityRegion: details.capacityRegion,
            capacityAssignmentProgress: details.capacityAssignmentProgress,
            defaultStorageFormat: storageFormats.get(ws.id),
            domainId: ws.domainId,
            domainName: ws.domainId ? domainNames.get(ws.domainId) : undefined,
            capacityTags: cap
              ? capacityTags.get(cap.displayName.toLowerCase())
              : undefined,
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

  /**
   * Incrementally refreshes a single capacity's metadata after an admin
   * operation (scale / pause / resume) without re-enriching every workspace.
   * Re-lists capacities, then patches the changed capacity in place and the
   * denormalized SKU/region/state carried on each affected workspace.
   */
  const refreshCapacity = useCallback(
    async (capacityId: string) => {
      const account = accounts[0];
      if (!account) return;
      const getToken = createTokenProvider(instance, account);
      try {
        const capacities = await listCapacities(getToken);
        const updated = capacities.find((c) => c.id === capacityId);
        if (!updated) return;
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            capacities: prev.capacities.map((c) =>
              c.id === capacityId ? updated : c,
            ),
            workspaces: prev.workspaces.map((w) =>
              w.capacityId === capacityId
                ? {
                    ...w,
                    capacityName: updated.displayName,
                    sku: updated.sku,
                    region: updated.region,
                    capacityState: updated.state,
                  }
                : w,
            ),
          };
        });
      } catch {
        // Best-effort: leave existing data in place on failure.
      }
    },
    [accounts, instance],
  );

  return { data, loading, error, progress, load, refreshCapacity };
}
