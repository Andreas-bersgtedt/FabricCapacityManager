// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// Branch A - Admin Mode: renders preflight impact summary and validation
// messages for any operation.

import type { AdminPreflightResult } from "../adminTypes";

interface PreflightPanelProps {
  preflight: AdminPreflightResult | null;
}

export function PreflightPanel({ preflight }: PreflightPanelProps) {
  if (!preflight) return null;

  return (
    <div className="admin-preflight">
      {preflight.impactSummary.length > 0 && (
        <ul className="admin-preflight__impact">
          {preflight.impactSummary.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      {preflight.messages.map((m, i) => (
        <p key={i} className={`admin-message admin-message--${m.severity}`}>
          <strong>{m.code}</strong> {m.message}
        </p>
      ))}
    </div>
  );
}
