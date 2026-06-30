// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A - Admin Mode: durable *remote* audit sink.
//
// The local store (auditStore.ts) keeps audit events on the device; this module
// forwards each event to a central collector so the record is retained off the
// device and is tamper-evident. It plugs in behind `persistAuditEvent` via
// `registerRemoteAuditSink`, so callers never change.
//
// Delivery is best-effort with at-least-once semantics: a failed POST is queued
// in a small localStorage outbox and retried on the next event and at startup.
// Auditing must never break an operation, so all errors are swallowed (logged).

import type { AuditEvent } from "./adminTypes";

const OUTBOX_KEY = "fcm.admin.audit.outbox";
/** Cap the retry outbox so a persistently-unreachable collector can't grow it. */
const MAX_OUTBOX = 200;

export interface HttpAuditSinkConfig {
  /** Collector endpoint that accepts a POSTed {@link AuditEvent} as JSON. */
  url: string;
  /** Optional bearer-token provider for authenticating the POST. */
  getAccessToken?: () => Promise<string | null>;
}

function readOutbox(): AuditEvent[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AuditEvent[]) : [];
  } catch {
    return [];
  }
}

function writeOutbox(events: AuditEvent[]): void {
  try {
    if (events.length === 0) localStorage.removeItem(OUTBOX_KEY);
    else localStorage.setItem(OUTBOX_KEY, JSON.stringify(events.slice(-MAX_OUTBOX)));
  } catch {
    // Best-effort persistence.
  }
}

async function post(config: HttpAuditSinkConfig, event: AuditEvent): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.getAccessToken) {
    const token = await config.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(config.url, {
    method: "POST",
    headers,
    body: JSON.stringify(event),
    keepalive: true,
  });
  if (!response.ok) {
    throw new Error(`Audit collector responded ${response.status}`);
  }
}

/**
 * Builds a remote audit sink for the given collector. The returned function is
 * fire-and-forget: it persists failed deliveries to the outbox and retries them
 * on subsequent calls so events are not lost when the collector is unreachable.
 */
export function createHttpAuditSink(
  config: HttpAuditSinkConfig,
): (event: AuditEvent) => void {
  async function flushOutbox(): Promise<void> {
    const queued = readOutbox();
    if (queued.length === 0) return;
    const remaining: AuditEvent[] = [];
    for (const queuedEvent of queued) {
      try {
        await post(config, queuedEvent);
      } catch {
        remaining.push(queuedEvent);
      }
    }
    writeOutbox(remaining);
  }

  async function deliver(event: AuditEvent): Promise<void> {
    await flushOutbox();
    try {
      await post(config, event);
    } catch (err) {
      console.warn(
        "[admin-audit] remote delivery failed; queued for retry",
        err,
      );
      writeOutbox([...readOutbox(), event]);
    }
  }

  // Drain anything queued by a previous session as soon as the sink is built.
  void flushOutbox();

  return (event) => {
    void deliver(event);
  };
}
