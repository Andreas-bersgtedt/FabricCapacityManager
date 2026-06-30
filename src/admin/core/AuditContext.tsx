// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A - Admin Mode: React context exposing the durable audit log to the UI
// and registering the signed-in actor with the audit store. Wrap the app in an
// AuditProvider so the audit history panel can render and so persisted events
// are attributed to the current user.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AuditEvent } from "./adminTypes";
import {
  clearAuditEvents,
  getAuditEvents,
  registerRemoteAuditSink,
  setAuditActor,
  subscribeAuditEvents,
} from "./auditStore";
import { createHttpAuditSink } from "./remoteAuditSink";
import { auditRemoteUrl } from "./featureFlags";

interface AuditContextValue {
  /** Persisted audit events, newest first. */
  events: AuditEvent[];
  /** Clears the durable audit log. */
  clear(): void;
}

const AuditContext = createContext<AuditContextValue | null>(null);

interface AuditProviderProps {
  children: ReactNode;
  /** Object id of the signed-in actor, stamped onto persisted audit events. */
  actorObjectId?: string;
  /**
   * Optional bearer-token provider used to authenticate POSTs to the remote
   * audit collector (only consulted when `VITE_AUDIT_REMOTE_URL` is set).
   */
  getAccessToken?: () => Promise<string | null>;
}

export function AuditProvider({
  children,
  actorObjectId,
  getAccessToken,
}: AuditProviderProps) {
  const [events, setEvents] = useState<AuditEvent[]>(() => getAuditEvents());

  useEffect(() => {
    setAuditActor(actorObjectId);
  }, [actorObjectId]);

  useEffect(
    () => subscribeAuditEvents(() => setEvents(getAuditEvents())),
    [],
  );

  // Wire the durable remote sink when a collector endpoint is configured.
  useEffect(() => {
    if (!auditRemoteUrl) return;
    registerRemoteAuditSink(
      createHttpAuditSink({ url: auditRemoteUrl, getAccessToken }),
    );
    return () => registerRemoteAuditSink(null);
  }, [getAccessToken]);

  const clear = useCallback(() => clearAuditEvents(), []);

  const value = useMemo<AuditContextValue>(
    () => ({ events, clear }),
    [events, clear],
  );

  return (
    <AuditContext.Provider value={value}>{children}</AuditContext.Provider>
  );
}

export function useAuditLog(): AuditContextValue {
  const ctx = useContext(AuditContext);
  if (!ctx) {
    throw new Error("useAuditLog must be used within an AuditProvider.");
  }
  return ctx;
}
