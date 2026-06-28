// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andreas Bergstedt
//
// UI for the access self-test. Lists every required permission grouped by mode
// (Standard / Admin) with a per-permission status, and offers a re-run and an
// interactive "grant access" action.

import { useAccessTest } from "./AccessTestContext";
import type {
  AccessCheckResult,
  AccessMode,
  AccessStatus,
} from "./accessChecks";

const STATUS_LABEL: Record<AccessStatus, string> = {
  checking: "Checking…",
  granted: "Granted",
  warning: "Limited",
  denied: "Missing",
};

function statusClass(status: AccessStatus): string {
  return `access-status access-status--${status}`;
}

/** A compact one-line summary suitable for the header. */
export function AccessTestSummary({ onView }: { onView?: () => void }) {
  const { results, running } = useAccessTest();
  if (running && !results) {
    return <span className="access-summary muted">Checking access…</span>;
  }
  if (!results) return null;

  const denied = results.filter((r) => r.status === "denied").length;
  const warning = results.filter((r) => r.status === "warning").length;
  const granted = results.filter((r) => r.status === "granted").length;
  const tone = denied > 0 ? "denied" : warning > 0 ? "warning" : "granted";

  return (
    <button
      type="button"
      className={`access-summary access-summary--${tone}`}
      onClick={onView}
      title="View the access self-test in the Configuration tab"
    >
      Access: {granted}/{results.length} OK
      {denied > 0 ? ` · ${denied} missing` : ""}
      {warning > 0 ? ` · ${warning} limited` : ""}
    </button>
  );
}

function ResultRow({ result }: { result: AccessCheckResult }) {
  const { check, status, message } = result;
  return (
    <li className="access-item">
      <div className="access-item__head">
        <span className={statusClass(status)}>{STATUS_LABEL[status]}</span>
        <span className="access-item__label">{check.label}</span>
        {check.optional && <span className="access-item__optional">optional</span>}
      </div>
      <p className="access-item__desc muted">{check.description}</p>
      <p className="access-item__message">{message}</p>
      <code className="access-item__scopes">{check.scopes.join(", ")}</code>
    </li>
  );
}

function ModeGroup({
  title,
  mode,
  results,
}: {
  title: string;
  mode: AccessMode;
  results: AccessCheckResult[];
}) {
  const rows = results.filter((r) => r.check.mode === mode);
  if (rows.length === 0) return null;
  const ok = rows.filter((r) => r.status === "granted").length;
  return (
    <div className="access-group">
      <h3 className="access-group__title">
        {title}{" "}
        <span className="muted">
          ({ok}/{rows.length})
        </span>
      </h3>
      <ul className="access-list">
        {rows.map((r) => (
          <ResultRow key={r.check.id} result={r} />
        ))}
      </ul>
    </div>
  );
}

/** Full access self-test panel, intended for the Configuration tab. */
export function AccessTestPanel() {
  const { results, running, lastRunAt, rerun, grantAccess } = useAccessTest();

  return (
    <section className="config-section">
      <h2>Access self-test</h2>
      <p className="muted">
        Runs automatically when you sign in. Lists every permission the app
        relies on for standard (read) and admin (write) mode, and verifies that
        your account actually has each one.
      </p>

      <div className="access-actions">
        <button className="secondary" onClick={rerun} disabled={running}>
          {running ? "Testing…" : "Re-run test"}
        </button>
        <button onClick={grantAccess} disabled={running}>
          Grant access
        </button>
        {lastRunAt && (
          <span className="muted">
            Last run {new Date(lastRunAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {!results && running && <p className="muted">Checking access…</p>}

      {results && (
        <div className="access-results">
          <ModeGroup
            title="Standard mode (read)"
            mode="standard"
            results={results}
          />
          <ModeGroup
            title="Admin mode (write)"
            mode="admin"
            results={results}
          />
        </div>
      )}
    </section>
  );
}
