// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Computes capacity uptime (percentage of time Running) over a trailing window
// from the Azure Activity Log. Pause/resume go through the
// `Microsoft.Fabric/capacities/suspend|resume/action` management operations,
// which are recorded in the Activity Log. We enumerate the caller's
// subscriptions to resolve each capacity's ARM id, query the management events
// for the window, and reconstruct the Running/Paused timeline.
//
// Requires an Azure Resource Manager token, so this is best-effort and only run
// when ARM access is expected (live writes enabled). It degrades to an empty
// map when ARM is unavailable.

import type { Capacity } from "../types";
import type { TokenProvider } from "./fabricApi";
import { mapWithConcurrency } from "./fabricApi";
import { azureArmScopes } from "../authConfig";
import { normalizeCapacityState } from "../capacityState";

const ARM_BASE = "https://management.azure.com";
const SUBSCRIPTIONS_API_VERSION = "2020-01-01";
const FABRIC_CAPACITIES_API_VERSION = "2023-11-01";
const ACTIVITY_LOG_API_VERSION = "2015-04-01";

/** The trailing window over which uptime is measured. */
export const UPTIME_WINDOW_DAYS = 28;

/** Uptime measured for a single capacity over the trailing window. */
export interface CapacityUptime {
  capacityId: string;
  /** Percentage of the window the capacity was Running (0-100). */
  uptimePercent: number;
  /** Milliseconds the capacity was Running during the window. */
  activeMs: number;
  /** Total length of the window in milliseconds. */
  windowMs: number;
  /** Number of suspend/resume transitions observed in the window. */
  eventCount: number;
}

type RunState = "Running" | "Paused";

/** One reconstructed suspend/resume transition. */
interface Transition {
  atMs: number;
  target: RunState;
}

interface ActivityLogEvent {
  eventTimestamp?: string;
  operationName?: { value?: string };
  status?: { value?: string };
}

interface PagedArm<T> {
  value?: T[];
  nextLink?: string;
}

async function armGet<T>(url: string, token: string): Promise<T | null> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

/** Lists the caller's subscription ids. */
async function listSubscriptionIds(token: string): Promise<string[]> {
  const body = await armGet<PagedArm<{ subscriptionId: string }>>(
    `${ARM_BASE}/subscriptions?api-version=${SUBSCRIPTIONS_API_VERSION}`,
    token,
  );
  return (body?.value ?? []).map((s) => s.subscriptionId);
}

/**
 * Builds a map of capacity name (lower-cased) -> ARM resource id by enumerating
 * the caller's subscriptions and `Microsoft.Fabric/capacities`.
 */
async function mapCapacityArmIds(
  token: string,
  subscriptionIds: string[],
): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  for (const sub of subscriptionIds) {
    const body = await armGet<PagedArm<{ id: string; name: string }>>(
      `${ARM_BASE}/subscriptions/${sub}/providers/Microsoft.Fabric/capacities?api-version=${FABRIC_CAPACITIES_API_VERSION}`,
      token,
    );
    for (const c of body?.value ?? []) {
      byName.set(c.name.toLowerCase(), c.id);
    }
  }
  return byName;
}

/** Extracts the subscription id from a `/subscriptions/{id}/...` ARM id. */
function subscriptionOf(armId: string): string | null {
  const match = /\/subscriptions\/([^/]+)\//i.exec(armId);
  return match ? match[1] : null;
}

/**
 * Fetches successful suspend/resume transitions for one capacity within the
 * window, sorted ascending by time.
 */
async function fetchTransitions(
  token: string,
  armId: string,
  startIso: string,
  endIso: string,
): Promise<Transition[]> {
  const subscriptionId = subscriptionOf(armId);
  if (!subscriptionId) return [];

  const filter =
    `eventTimestamp ge '${startIso}' and eventTimestamp le '${endIso}' ` +
    `and resourceUri eq '${armId}'`;
  let url: string | null =
    `${ARM_BASE}/subscriptions/${subscriptionId}/providers/microsoft.insights/eventtypes/management/values` +
    `?api-version=${ACTIVITY_LOG_API_VERSION}` +
    `&$filter=${encodeURIComponent(filter)}` +
    `&$select=eventTimestamp,operationName,status`;

  const transitions: Transition[] = [];
  while (url) {
    const body: PagedArm<ActivityLogEvent> | null = await armGet<
      PagedArm<ActivityLogEvent>
    >(url, token);
    if (!body) break;
    for (const ev of body.value ?? []) {
      if ((ev.status?.value ?? "").toLowerCase() !== "succeeded") continue;
      const op = (ev.operationName?.value ?? "").toLowerCase();
      const ts = ev.eventTimestamp ? Date.parse(ev.eventTimestamp) : NaN;
      if (Number.isNaN(ts)) continue;
      if (op.includes("/suspend/action")) {
        transitions.push({ atMs: ts, target: "Paused" });
      } else if (op.includes("/resume/action")) {
        transitions.push({ atMs: ts, target: "Running" });
      }
    }
    url = body.nextLink ?? null;
  }

  transitions.sort((a, b) => a.atMs - b.atMs);
  return transitions;
}

function opposite(state: RunState): RunState {
  return state === "Running" ? "Paused" : "Running";
}

/**
 * Reconstructs the Running time over the window from the observed transitions
 * and the capacity's current state. The state before the first transition is
 * the opposite of that transition's target (a suspend/resume always flips
 * state); when there are no transitions the whole window is the current state.
 */
function computeUptime(
  capacityId: string,
  transitions: Transition[],
  currentState: RunState,
  windowStartMs: number,
  windowEndMs: number,
): CapacityUptime {
  const windowMs = windowEndMs - windowStartMs;

  if (transitions.length === 0) {
    const activeMs = currentState === "Running" ? windowMs : 0;
    return {
      capacityId,
      uptimePercent: windowMs > 0 ? (activeMs / windowMs) * 100 : 0,
      activeMs,
      windowMs,
      eventCount: 0,
    };
  }

  let activeMs = 0;
  let prevMs = windowStartMs;
  let prevState: RunState = opposite(transitions[0].target);
  for (const t of transitions) {
    const at = Math.min(Math.max(t.atMs, windowStartMs), windowEndMs);
    if (prevState === "Running") activeMs += at - prevMs;
    prevState = t.target;
    prevMs = at;
  }
  if (prevState === "Running") activeMs += windowEndMs - prevMs;

  return {
    capacityId,
    uptimePercent: windowMs > 0 ? (activeMs / windowMs) * 100 : 0,
    activeMs,
    windowMs,
    eventCount: transitions.length,
  };
}

/**
 * Computes uptime over the trailing {@link UPTIME_WINDOW_DAYS} window for every
 * capacity, keyed by Fabric capacity id. Best-effort: returns an empty map when
 * ARM is unavailable, and silently skips any capacity that cannot be resolved
 * to an ARM resource or whose current state is indeterminate.
 */
export async function getCapacityUptime(
  getToken: TokenProvider,
  capacities: Capacity[],
): Promise<Map<string, CapacityUptime>> {
  const result = new Map<string, CapacityUptime>();
  if (capacities.length === 0) return result;

  try {
    const token = await getToken(azureArmScopes);
    const subscriptionIds = await listSubscriptionIds(token);
    if (subscriptionIds.length === 0) return result;

    const armIdByName = await mapCapacityArmIds(token, subscriptionIds);
    if (armIdByName.size === 0) return result;

    const windowEndMs = Date.now();
    const windowStartMs = windowEndMs - UPTIME_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const startIso = new Date(windowStartMs).toISOString();
    const endIso = new Date(windowEndMs).toISOString();

    const uptimes = await mapWithConcurrency<Capacity, CapacityUptime | null>(
      capacities,
      4,
      async (cap) => {
        const runState = normalizeCapacityState(cap.state);
        // We can only resolve a window from suspend/resume flips when the
        // current state is a definite Running or Paused.
        if (runState !== "Running" && runState !== "Paused") return null;
        const armId = armIdByName.get(cap.displayName.toLowerCase());
        if (!armId) return null;
        try {
          const transitions = await fetchTransitions(
            token,
            armId,
            startIso,
            endIso,
          );
          return computeUptime(
            cap.id,
            transitions,
            runState,
            windowStartMs,
            windowEndMs,
          );
        } catch {
          return null;
        }
      },
    );

    for (const u of uptimes) {
      if (u) result.set(u.capacityId, u);
    }
  } catch {
    // No ARM access: surface no uptime.
  }
  return result;
}
