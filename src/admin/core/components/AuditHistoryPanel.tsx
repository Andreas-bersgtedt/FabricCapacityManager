// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A - Admin Mode: audit history panel. Renders the durable audit log so
// an admin can see who initiated each capacity/workspace operation, what it
// targeted, and how it ended. Visible only while admin mode is enabled.

import { useMemo, useState } from "react";
import { useAdminMode } from "../AdminModeContext";
import { useAuditLog } from "../AuditContext";
import type { AdminOperationType, AuditOutcome } from "../adminTypes";

const OPERATION_LABELS: Record<AdminOperationType, string> = {
  "capacity.scale": "Scale capacity",
  "capacity.pause": "Pause capacity",
  "capacity.resume": "Resume capacity",
  "workspace.move.sameGeo": "Move workspace (same geo)",
  "workspace.move.crossRegion": "Move workspace (cross-region)",
};

function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
}

function formatTargets(targets: Record<string, string>): string {
  const entries = Object.entries(targets);
  if (entries.length === 0) return "—";
  return entries.map(([key, value]) => `${key}: ${value}`).join(", ");
}

export function AuditHistoryPanel() {
  const { isAdminMode } = useAdminMode();
  const { events, clear } = useAuditLog();
  const [expanded, setExpanded] = useState(false);

  const summary = useMemo(() => {
    const counts: Partial<Record<AuditOutcome, number>> = {};
    for (const event of events) {
      counts[event.outcome] = (counts[event.outcome] ?? 0) + 1;
    }
    return counts;
  }, [events]);

  if (!isAdminMode) return null;

  return (
    <section className="audit-panel">
      <header className="audit-panel__header">
        <button
          className="link"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "▾" : "▸"} Audit history ({events.length})
        </button>
        {events.length > 0 && (
          <span className="muted audit-panel__summary">
            {Object.entries(summary)
              .map(([outcome, count]) => `${count} ${outcome}`)
              .join(" · ")}
          </span>
        )}
        {events.length > 0 && (
          <button className="link audit-panel__clear" onClick={clear}>
            Clear
          </button>
        )}
      </header>

      {expanded &&
        (events.length === 0 ? (
          <p className="muted audit-panel__empty">
            No admin operations have been recorded yet.
          </p>
        ) : (
          <div className="audit-panel__table-wrap">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Operation</th>
                  <th>Outcome</th>
                  <th>Targets</th>
                  <th>Actor</th>
                  <th>Correlation</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event, index) => (
                  <tr key={`${event.correlationId}-${index}`}>
                    <td>{formatTimestamp(event.timestampUtc)}</td>
                    <td>{OPERATION_LABELS[event.operationType]}</td>
                    <td>
                      <span
                        className={`audit-outcome audit-outcome--${event.outcome}`}
                      >
                        {event.outcome}
                      </span>
                    </td>
                    <td className="audit-table__targets">
                      {formatTargets(event.targetIds)}
                    </td>
                    <td className="muted">{event.actorObjectId ?? "—"}</td>
                    <td className="muted audit-table__correlation">
                      {event.correlationId}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  );
}
