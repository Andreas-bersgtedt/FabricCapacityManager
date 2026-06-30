// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A - Admin Mode: durable audit log store.
//
// The admin operation lifecycle emits an AuditEvent at every decision point
// (blocked / attempted / succeeded / failed / cancelled). This module persists
// those events to localStorage so the "who did what, when, and the outcome"
// record survives a page reload — closing the Branch A exit criterion that
// "every operation generates an auditable record".
//
// It is intentionally a small module-level singleton (mirroring the localStorage
// patterns used by StorageContext) so the default audit sink in
// useAdminOperation can persist without every slice having to thread a sink
// through. A future GA step can swap localStorage for a remote sink (App
// Insights / table storage) behind the same `persistAuditEvent` surface.

import type { AuditEvent } from "./adminTypes";

const STORAGE_KEY = "fcm.admin.audit";
/** Cap retained events so the log cannot grow without bound in localStorage. */
const MAX_EVENTS = 200;

/**
 * Object id of the signed-in actor, set once by the AuditProvider. The sink
 * stamps it onto events that don't already carry an actor so slice code does
 * not need to plumb identity through every call site.
 */
let currentActorObjectId: string | undefined;

/**
 * Optional durable remote sink (e.g. HTTP collector). Registered at runtime so
 * `persistAuditEvent` can forward every event to a central store without any
 * caller change. See {@link registerRemoteAuditSink}.
 */
let remoteSink: ((event: AuditEvent) => void) | null = null;

const listeners = new Set<() => void>();

function read(): AuditEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AuditEvent[]) : [];
  } catch {
    // Ignore malformed/inaccessible storage.
    return [];
  }
}

function write(events: AuditEvent[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // Best-effort persistence; never let auditing break an operation.
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Records the actor stamped onto subsequently persisted audit events. */
export function setAuditActor(objectId: string | undefined): void {
  currentActorObjectId = objectId;
}

/**
 * Registers (or clears, with `null`) a durable remote sink that receives every
 * persisted audit event in addition to the local store. Safe to call multiple
 * times; the latest registration wins.
 */
export function registerRemoteAuditSink(
  sink: ((event: AuditEvent) => void) | null,
): void {
  remoteSink = sink;
}

/** Returns the persisted audit events, newest first. */
export function getAuditEvents(): AuditEvent[] {
  return read();
}

/** Clears the persisted audit log. */
export function clearAuditEvents(): void {
  write([]);
  notify();
}

/** Subscribes to audit log changes. Returns an unsubscribe function. */
export function subscribeAuditEvents(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Persists a single audit event (newest first, capped at {@link MAX_EVENTS}),
 * stamping the current actor when the event does not already carry one.
 */
export function persistAuditEvent(event: AuditEvent): void {
  const stamped: AuditEvent = {
    ...event,
    actorObjectId: event.actorObjectId ?? currentActorObjectId,
  };
  const next = [stamped, ...read()].slice(0, MAX_EVENTS);
  write(next);
  notify();

  // Forward to the durable remote sink, if one is registered. Never let a
  // remote failure interfere with the local record.
  if (remoteSink) {
    try {
      remoteSink(stamped);
    } catch (err) {
      console.warn("[admin-audit] remote sink threw", err);
    }
  }
}

/** AuditSink that persists each event to the durable local store. */
export const localStorageAuditSink = (event: AuditEvent): void => {
  persistAuditEvent(event);
};
